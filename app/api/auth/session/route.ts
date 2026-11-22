import { NextRequest, NextResponse } from 'next/server';
import { currentUser, sessionOf, signupOpen } from '@/lib/server/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Who this browser is signed in as, if anyone. */
export async function GET(request: NextRequest) {
  const user = await currentUser(request);
  return NextResponse.json({ user, session: user ? sessionOf(user) : null, signup: signupOpen() });
}
