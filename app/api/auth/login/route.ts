import { NextRequest, NextResponse } from 'next/server';
import { AuthError, lockedOut, noteFailure, sameOrigin, sessionOf, signIn, startSession } from '@/lib/server/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) return NextResponse.json({ error: 'This request came from another site' }, { status: 403 });
  if (lockedOut(request)) {
    return NextResponse.json({ error: 'Too many wrong passwords. Wait a few minutes.' }, { status: 429 });
  }
  const body = await request.json().catch(() => ({}));
  try {
    const user = await signIn(body.email, body.password);
    const response = NextResponse.json({ user, session: sessionOf(user) });
    await startSession(request, response, user);
    return response;
  } catch (error) {
    if (error instanceof AuthError) {
      noteFailure(request);
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error('kanba: sign-in failed', error);
    return NextResponse.json({ error: 'The server could not sign you in' }, { status: 500 });
  }
}
