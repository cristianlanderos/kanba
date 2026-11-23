import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { COOKIE } from '@/lib/server/auth';

export const dynamic = 'force-dynamic';

/**
 * This server is one team's board, not the product's website, so it has no landing page.
 * Someone signed in goes to their dashboard. Anyone else starts at the sign-up form,
 * which links to the login for those who already have an account.
 */
export default function Home() {
  redirect(cookies().has(COOKIE) ? '/dashboard' : '/signup');
}
