/**
 * One method. D1 today, Neon or Postgres later, better-sqlite3 in tests.
 * Nothing above this interface knows which engine is underneath - that single
 * abstraction is what makes the production migration a swap rather than a
 * rewrite (tech-stack.md section 2.2).
 */
export type Row = Record<string, string | number | null>;

export interface Database {
  run<T extends Row = Row>(sql: string, params?: readonly unknown[]): Promise<T[]>;
}

/** Cloudflare D1. Read-only by construction: nothing in the request path ever
 *  issues DDL or DML against fct_orders. */
export function d1Database(db: D1Database): Database {
  return {
    async run<T extends Row = Row>(sql: string, params: readonly unknown[] = []) {
      const stmt = params.length ? db.prepare(sql).bind(...params) : db.prepare(sql);
      const { results } = await stmt.all<T>();
      return results ?? [];
    },
  };
}
