// The app's connection to its own Postgres, and the one way a request's query runs in it.

import { Pool, PoolClient } from 'pg';

declare global {
  // Kept across hot reloads in development, where this module is evaluated again and again.
  // eslint-disable-next-line no-var
  var kanbaPool: Pool | undefined;
}

export function pool(): Pool {
  if (!global.kanbaPool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error('DATABASE_URL is not set: point it at the Postgres database Kanba keeps its data in');
    }
    global.kanbaPool = new Pool({ connectionString, max: 10 });
  }
  return global.kanbaPool;
}

/**
 * Who a query runs as. The row level security policies read it: `anon` and `authenticated`
 * see what the policies allow, and `service_role`, for the server's own work, sees all.
 */
export type Identity =
  | { role: 'anon' }
  | { role: 'authenticated'; userId: string; email: string }
  | { role: 'service_role' };

/**
 * Runs `work` in one transaction as `identity`. The role and the claims are set for that
 * transaction only, so a pooled connection never carries one request's user to the next.
 */
export async function asIdentity<T>(identity: Identity, work: (client: PoolClient) => Promise<T>): Promise<T> {
  const claims: Record<string, string> = { role: identity.role };
  if (identity.role === 'authenticated') {
    claims.sub = identity.userId;
    claims.email = identity.email;
  }
  const client = await pool().connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('request.jwt.claims', $1, true), set_config('role', $2, true)", [
      JSON.stringify(claims),
      identity.role,
    ]);
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}
