// Accounts and sign-in, in the app's own database: what Supabase Auth did for it.
//
// A user is a row in `auth.users`, the table the migrations already reference, so the
// trigger that makes a profile for every new user still fires. A password is kept as a
// salted scrypt hash. A browser is signed in by an HttpOnly cookie that holds a random
// secret, and the database keeps only that secret's SHA-256.

import { createHash, randomBytes, scrypt, timingSafeEqual } from 'crypto';
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import type { Identity } from './db';
import { pool } from './db';

export const COOKIE = 'kanba_session';
const SESSION_DAYS = 30;
const MIN_PASSWORD = 8;

// scrypt's cost. Kept in each hash, so it can rise later without locking anyone out.
const COST = { N: 32768, r: 8, p: 1 };

function derive(password: string, salt: Buffer, cost: { N: number; r: number; p: number }): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password.normalize('NFKC'), salt, 64, { ...cost, maxmem: 128 * 1024 * 1024 }, (error, key) =>
      error ? reject(error) : resolve(key)
    );
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(password, salt, COST);
  return ['scrypt', COST.N, COST.r, COST.p, salt.toString('hex'), key.toString('hex')].join('$');
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, N, r, p, salt, hash] = stored.split('$');
  if (scheme !== 'scrypt' || !hash) return false;
  const expected = Buffer.from(hash, 'hex');
  const key = await derive(password, Buffer.from(salt, 'hex'), { N: Number(N), r: Number(r), p: Number(p) }).catch(
    () => null
  );
  return !!key && key.length === expected.length && timingSafeEqual(key, expected);
}

const digest = (secret: string) => createHash('sha256').update(secret).digest('hex');

/** A user as the screens read one: the shape Supabase gave them. */
export type AuthUser = {
  id: string;
  email: string;
  aud: 'authenticated';
  role: 'authenticated';
  app_metadata: Record<string, any>;
  user_metadata: Record<string, any>;
  created_at: string;
};

function toUser(row: any): AuthUser {
  return {
    id: row.id,
    email: row.email,
    aud: 'authenticated',
    role: 'authenticated',
    app_metadata: { provider: 'email' },
    user_metadata: row.raw_user_meta_data || {},
    created_at: new Date(row.created_at).toISOString(),
  };
}

/** What the screens call a session. There is no token for a script to read: the cookie signs requests. */
export function sessionOf(user: AuthUser) {
  return { user, access_token: 'cookie', token_type: 'bearer', expires_in: SESSION_DAYS * 86400 };
}

export class AuthError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

const cleanEmail = (email: unknown) => String(email || '').trim().toLowerCase();

/** Open by default, so the first people can join. Set KANBA_ALLOW_SIGNUP=false once they have. */
export const signupOpen = () => (process.env.KANBA_ALLOW_SIGNUP || 'true').toLowerCase() !== 'false';

export async function signUp(email: unknown, password: unknown, metadata: Record<string, any> = {}): Promise<AuthUser> {
  if (!signupOpen()) throw new AuthError('New accounts are turned off on this server', 403);
  const address = cleanEmail(email);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) throw new AuthError('Enter a valid email address');
  if (typeof password !== 'string' || password.length < MIN_PASSWORD) {
    throw new AuthError(`Password should be at least ${MIN_PASSWORD} characters`);
  }
  const fullName = typeof metadata?.full_name === 'string' ? metadata.full_name.trim().slice(0, 200) : '';
  const hash = await hashPassword(password);
  const db = pool();
  try {
    // The migrations' trigger on this table makes the user's profile in the same statement.
    const made = await db.query(
      'INSERT INTO auth.users (email, encrypted_password, raw_user_meta_data) VALUES ($1, $2, $3) RETURNING *',
      [address, hash, JSON.stringify(fullName ? { full_name: fullName } : {})]
    );
    const user = toUser(made.rows[0]);
    // A self-hosted board has nobody to bill, so nobody is held to the free plan's one project.
    const plan = (process.env.KANBA_DEFAULT_PLAN || 'pro').toLowerCase();
    if (plan === 'pro') {
      await db.query("UPDATE public.profiles SET subscription_status = 'pro' WHERE id = $1", [user.id]);
    }
    return user;
  } catch (error: any) {
    if (error?.code === '23505') throw new AuthError('User already registered', 422);
    throw error;
  }
}

export async function signIn(email: unknown, password: unknown): Promise<AuthUser> {
  const found = await pool().query('SELECT * FROM auth.users WHERE lower(email) = $1', [cleanEmail(email)]);
  const row = found.rows[0];
  // A wrong address costs the same work as a wrong password, so timing tells them apart no better.
  const stored = row ? row.encrypted_password : `scrypt$${COST.N}$${COST.r}$${COST.p}$00$00`;
  const matches = await verifyPassword(typeof password === 'string' ? password : '', stored);
  if (!row || !matches) throw new AuthError('Invalid login credentials', 400);
  return toUser(row);
}

/** Starts a session for `user` and puts its cookie on `response`. */
export async function startSession(request: NextRequest, response: NextResponse, user: AuthUser): Promise<void> {
  const secret = randomBytes(32).toString('hex');
  const db = pool();
  await db.query(`DELETE FROM auth.sessions WHERE created_at < now() - interval '${SESSION_DAYS} days'`);
  await db.query('INSERT INTO auth.sessions (token, user_id) VALUES ($1, $2)', [digest(secret), user.id]);
  response.cookies.set(COOKIE, secret, cookieOptions(request, SESSION_DAYS * 86400));
}

function cookieOptions(request: NextRequest, maxAge: number) {
  // `Secure` only when the board is reached over HTTPS: on a home network it is plain HTTP.
  const https = request.nextUrl.protocol === 'https:' || request.headers.get('x-forwarded-proto') === 'https';
  return { httpOnly: true, sameSite: 'lax' as const, secure: https, path: '/', maxAge };
}

export async function endSession(request: NextRequest, response: NextResponse): Promise<void> {
  const secret = request.cookies.get(COOKIE)?.value;
  if (secret) await pool().query('DELETE FROM auth.sessions WHERE token = $1', [digest(secret)]);
  response.cookies.set(COOKIE, '', cookieOptions(request, 0));
}

export async function currentUser(request: NextRequest): Promise<AuthUser | null> {
  const secret = request.cookies.get(COOKIE)?.value;
  if (!secret) return null;
  const found = await pool().query(
    `SELECT u.* FROM auth.sessions s JOIN auth.users u ON u.id = s.user_id
      WHERE s.token = $1 AND s.created_at > now() - interval '${SESSION_DAYS} days'`,
    [digest(secret)]
  );
  return found.rows[0] ? toUser(found.rows[0]) : null;
}

/** Who a request's queries run as: the signed-in user, or `anon`, who sees only what is public. */
export async function identityOf(request: NextRequest): Promise<Identity> {
  const user = await currentUser(request);
  return user ? { role: 'authenticated', userId: user.id, email: user.email } : { role: 'anon' };
}

/**
 * A browser sends `Origin` with every POST. One from another site is turned away, so a page
 * elsewhere cannot act for a signed-in user. Scripts and servers, which send none, pass.
 */
export function sameOrigin(request: NextRequest): boolean {
  const origin = request.headers.get('origin');
  if (!origin) return true;
  const host = request.headers.get('x-forwarded-host') || request.headers.get('host');
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

// Wrong passwords one address may send before it waits. In memory: a restart forgives.
const FAILURES = 10;
const WINDOW = 5 * 60 * 1000;
const failures = new Map<string, { count: number; since: number }>();

const addressOf = (request: NextRequest) =>
  (request.headers.get('x-forwarded-for') || '').split(',')[0].trim() || request.ip || 'local';

export function lockedOut(request: NextRequest): boolean {
  const now = Date.now();
  failures.forEach((entry, key) => {
    if (now - entry.since > WINDOW) failures.delete(key);
  });
  return (failures.get(addressOf(request))?.count || 0) >= FAILURES;
}

export function noteFailure(request: NextRequest): void {
  const key = addressOf(request);
  const entry = failures.get(key) || { count: 0, since: Date.now() };
  entry.count++;
  failures.set(key, entry);
}
