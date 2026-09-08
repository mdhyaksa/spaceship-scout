import { layer } from '../semantic/layer.generated.ts';
import { emptyIR, type QueryIR } from '../shared/ir.ts';
import { compile } from '../worker/compile.ts';
import { validate } from '../worker/validate.ts';
import { nodeDatabase } from '../db/db-node.ts';

const db = nodeDatabase();
const ALL = { kind: 'all_time', n: null, unit: null, complete_periods: null, start: null, end: null } as const;

async function run(name: string, ir: QueryIR, showSql = false) {
  const errs = validate(ir, layer);
  if (errs.length) {
    console.log(`  ${name}\n    BLOCKED ${errs.map((e) => `${e.code}: ${e.message}`).join(' | ')}`);
    return;
  }
  const q = compile(ir, layer);
  try {
    const rows = await db.run(q.sql, q.params);
    console.log(`  ${name}\n    cols ${q.columns.map((c) => c.key).join(', ')}`);
    console.log(`    ${JSON.stringify(rows.slice(0, 4))}`);
    if (showSql) console.log(q.sql.split('\n').map((l) => '      ' + l).join('\n'));
  } catch (e) {
    console.log(`  ${name}\n    SQL ERROR ${(e as Error).message}\n${q.sql}`);
  }
}

async function main() {
  console.log('--- KPI cards ---');
  await run('five KPIs', emptyIR({ intent: 'scalar', metrics: ['order_count', 'on_time_count', 'delayed_count', 'on_time_rate'] }));
  await run('transit', emptyIR({ intent: 'scalar', metrics: ['avg_transit_days', 'p90_transit_days'] }));

  console.log('--- delay rate by carrier (denominator dragged in by rule 3) ---');
  await run('by carrier', emptyIR({ metrics: ['delay_rate'], dimensions: ['carrier'], sort: [{ by: 'delay_rate', dir: 'desc' }] }), true);

  console.log('--- monthly trend ---');
  await run('volume by month', emptyIR({ metrics: ['order_count'], time: { field: 'order_date', grain: 'month', range: ALL } }));

  console.log('--- percentile with a dimension ---');
  await run('p90 by carrier', emptyIR({ metrics: ['p90_transit_days', 'avg_transit_days', 'completed_count'], dimensions: ['carrier'], sort: [{ by: 'p90_transit_days', dir: 'desc' }] }));

  console.log('--- filter + relative range ---');
  await run('last 3 months, US only', emptyIR({ metrics: ['delay_rate'], dimensions: ['region'], filters: [{ field: 'region', op: 'in', value: ['US-E', 'US-W'] }], time: { field: 'order_date', grain: null, range: { kind: 'relative', n: 3, unit: 'month', complete_periods: false, start: null, end: null } } }));

  console.log('--- guards ---');
  await run('group by sku', emptyIR({ metrics: ['order_count'], dimensions: ['sku'] }));
  await run('trend in_transit', emptyIR({ metrics: ['in_transit_count'], time: { field: 'order_date', grain: 'month', range: ALL } }));
  await run('range in 2027', emptyIR({ metrics: ['order_count'], time: { field: 'order_date', grain: null, range: { kind: 'absolute', n: null, unit: null, complete_periods: null, start: '2027-01-01', end: '2027-12-31' } } }));
  await run('bad carrier value', emptyIR({ metrics: ['order_count'], filters: [{ field: 'carrier', op: 'eq', value: ['Fedex Ground'] }] }));
  await run('three dimensions', emptyIR({ metrics: ['order_count'], dimensions: ['carrier', 'region', 'warehouse'] as string[] }));
}

main();
