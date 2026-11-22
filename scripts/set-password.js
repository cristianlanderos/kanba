#!/usr/bin/env node
// Sets a user's password from the server's own shell, for one who forgot it: the app
// sends no email. It also signs that user out everywhere.
//
//   node scripts/set-password.js ana@example.com
//
// The new password is read from the terminal, and shown as it is typed.

const crypto = require('crypto');
const readline = require('readline');
const { Client } = require('pg');

// The same parameters and format as lib/server/auth.ts.
const COST = { N: 32768, r: 8, p: 1 };

function hash(password) {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(password.normalize('NFKC'), salt, 64, { ...COST, maxmem: 128 * 1024 * 1024 });
  return ['scrypt', COST.N, COST.r, COST.p, salt.toString('hex'), key.toString('hex')].join('$');
}

async function main() {
  const email = String(process.argv[2] || '').trim().toLowerCase();
  if (!email) throw new Error('pass the email of the account: node scripts/set-password.js ana@example.com');
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set');
  const terminal = readline.createInterface({ input: process.stdin, output: process.stderr });
  const password = await new Promise((resolve) => terminal.question('New password (shown as you type): ', resolve));
  terminal.close();
  if (password.length < 8) throw new Error('the password needs at least 8 characters');

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    const changed = await client.query(
      'UPDATE auth.users SET encrypted_password = $1, updated_at = now() WHERE lower(email) = $2 RETURNING id',
      [hash(password), email]
    );
    if (!changed.rowCount) throw new Error(`there is no account for ${email}`);
    await client.query('DELETE FROM auth.sessions WHERE user_id = $1', [changed.rows[0].id]);
    console.log(`Changed the password of ${email}, and signed them out everywhere.`);
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(`kanba: ${error.message}`);
  process.exit(1);
});
