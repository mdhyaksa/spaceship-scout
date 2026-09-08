/**
 * CSV -> SQLite. Idempotent: the schema drops and recreates both tables.
 *
 *   npm run db:local              build db/local.sqlite for dev and tests
 *   tsx db/seed.ts --emit-sql     print INSERTs for `wrangler d1 execute`
 */
import BetterSqlite3 from 'better-sqlite3';
import { readFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const CSV = join(root, 'mock_logistics_data.csv');
const SCHEMA = join(here, 'schema.sql');
const OUT = join(here, 'local.sqlite');

/** RFC 4180 enough for this file: quoted fields containing commas, such as
 *  "London, UK", and doubled quotes inside them. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else { quoted = false; }
      } else field += c;
      continue;
    }
    if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.length > 1);
}

const COLUMNS = [
  'order_id', 'client_id', 'order_date', 'delivery_date', 'carrier', 'origin_city',
  'destination_city', 'status', 'sku', 'product_category', 'quantity', 'unit_price_usd',
  'order_value_usd', 'is_promo', 'promo_discount_pct', 'region', 'warehouse',
] as const;

const NUMERIC = new Set(['quantity', 'unit_price_usd', 'order_value_usd', 'is_promo', 'promo_discount_pct']);

const [header, ...body] = parseCsv(readFileSync(CSV, 'utf8'));
const index = Object.fromEntries(header!.map((h, i) => [h.trim(), i]));

const records = body.map((cells) =>
  COLUMNS.map((col) => {
    const raw = (cells[index[col]!] ?? '').trim();
    // Empty delivery_date means the order has not been delivered, not "".
    if (raw === '') return null;
    return NUMERIC.has(col) ? Number(raw) : raw;
  }),
);

const schema = readFileSync(SCHEMA, 'utf8');

if (process.argv.includes('--emit-sql')) {
  const lit = (v: string | number | null) =>
    v === null ? 'NULL' : typeof v === 'number' ? String(v) : `'${v.replace(/'/g, "''")}'`;
  const out = [schema];
  for (let i = 0; i < records.length; i += 50) {
    const chunk = records.slice(i, i + 50);
    out.push(
      `INSERT INTO fct_orders (${COLUMNS.join(', ')}) VALUES\n` +
        chunk.map((r) => `  (${r.map(lit).join(', ')})`).join(',\n') + ';',
    );
  }
  process.stdout.write(out.join('\n') + '\n');
} else {
  rmSync(OUT, { force: true });
  rmSync(`${OUT}-wal`, { force: true });
  rmSync(`${OUT}-shm`, { force: true });
  const db = new BetterSqlite3(OUT);
  db.exec(schema);
  const insert = db.prepare(
    `INSERT INTO fct_orders (${COLUMNS.join(', ')}) VALUES (${COLUMNS.map(() => '?').join(', ')})`,
  );
  db.transaction(() => records.forEach((r) => insert.run(...r)))();
  const { n } = db.prepare('SELECT COUNT(*) AS n FROM fct_orders').get() as { n: number };
  console.log(`seeded ${n} orders -> db/local.sqlite`);
  db.close();
}
