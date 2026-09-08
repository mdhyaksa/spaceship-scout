import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { nodeDatabase, LOCAL_DB } from '../db/db-node.ts';

/** Seed once if the local database is missing, so `npm test` works on a fresh
 *  clone without a separate setup step. */
export function db() {
  if (!existsSync(LOCAL_DB)) {
    execFileSync('npx', ['tsx', 'db/seed.ts'], { stdio: 'inherit' });
  }
  return nodeDatabase();
}

export const ALL_TIME = {
  kind: 'all_time' as const, n: null, unit: null, complete_periods: null, start: null, end: null,
};
