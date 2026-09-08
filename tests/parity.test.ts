import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { layer } from '../semantic/layer.generated.ts';
import { emptyIR, type QueryIR } from '../shared/ir.ts';
import { compile } from '../worker/compile.ts';
import { CARDS } from '../worker/tiles.ts';
import { db, ALL_TIME } from './helpers.ts';

/**
 * The data-correctness proof.
 *
 * Every figure is derived twice: once from the CSV in plain TypeScript, and
 * once by compiling an IR to SQL and running it against the seeded database.
 * The two derivations share no code. If the compiler drops a FILTER clause,
 * builds a ratio from the wrong denominator, or mishandles the 30 orders with
 * no delivery date, these tests fail rather than the dashboard quietly
 * reporting a plausible wrong number.
 */

interface Order {
  status: string;
  carrier: string;
  region: string;
  warehouse: string;
  product_category: string;
  lane: string;
  transit: number | null;
  quantity: number;
  value: number;
  discount: number;
}

const COMPLETED = new Set(['delivered', 'delayed', 'exception']);
let orders: Order[] = [];
const database = db();

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false; }
      else field += c;
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

beforeAll(() => {
  const [header, ...body] = parseCsv(readFileSync('mock_logistics_data.csv', 'utf8'));
  const at = Object.fromEntries(header!.map((h, i) => [h.trim(), i]));
  const day = 86_400_000;
  orders = body.map((c) => {
    const delivery = c[at['delivery_date']!]!.trim();
    const order = c[at['order_date']!]!.trim();
    return {
      status: c[at['status']!]!.trim(),
      carrier: c[at['carrier']!]!.trim(),
      region: c[at['region']!]!.trim(),
      warehouse: c[at['warehouse']!]!.trim(),
      product_category: c[at['product_category']!]!.trim(),
      lane: `${c[at['origin_city']!]!.trim()} -> ${c[at['destination_city']!]!.trim()}`,
      transit: delivery ? Math.round((Date.parse(delivery) - Date.parse(order)) / day) : null,
      quantity: Number(c[at['quantity']!]),
      value: Number(c[at['order_value_usd']!]),
      discount: Number(c[at['promo_discount_pct']!]),
    };
  });
});

async function run(ir: QueryIR) {
  const compiled = compile(ir, layer);
  return database.run(compiled.sql, compiled.params);
}

/** Discrete percentile: the smallest value whose cumulative share reaches p.
 *  Same definition the CUME_DIST CTE implements. */
function percentileDisc(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  const target = p * sorted.length;
  let seen = 0;
  for (const v of sorted) {
    seen++;
    if (seen >= target) return v;
  }
  return sorted[sorted.length - 1]!;
}

describe('SQL agrees with the CSV — scalars', () => {
  it('matches every KPI card', async () => {
    const completed = orders.filter((o) => COMPLETED.has(o.status));
    const expected = {
      order_count: orders.length,
      on_time_count: orders.filter((o) => o.status === 'delivered').length,
      delayed_count: orders.filter((o) => o.status === 'delayed').length,
      completed_count: completed.length,
      units_ordered: orders.reduce((s, o) => s + o.quantity, 0),
    };

    for (const card of CARDS) {
      const [row] = await run(card.ir([]));
      expect(row, card.id).toBeDefined();
      for (const [key, value] of Object.entries(expected)) {
        if (key in row!) expect(Number(row![key]), `${card.id}.${key}`).toBe(value);
      }
    }
  });

  it('computes rates on completed deliveries, not on delivered orders', async () => {
    const completed = orders.filter((o) => COMPLETED.has(o.status)).length;
    const delayed = orders.filter((o) => o.status === 'delayed').length;
    const delivered = orders.filter((o) => o.status === 'delivered').length;

    const [row] = await run(emptyIR({ metrics: ['delay_rate', 'on_time_rate'] }));
    expect(Number(row!['delay_rate'])).toBeCloseTo(delayed / completed, 12);
    expect(Number(row!['on_time_rate'])).toBeCloseTo(delivered / completed, 12);

    // The trap this metric exists to prevent: delayed / delivered inflates the
    // rate by excluding late orders from their own denominator.
    expect(delayed / completed).not.toBeCloseTo(delayed / delivered, 4);
  });

  it('excludes orders with no delivery date from transit metrics', async () => {
    const transits = orders.map((o) => o.transit).filter((t): t is number => t !== null);
    expect(orders.length - transits.length).toBe(30);

    const [row] = await run(emptyIR({ metrics: ['avg_transit_days', 'p90_transit_days', 'max_transit_days'] }));
    expect(Number(row!['avg_transit_days'])).toBeCloseTo(transits.reduce((a, b) => a + b, 0) / transits.length, 10);
    expect(Number(row!['p90_transit_days'])).toBe(percentileDisc(transits, 0.9));
    expect(Number(row!['max_transit_days'])).toBe(Math.max(...transits));
  });

  it('matches gross and net revenue', async () => {
    const [row] = await run(emptyIR({ metrics: ['gross_revenue', 'net_revenue', 'promo_discount_value'] }));
    const gross = orders.reduce((s, o) => s + o.value, 0);
    const net = orders.reduce((s, o) => s + o.value * (1 - o.discount / 100), 0);
    expect(Number(row!['gross_revenue'])).toBeCloseTo(gross, 6);
    expect(Number(row!['net_revenue'])).toBeCloseTo(net, 6);
    expect(Number(row!['promo_discount_value'])).toBeCloseTo(gross - net, 6);
  });
});

describe('SQL agrees with the CSV — breakdowns', () => {
  const dimensions: [string, (o: Order) => string][] = [
    ['carrier', (o) => o.carrier],
    ['region', (o) => o.region],
    ['warehouse', (o) => o.warehouse],
    ['product_category', (o) => o.product_category],
    ['lane', (o) => o.lane],
  ];

  it.each(dimensions)('matches delay rate and sample size by %s', async (dimension, key) => {
    const rows = await run(emptyIR({ metrics: ['delay_rate'], dimensions: [dimension], limit: 100 }));
    expect(rows.length).toBeGreaterThan(0);

    for (const row of rows) {
      const group = orders.filter((o) => key(o) === String(row[dimension]));
      const completed = group.filter((o) => COMPLETED.has(o.status)).length;
      const delayed = group.filter((o) => o.status === 'delayed').length;
      expect(Number(row['completed_count']), `${dimension}=${row[dimension]} n`).toBe(completed);
      expect(Number(row['delay_rate']), `${dimension}=${row[dimension]} rate`).toBeCloseTo(delayed / completed, 12);
    }
  });

  it.each(dimensions)('matches the percentile CTE by %s', async (dimension, key) => {
    const rows = await run(emptyIR({ metrics: ['p90_transit_days', 'avg_transit_days'], dimensions: [dimension], limit: 100 }));
    for (const row of rows) {
      const transits = orders
        .filter((o) => key(o) === String(row[dimension]))
        .map((o) => o.transit)
        .filter((t): t is number => t !== null);
      if (!transits.length) continue;
      expect(Number(row['p90_transit_days']), `${dimension}=${row[dimension]} p90`).toBe(percentileDisc(transits, 0.9));
      expect(Number(row['avg_transit_days']), `${dimension}=${row[dimension]} mean`)
        .toBeCloseTo(transits.reduce((a, b) => a + b, 0) / transits.length, 10);
    }
  });

  it('matches the monthly trend', async () => {
    const rows = await run(emptyIR({ metrics: ['order_count'], time: { field: 'order_date', grain: 'month', range: ALL_TIME } }));
    expect(rows.map((r) => Number(r['order_count']))).toEqual([75, 36, 46, 25, 29, 21, 42, 34, 18, 26, 24, 24]);
  });

  it('applies filters without corrupting sibling aggregates', async () => {
    // delayed_count and completed_count in one query: if the metric filter
    // leaked into a WHERE clause, completed_count would collapse to
    // delayed_count.
    const rows = await run(emptyIR({
      metrics: ['delayed_count', 'completed_count', 'delay_rate'],
      filters: [{ field: 'region', op: 'in', value: ['US-E', 'US-W'] }],
    }));
    const scope = orders.filter((o) => o.region === 'US-E' || o.region === 'US-W');
    const completed = scope.filter((o) => COMPLETED.has(o.status)).length;
    const delayed = scope.filter((o) => o.status === 'delayed').length;
    expect(Number(rows[0]!['delayed_count'])).toBe(delayed);
    expect(Number(rows[0]!['completed_count'])).toBe(completed);
    expect(Number(rows[0]!['completed_count'])).toBeGreaterThan(Number(rows[0]!['delayed_count']));
  });
});
