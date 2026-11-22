import { NextRequest, NextResponse } from 'next/server';
import { failed } from '@/lib/query-builder';
import { identityOf, sameOrigin } from '@/lib/server/auth';
import { execute } from '@/lib/server/query';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Every query the screens make arrives here, as the description lib/query-builder.ts
 * built. It runs as the signed-in user, or as `anon`, and the database's row level
 * security decides what that user may see or change. The answer is always 200 with
 * `{ data, error }`, which is how the screens read a failed query.
 */
export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) {
    return NextResponse.json(failed('This request came from another site', 'KANBA403'), { status: 403 });
  }
  const body = await request.json().catch(() => null);
  const known = body && (body.kind === 'rpc' || (body.kind === 'query' && body.spec && typeof body.spec.table === 'string'));
  if (!known) return NextResponse.json(failed('That is not a query'));
  if (body.kind === 'query' && !Array.isArray(body.spec.filters)) body.spec.filters = [];
  return NextResponse.json(await execute(body, await identityOf(request)));
}
