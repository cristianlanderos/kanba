// The query builder the app's screens were written against, without Supabase behind it.
//
// It keeps the method names of supabase-js (`from().select().eq()…`, `rpc()`), so the
// screens did not change. A builder only describes a query. The description goes to an
// executor: in the browser that is a POST to /api/db, on the server a direct call into
// lib/server/query.ts. Either way the query runs in this app's own Postgres, under the
// row level security policies of supabase/migrations.

export type QueryError = {
  message: string;
  code?: string;
  details?: string | null;
  hint?: string | null;
};

export type QueryResult<T = any> = {
  data: T | null;
  error: QueryError | null;
  count: number | null;
  status: number;
  statusText: string;
};

export type Filter = {
  column: string;
  /** eq, neq, gt, gte, lt, lte, like, ilike, is or in. */
  op: string;
  value: any;
  negate?: boolean;
};

export type QuerySpec = {
  table: string;
  action: 'select' | 'insert' | 'update' | 'upsert' | 'delete';
  /** The select list, as PostgREST reads it: columns, and relations like `profiles:user_id (id, email)`. */
  columns?: string;
  /** A change that ends in `.select()` answers with the rows it changed. */
  returning?: boolean;
  values?: any;
  filters: Filter[];
  order?: { column: string; ascending: boolean }[];
  limit?: number;
  offset?: number;
  single?: 'single' | 'maybe';
  count?: boolean;
  head?: boolean;
  onConflict?: string;
};

export type DbRequest =
  | { kind: 'query'; spec: QuerySpec }
  | { kind: 'rpc'; name: string; args: Record<string, any> };

export type Executor = (request: DbRequest) => Promise<QueryResult>;

export function failed(message: string, code?: string): QueryResult {
  return { data: null, error: { message, code }, count: null, status: 400, statusText: 'Bad Request' };
}

export class QueryBuilder implements PromiseLike<QueryResult> {
  private spec: QuerySpec;

  constructor(private readonly execute: Executor, table: string) {
    this.spec = { table, action: 'select', filters: [] };
  }

  /** First on a builder it reads rows; after insert, update, upsert or delete it asks for the changed ones. */
  select(columns: string = '*', options?: { count?: 'exact' | 'planned' | 'estimated'; head?: boolean }): this {
    if (this.changes) {
      this.spec.returning = true;
    } else {
      this.spec.count = !!options?.count;
      this.spec.head = !!options?.head;
    }
    this.spec.columns = columns;
    return this;
  }

  private changes = false;

  private change(action: QuerySpec['action'], values?: any): this {
    this.changes = true;
    this.spec.action = action;
    this.spec.values = values;
    return this;
  }

  insert(values: any): this {
    return this.change('insert', values);
  }

  update(values: any): this {
    return this.change('update', values);
  }

  upsert(values: any, options?: { onConflict?: string }): this {
    this.spec.onConflict = options?.onConflict;
    return this.change('upsert', values);
  }

  delete(): this {
    return this.change('delete');
  }

  filter(column: string, op: string, value: any): this {
    this.spec.filters.push({ column, op, value });
    return this;
  }

  not(column: string, op: string, value: any): this {
    this.spec.filters.push({ column, op, value, negate: true });
    return this;
  }

  eq(column: string, value: any): this {
    return this.filter(column, 'eq', value);
  }

  neq(column: string, value: any): this {
    return this.filter(column, 'neq', value);
  }

  gt(column: string, value: any): this {
    return this.filter(column, 'gt', value);
  }

  gte(column: string, value: any): this {
    return this.filter(column, 'gte', value);
  }

  lt(column: string, value: any): this {
    return this.filter(column, 'lt', value);
  }

  lte(column: string, value: any): this {
    return this.filter(column, 'lte', value);
  }

  like(column: string, pattern: string): this {
    return this.filter(column, 'like', pattern);
  }

  ilike(column: string, pattern: string): this {
    return this.filter(column, 'ilike', pattern);
  }

  is(column: string, value: null | boolean): this {
    return this.filter(column, 'is', value);
  }

  in(column: string, values: any[]): this {
    return this.filter(column, 'in', values);
  }

  match(values: Record<string, any>): this {
    Object.keys(values).forEach((column) => this.eq(column, values[column]));
    return this;
  }

  order(column: string, options?: { ascending?: boolean }): this {
    (this.spec.order = this.spec.order || []).push({ column, ascending: options?.ascending !== false });
    return this;
  }

  limit(count: number): this {
    this.spec.limit = count;
    return this;
  }

  range(from: number, to: number): this {
    this.spec.offset = from;
    this.spec.limit = to - from + 1;
    return this;
  }

  /** Exactly one row, as an object. None, or more than one, is an error. */
  single(): this {
    this.spec.single = 'single';
    return this;
  }

  /** One row as an object, or null when there is none. */
  maybeSingle(): this {
    this.spec.single = 'maybe';
    return this;
  }

  then<A = QueryResult, B = never>(
    resolve?: ((value: QueryResult) => A | PromiseLike<A>) | null,
    reject?: ((reason: any) => B | PromiseLike<B>) | null
  ): PromiseLike<A | B> {
    return this.execute({ kind: 'query', spec: this.spec }).then(resolve, reject);
  }
}

/** `from` and `rpc`, bound to an executor. */
export function queryClient(execute: Executor) {
  return {
    from: (table: string) => new QueryBuilder(execute, table),
    rpc: (name: string, args: Record<string, any> = {}): Promise<QueryResult> =>
      execute({ kind: 'rpc', name, args }),
  };
}
