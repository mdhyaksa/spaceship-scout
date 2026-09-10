import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { LOCAL_DB } from '../db/db-node.ts';

/**
 * Seed once, before any test file loads.
 *
 * Test files open the database at module scope, so leaving each one to seed
 * on demand means several of them race to build the same file on a clean
 * clone and the first `npm test` fails. Seeding here serialises it.
 */
export default function setup() {
  if (!existsSync(LOCAL_DB)) {
    execFileSync('npx', ['tsx', 'db/seed.ts'], { stdio: 'inherit' });
  }
}
