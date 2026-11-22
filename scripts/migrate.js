#!/usr/bin/env node
// Brings the database up to date. It runs before the server starts, and is safe to run again.
//
// The schema is the one in supabase/migrations, unchanged, between two files of db/:
// 000_base.sql gives a plain Postgres what those migrations expect from Supabase, and
// the numbered files after it are this fork's own changes.

const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const root = path.join(__dirname, '..');
const upstream = path.join(root, 'supabase', 'migrations');

// The upstream files do not replay in the order of their names. The four with the oldest
// dates change tables that later files create, so they run after those. Three were
// replaced by the file that follows each, whose own comment says the first did not apply.
const LATE = (name) => name < '20250621';
const SUPERSEDED = [
  '20250621180532_snowy_lodge.sql', // then 20250621180724_heavy_darkness.sql
  '20250621180641_misty_math.sql', // then 20250621180724_heavy_darkness.sql
  '20250621182625_patient_boat.sql', // then 20250621182708_precious_credit.sql
];

function plan() {
  const own = fs.readdirSync(path.join(root, 'db')).filter((f) => f.endsWith('.sql')).sort();
  const theirs = fs.readdirSync(upstream).filter((f) => f.endsWith('.sql') && !SUPERSEDED.includes(f)).sort();
  const core = theirs.filter((f) => f.startsWith('20250621'));
  const late = theirs.filter(LATE);
  const after = theirs.filter((f) => f > '20250622');
  return [
    ...own.filter((f) => f.startsWith('000')).map((f) => ['db', f]),
    ...[...core, ...late, ...after].map((f) => ['supabase/migrations', f]),
    ...own.filter((f) => !f.startsWith('000')).map((f) => ['db', f]),
  ];
}

async function connect() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set');
  // The database container may still be starting.
  for (let attempt = 1; ; attempt++) {
    const client = new Client({ connectionString: process.env.DATABASE_URL });
    try {
      await client.connect();
      return client;
    } catch (error) {
      await client.end().catch(() => {});
      if (attempt >= 30) throw error;
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
}

async function main() {
  const client = await connect();
  try {
    // Outside `public`, which is the only schema the app's query route reads.
    await client.query('CREATE SCHEMA IF NOT EXISTS kanba');
    await client.query(
      'CREATE TABLE IF NOT EXISTS kanba.migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())'
    );
    const done = new Set((await client.query('SELECT name FROM kanba.migrations')).rows.map((row) => row.name));
    let applied = 0;
    for (const [folder, file] of plan()) {
      const name = `${folder}/${file}`;
      if (done.has(name)) continue;
      const sql = fs.readFileSync(path.join(root, folder, file), 'utf8');
      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query('INSERT INTO kanba.migrations (name) VALUES ($1)', [name]);
        await client.query('COMMIT');
        applied++;
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw new Error(`${name} did not apply: ${error.message}`);
      }
    }
    console.log(applied ? `kanba: applied ${applied} migrations` : 'kanba: the database is up to date');
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(`kanba: ${error.message}`);
  process.exit(1);
});
