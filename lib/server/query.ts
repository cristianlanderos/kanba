// Turns a query description from lib/query-builder.ts into SQL and runs it.
//
// This is the part of Supabase's data service (PostgREST) the app uses, and no more.
// Two rules keep it safe to take descriptions from a browser:
//   - every table, column and function name is looked up in the database's own catalog
//     and then quoted, so a name can never carry SQL;
//   - every value travels as a query parameter.
// Which rows a user may read or change is not decided here: the query runs as that user
// (see asIdentity), and the policies in supabase/migrations decide.

import type { PoolClient } from 'pg';
import type { DbRequest, Filter, QueryError, QueryResult, QuerySpec } from '../query-builder';
import { asIdentity, Identity, pool } from './db';

type Column = { type: string };
type ForeignKey = { table: string; column: string; toSchema: string; toTable: string; toColumn: string };
type Fn = { args: string[]; set: boolean; composite: boolean };

type Catalog = {
  loaded: number;
  /** Tables and views of the `public` schema, each with its columns. */
  tables: Map<string, Map<string, Column>>;
  keys: Map<string, string[]>;
  foreignKeys: ForeignKey[];
  functions: Map<string, Fn>;
};

let catalog: Catalog | null = null;
/** A migration can run under a live server: after this long the catalog is read again. */
const CATALOG_AGE = 60_000;

async function loadCatalog(): Promise<Catalog> {
  const db = pool();
  const [columns, keys, foreignKeys, functions] = await Promise.all([
    db.query(
      `SELECT c.relname AS table, a.attname AS column, format_type(a.atttypid, a.atttypmod) AS type
         FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind IN ('r', 'v', 'm', 'p') AND a.attnum > 0 AND NOT a.attisdropped`
    ),
    db.query(
      `SELECT c.relname AS table, a.attname AS column
         FROM pg_index i JOIN pg_class c ON c.oid = i.indrelid JOIN pg_namespace n ON n.oid = c.relnamespace
         JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = ANY (i.indkey)
        WHERE n.nspname = 'public' AND i.indisprimary`
    ),
    db.query(
      `SELECT c.relname AS table, a.attname AS column, tn.nspname AS to_schema, t.relname AS to_table, ta.attname AS to_column
         FROM pg_constraint k JOIN pg_class c ON c.oid = k.conrelid JOIN pg_namespace n ON n.oid = c.relnamespace
         JOIN pg_class t ON t.oid = k.confrelid JOIN pg_namespace tn ON tn.oid = t.relnamespace
         JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = k.conkey[1]
         JOIN pg_attribute ta ON ta.attrelid = t.oid AND ta.attnum = k.confkey[1]
        WHERE n.nspname = 'public' AND k.contype = 'f' AND array_length(k.conkey, 1) = 1`
    ),
    db.query(
      `SELECT p.proname AS name, coalesce(p.proargnames[1:p.pronargs], '{}') AS args, p.proretset AS set,
              t.typtype = 'c' OR p.prorettype = 'record'::regtype AS composite
         FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace JOIN pg_type t ON t.oid = p.prorettype
        WHERE n.nspname = 'public' AND p.prokind = 'f' AND p.prorettype <> 'trigger'::regtype`
    ),
  ]);
  const next: Catalog = { loaded: Date.now(), tables: new Map(), keys: new Map(), foreignKeys: [], functions: new Map() };
  for (const row of columns.rows) {
    if (!next.tables.has(row.table)) next.tables.set(row.table, new Map());
    next.tables.get(row.table)!.set(row.column, { type: row.type });
  }
  for (const row of keys.rows) {
    next.keys.set(row.table, [...(next.keys.get(row.table) || []), row.column]);
  }
  next.foreignKeys = foreignKeys.rows.map((row) => ({
    table: row.table,
    column: row.column,
    toSchema: row.to_schema,
    toTable: row.to_table,
    toColumn: row.to_column,
  }));
  for (const row of functions.rows) {
    next.functions.set(row.name, { args: row.args, set: row.set, composite: row.composite });
  }
  return next;
}

async function getCatalog(): Promise<Catalog> {
  if (!catalog || Date.now() - catalog.loaded > CATALOG_AGE) {
    catalog = await loadCatalog();
  }
  return catalog;
}

/** What the caller asked for is wrong; the message goes back to them as it is. */
class Refused extends Error {
  constructor(message: string, readonly code = 'PGRST100') {
    super(message);
  }
}

const quote = (name: string) => `"${name.replace(/"/g, '""')}"`;

class Statement {
  readonly values: any[] = [];

  constructor(readonly catalog: Catalog, readonly table: string) {
    if (!catalog.tables.has(table)) {
      throw new Refused(`relation "public.${table}" does not exist`, '42P01');
    }
  }

  get columns(): Map<string, Column> {
    return this.catalog.tables.get(this.table)!;
  }

  column(name: string, of: string = this.table): string {
    if (!this.catalog.tables.get(of)?.has(name)) {
      throw new Refused(`column ${of}.${name} does not exist`, '42703');
    }
    return quote(name);
  }

  bind(value: any): string {
    this.values.push(value);
    return `$${this.values.length}`;
  }

  /** A value for `column`, as the driver must send it: JSON columns take text, the rest go as they are. */
  bindFor(column: string, value: any): string {
    const type = this.columns.get(column)!.type;
    const json = type === 'json' || type === 'jsonb';
    return this.bind(json && value !== null && value !== undefined ? JSON.stringify(value) : value);
  }

  where(filters: Filter[]): string {
    const clauses = filters.map((filter) => {
      const clause = this.filter(filter);
      return filter.negate ? `NOT (${clause})` : clause;
    });
    return clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '';
  }

  private filter({ column, op, value }: Filter): string {
    const target = `base.${this.column(column)}`;
    const compare: Record<string, string> = { eq: '=', neq: '<>', gt: '>', gte: '>=', lt: '<', lte: '<=' };
    if (compare[op]) return `${target} ${compare[op]} ${this.bind(value)}`;
    switch (op) {
      case 'like':
        return `${target}::text LIKE ${this.bind(String(value).replace(/\*/g, '%'))}`;
      case 'ilike':
        return `${target}::text ILIKE ${this.bind(String(value).replace(/\*/g, '%'))}`;
      case 'is':
        if (value === null || value === 'null') return `${target} IS NULL`;
        if (value === true || value === 'true') return `${target} IS TRUE`;
        if (value === false || value === 'false') return `${target} IS FALSE`;
        throw new Refused('is takes null, true or false');
      case 'in':
        if (!Array.isArray(value)) throw new Refused('in takes a list');
        return `${target} = ANY (${this.bind(value)})`;
      default:
        throw new Refused(`unknown filter ${op}`);
    }
  }
}

/** Splits a select list on the commas that are not inside a relation's parentheses. */
function splitList(list: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let part = '';
  for (const char of list) {
    if (char === '(') depth++;
    if (char === ')') depth--;
    if (char === ',' && depth === 0) {
      parts.push(part);
      part = '';
    } else {
      part += char;
    }
  }
  parts.push(part);
  return parts.map((p) => p.trim()).filter(Boolean);
}

const NAME = '[A-Za-z_][A-Za-z0-9_]*';
const RELATION = new RegExp(`^(?:(${NAME})\\s*:\\s*)?(${NAME})\\s*(!inner|!left)?\\s*\\(([\\s\\S]*)\\)$`);
const COLUMN = new RegExp(`^(?:(${NAME})\\s*:\\s*)?(${NAME})$`);

/**
 * The select list as SQL over the row alias `base`, plus the conditions `!inner` relations
 * add. A relation is found through a foreign key, either by the column that holds it,
 * `profiles:user_id (…)`, or by the other table's name, `project_members!inner (…)`.
 */
function selectList(statement: Statement, list: string): { sql: string; inner: string[] } {
  const { catalog, table } = statement;
  const inner: string[] = [];
  const items = splitList(list || '*').map((item) => {
    if (item === '*') return 'base.*';
    const relation = item.match(RELATION);
    if (!relation) {
      const column = item.match(COLUMN);
      if (!column) throw new Refused(`cannot read "${item}" in the select list`);
      const [, alias, name] = column;
      return `base.${statement.column(name)}${alias ? ` AS ${quote(alias)}` : ''}`;
    }
    const [, alias, name, join, inside] = relation;
    const label = quote(alias || name);
    const fields = splitList(inside || '*');

    let other: string;
    let on: string;
    let many = false;
    if (statement.columns.has(name)) {
      // By the column that points at the other row.
      const key = catalog.foreignKeys.find((k) => k.table === table && k.column === name && k.toSchema === 'public');
      other = key ? key.toTable : alias || '';
      if (!catalog.tables.has(other)) throw new Refused(`no relation through ${table}.${name}`, 'PGRST200');
      on = `related.${statement.column(key ? key.toColumn : 'id', other)} = base.${quote(name)}`;
    } else if (catalog.tables.has(name)) {
      other = name;
      const child = catalog.foreignKeys.find((k) => k.table === name && k.toSchema === 'public' && k.toTable === table);
      const parent = catalog.foreignKeys.find((k) => k.table === table && k.toSchema === 'public' && k.toTable === name);
      if (child) {
        many = true;
        on = `related.${quote(child.column)} = base.${quote(child.toColumn)}`;
      } else if (parent) {
        on = `related.${quote(parent.toColumn)} = base.${quote(parent.column)}`;
      } else {
        throw new Refused(`no relation between ${table} and ${name}`, 'PGRST200');
      }
    } else {
      throw new Refused(`no relation "${name}" on ${table}`, 'PGRST200');
    }

    const picked = fields
      .map((field) => {
        if (field === '*') return 'related.*';
        if (!COLUMN.test(field) || field.includes(':')) throw new Refused(`cannot read "${field}" of ${other}`);
        return `related.${statement.column(field, other)}`;
      })
      .join(', ');
    const from = `FROM public.${quote(other)} AS related WHERE ${on}`;
    if (join === '!inner') inner.push(`EXISTS (SELECT 1 ${from})`);
    return many
      ? `(SELECT coalesce(json_agg(row_to_json(found)), '[]'::json) FROM (SELECT ${picked} ${from}) found) AS ${label}`
      : `(SELECT row_to_json(found) FROM (SELECT ${picked} ${from} LIMIT 1) found) AS ${label}`;
  });
  return { sql: items.join(', '), inner };
}

/** Rows leave as JSON built by Postgres, so dates and times are ISO text, as the screens expect. */
const asJson = (rows: string) => `SELECT coalesce(json_agg(row_to_json(q)), '[]'::json) AS rows FROM (${rows}) q`;

function tail(statement: Statement, spec: QuerySpec): string {
  let sql = '';
  if (spec.order?.length) {
    const terms = spec.order.map((o) => `base.${statement.column(o.column)} ${o.ascending ? 'ASC' : 'DESC'}`);
    sql += ` ORDER BY ${terms.join(', ')}`;
  }
  if (spec.limit !== undefined) sql += ` LIMIT ${Math.max(0, Math.floor(Number(spec.limit)) || 0)}`;
  if (spec.offset !== undefined) sql += ` OFFSET ${Math.max(0, Math.floor(Number(spec.offset)) || 0)}`;
  return sql;
}

function selectSql(statement: Statement, spec: QuerySpec, countOnly: boolean): string {
  const from = `FROM public.${quote(statement.table)} AS base`;
  const list = selectList(statement, spec.columns || '*');
  let where = statement.where(spec.filters);
  for (const exists of list.inner) where += `${where ? ' AND' : ' WHERE'} ${exists}`;
  if (countOnly) return `SELECT count(*)::int AS count ${from}${where}`;
  return asJson(`SELECT ${list.sql} ${from}${where}${tail(statement, spec)}`);
}

function changeSql(statement: Statement, spec: QuerySpec): string {
  const table = `public.${quote(statement.table)}`;
  let sql: string;
  if (spec.action === 'delete') {
    sql = `DELETE FROM ${table} AS base${statement.where(spec.filters)}`;
  } else if (spec.action === 'update') {
    const values = spec.values || {};
    const sets = Object.keys(values).map((key) => `${statement.column(key)} = ${statement.bindFor(key, values[key])}`);
    if (!sets.length) throw new Refused('nothing to update');
    sql = `UPDATE ${table} AS base SET ${sets.join(', ')}${statement.where(spec.filters)}`;
  } else {
    const rows: Record<string, any>[] = Array.isArray(spec.values) ? spec.values : [spec.values || {}];
    const keys = Array.from(new Set(rows.flatMap((row) => Object.keys(row))));
    if (!rows.length || !keys.length) throw new Refused('nothing to insert');
    const names = keys.map((key) => statement.column(key));
    const tuples = rows.map(
      (row) => `(${keys.map((key) => (key in row ? statement.bindFor(key, row[key]) : 'DEFAULT')).join(', ')})`
    );
    sql = `INSERT INTO ${table} AS base (${names.join(', ')}) VALUES ${tuples.join(', ')}`;
    if (spec.action === 'upsert') {
      const target = spec.onConflict
        ? spec.onConflict.split(',').map((name) => name.trim())
        : statement.catalog.keys.get(statement.table) || [];
      if (!target.length) throw new Refused(`upsert needs onConflict: ${statement.table} has no primary key`);
      const conflict = target.map((name) => statement.column(name));
      const updates = names.filter((name) => !conflict.includes(name)).map((name) => `${name} = EXCLUDED.${name}`);
      sql += ` ON CONFLICT (${conflict.join(', ')}) ${updates.length ? `DO UPDATE SET ${updates.join(', ')}` : 'DO NOTHING'}`;
    }
  }
  if (!spec.returning) return sql;
  // The changed rows become `base`, so the select list reads them like any other rows.
  const list = selectList(statement, spec.columns || '*');
  return `WITH changed AS (${sql} RETURNING base.*) ${asJson(`SELECT ${list.sql} FROM changed AS base`)}`;
}

function shape(rows: any[], spec: QuerySpec, count: number | null): QueryResult {
  const ok = { error: null, count, status: 200, statusText: 'OK' };
  if (!spec.single) return { data: rows, ...ok };
  if (rows.length === 1) return { data: rows[0], ...ok };
  if (rows.length === 0 && spec.single === 'maybe') return { data: null, ...ok };
  return {
    data: null,
    error: {
      message: 'JSON object requested, multiple (or no) rows returned',
      code: 'PGRST116',
      details: `The result contains ${rows.length} rows`,
      hint: null,
    },
    count,
    status: 406,
    statusText: 'Not Acceptable',
  };
}

async function runQuery(client: PoolClient, catalog: Catalog, spec: QuerySpec): Promise<QueryResult> {
  const statement = new Statement(catalog, spec.table);
  if (spec.action === 'select') {
    let count: number | null = null;
    if (spec.count) {
      const counting = new Statement(catalog, spec.table);
      count = (await client.query(selectSql(counting, spec, true), counting.values)).rows[0].count;
    }
    if (spec.head) return { data: null, error: null, count, status: 200, statusText: 'OK' };
    const found = await client.query(selectSql(statement, spec, false), statement.values);
    return shape(found.rows[0].rows, spec, count);
  }
  const changed = await client.query(changeSql(statement, spec), statement.values);
  if (!spec.returning) return { data: null, error: null, count: null, status: 204, statusText: 'No Content' };
  return shape(changed.rows[0].rows, spec, null);
}

async function runFunction(client: PoolClient, catalog: Catalog, name: string, args: Record<string, any>): Promise<QueryResult> {
  const fn = catalog.functions.get(name);
  if (!fn) throw new Refused(`function public.${name} does not exist`, 'PGRST202');
  const values: any[] = [];
  const passed = Object.keys(args || {}).map((arg) => {
    if (!fn.args.includes(arg)) throw new Refused(`function ${name} has no argument ${arg}`, 'PGRST202');
    values.push(args[arg]);
    return `${quote(arg)} => $${values.length}`;
  });
  const call = `public.${quote(name)}(${passed.join(', ')})`;
  const ok = { error: null, count: null, status: 200, statusText: 'OK' };
  if (fn.set) {
    const found = await client.query(asJson(`SELECT * FROM ${call}`), values);
    return { data: found.rows[0].rows, ...ok };
  }
  const sql = fn.composite ? `SELECT row_to_json(q) AS value FROM (SELECT * FROM ${call}) q` : `SELECT to_json(${call}) AS value`;
  const found = await client.query(sql, values);
  return { data: found.rows[0].value, ...ok };
}

function errorOf(error: any): QueryError {
  if (error instanceof Refused) return { message: error.message, code: error.code, details: null, hint: null };
  // An error from Postgres carries a five-character code. Anything else is this server's own fault.
  if (typeof error?.code === 'string' && error.code.length === 5) {
    return { message: error.message, code: error.code, details: error.detail || null, hint: error.hint || null };
  }
  console.error('kanba: query failed', error);
  return { message: 'The server could not run that query', code: 'KANBA500', details: null, hint: null };
}

/** Runs one request from a query builder as `identity`. It answers with an error, and never throws. */
export async function execute(request: DbRequest, identity: Identity): Promise<QueryResult> {
  try {
    const current = await getCatalog();
    return await asIdentity(identity, (client) =>
      request.kind === 'rpc'
        ? runFunction(client, current, String(request.name), request.args || {})
        : runQuery(client, current, request.spec)
    );
  } catch (error) {
    const failure = errorOf(error);
    const refused = error instanceof Refused || failure.code !== 'KANBA500';
    return { data: null, error: failure, count: null, status: refused ? 400 : 500, statusText: refused ? 'Bad Request' : 'Server Error' };
  }
}
