import { NextRequest, NextResponse } from 'next/server';
import { endSession, sameOrigin } from '@/lib/server/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) return NextResponse.json({ error: 'This request came from another site' }, { status: 403 });
  const response = NextResponse.json({});
  await endSession(request, response);
  return response;
}
