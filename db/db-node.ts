/**
 * better-sqlite3 implementation of the Database interface.
 *
 * Node only - never imported by the Worker bundle. The compiler is built and
 * tested against this before D1 is touched, so dialect surprises surface on
 * the laptop rather than in a deploy (tech-stack.md section 9).
 */
import BetterSqlite3 from 'better-sqlite3';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { Database, Row } from '../worker/db.ts';

export const LOCAL_DB = join(dirname(fileURLToPath(import.meta.url)), 'local.sqlite');

export function nodeDatabase(path: string = LOCAL_DB): Database & { close(): void } {
  const db = new BetterSqlite3(path, { readonly: false });
  db.pragma('journal_mode = WAL');
  return {
    async run<T extends Row = Row>(sql: string, params: readonly unknown[] = []) {
      return db.prepare(sql).all(...(params as unknown[])) as T[];
    },
    close: () => db.close(),
  };
}
