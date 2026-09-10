import { nodeDatabase } from '../db/db-node.ts';

/** The database is seeded once by tests/globalSetup.ts before any test file
 *  loads, so this just opens it. */
export function db() {
  return nodeDatabase();
}

export const ALL_TIME = {
  kind: 'all_time' as const, n: null, unit: null, complete_periods: null, start: null, end: null,
};
