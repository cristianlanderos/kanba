import { promises as fs } from 'fs';
import { NextRequest, NextResponse } from 'next/server';
import { identityOf } from '@/lib/server/auth';
import { execute } from '@/lib/server/query';
import { contentTypeOf, isImageFile, pathOf } from '@/lib/server/uploads';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * An uploaded image, for someone who may see a task that shows it. The database is asked
 * as that user, so a file's name alone, guessed or copied from elsewhere, opens nothing.
 */
export async function GET(request: NextRequest, { params }: { params: { file: string } }) {
  const missing = new NextResponse(null, { status: 404 });
  if (!isImageFile(params.file)) return missing;
  const identity = await identityOf(request);
  if (identity.role !== 'authenticated') return new NextResponse(null, { status: 401 });

  const shown = await execute(
    {
      kind: 'query',
      spec: { table: 'task_images', action: 'select', columns: 'id', filters: [{ column: 'file', op: 'eq', value: params.file }], limit: 1 },
    },
    identity
  );
  if (shown.error || !shown.data?.length) return missing;

  const bytes = await fs.readFile(pathOf(params.file)).catch(() => null);
  if (!bytes) return missing;
  return new NextResponse(bytes, {
    headers: {
      'Content-Type': contentTypeOf(params.file),
      // The name is the content's hash, so the browser can keep it. `private`: not a shared cache.
      'Cache-Control': 'private, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'",
    },
  });
}
