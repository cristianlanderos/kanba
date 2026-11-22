import { NextRequest, NextResponse } from 'next/server';
import { identityOf, sameOrigin } from '@/lib/server/auth';
import { execute } from '@/lib/server/query';
import { IMAGE_TYPES, MAX_IMAGE_BYTES, dropIfUnused, saveImage, sweepUnused } from '@/lib/server/uploads';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Attaches an image to a task. The body is the image itself, with its type in
 * Content-Type and, if the browser knows one, its name in X-File-Name. The row is written
 * as the signed-in user, so the database refuses a task that user may not see.
 */
export async function POST(request: NextRequest, { params }: { params: { taskId: string } }) {
  if (!sameOrigin(request)) return NextResponse.json({ error: 'This request came from another site' }, { status: 403 });
  const identity = await identityOf(request);
  if (identity.role !== 'authenticated') return NextResponse.json({ error: 'Sign in to add an image' }, { status: 401 });
  if (!UUID.test(params.taskId)) return NextResponse.json({ error: 'There is no such task' }, { status: 404 });

  const contentType = (request.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  if (!IMAGE_TYPES[contentType]) {
    return NextResponse.json({ error: 'Add a PNG, JPEG, GIF or WebP image' }, { status: 415 });
  }
  if (Number(request.headers.get('content-length') || 0) > MAX_IMAGE_BYTES) {
    return NextResponse.json({ error: 'The image is larger than 10 MB' }, { status: 413 });
  }
  const bytes = Buffer.from(await request.arrayBuffer());
  if (!bytes.length) return NextResponse.json({ error: 'The image is empty' }, { status: 400 });
  if (bytes.length > MAX_IMAGE_BYTES) return NextResponse.json({ error: 'The image is larger than 10 MB' }, { status: 413 });

  let name: string | null = null;
  try {
    name = decodeURIComponent(request.headers.get('x-file-name') || '').slice(0, 200) || null;
  } catch {}

  const file = await saveImage(bytes, contentType);
  const added = await execute(
    {
      kind: 'query',
      spec: {
        table: 'task_images',
        action: 'insert',
        values: { task_id: params.taskId, file, name, content_type: contentType, size: bytes.length, uploaded_by: identity.userId },
        filters: [],
        returning: true,
        columns: '*',
        single: 'single',
      },
    },
    identity
  );
  if (added.error) {
    // The file was stored before the database said no: it must not stay.
    await dropIfUnused(file);
    const refused = added.error.code === '42501' || added.error.code === '23503';
    return NextResponse.json(
      { error: refused ? 'You cannot add images to that task' : added.error.message },
      { status: refused ? 403 : 400 }
    );
  }
  sweepUnused();
  return NextResponse.json(added.data);
}
