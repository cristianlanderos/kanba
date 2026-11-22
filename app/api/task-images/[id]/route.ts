import { NextRequest, NextResponse } from 'next/server';
import { identityOf, sameOrigin } from '@/lib/server/auth';
import { execute } from '@/lib/server/query';
import { dropIfUnused } from '@/lib/server/uploads';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Takes an image off its task, as the signed-in user, and off the disk when nothing else shows it. */
export async function DELETE(request: NextRequest, { params }: { params: { id: string } }) {
  if (!sameOrigin(request)) return NextResponse.json({ error: 'This request came from another site' }, { status: 403 });
  const identity = await identityOf(request);
  if (identity.role !== 'authenticated') return NextResponse.json({ error: 'Sign in to remove an image' }, { status: 401 });

  const removed = await execute(
    {
      kind: 'query',
      spec: {
        table: 'task_images',
        action: 'delete',
        filters: [{ column: 'id', op: 'eq', value: params.id }],
        returning: true,
        columns: 'id, file',
      },
    },
    identity
  );
  if (removed.error) return NextResponse.json({ error: 'There is no such image' }, { status: 404 });
  if (!removed.data?.length) return NextResponse.json({ error: 'There is no such image' }, { status: 404 });
  await dropIfUnused(removed.data[0].file);
  return NextResponse.json({});
}
