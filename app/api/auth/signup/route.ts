import { NextRequest, NextResponse } from 'next/server';
import { AuthError, sameOrigin, sessionOf, signUp, startSession } from '@/lib/server/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Makes an account and signs the browser in. There is no email to confirm: the server sends none. */
export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) return NextResponse.json({ error: 'This request came from another site' }, { status: 403 });
  const body = await request.json().catch(() => ({}));
  try {
    const user = await signUp(body.email, body.password, body.options?.data);
    const response = NextResponse.json({ user, session: sessionOf(user) });
    await startSession(request, response, user);
    return response;
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error('kanba: sign-up failed', error);
    return NextResponse.json({ error: 'The server could not create the account' }, { status: 500 });
  }
}
