import { layer } from '../semantic/layer.generated.ts';
import { emptyIR } from '../shared/ir.ts';
import { compile } from '../worker/compile.ts';
import { nodeDatabase } from '../db/db-node.ts';
import { forecast, type Point } from '../worker/forecast.ts';

const db = nodeDatabase();
const ALL = { kind: 'all_time', n: null, unit: null, complete_periods: null, start: null, end: null } as const;

async function series(filters: any[] = []): Promise<Point[]> {
  const ir = emptyIR({ metrics: ['order_count'], filters, time: { field: 'order_date', grain: 'month', range: ALL } });
  const q = compile(ir, layer);
  const rows = await db.run(q.sql, q.params);
  return rows.map((r) => ({ period: String(r['period']), value: Number(r['order_count']) }));
}

async function main() {
  for (const [name, filters] of [
    ['total', []],
    ['CRAYON', [{ field: 'product_category', op: 'eq', value: ['CRAYON'] }]],
    ['BRUSH (2 zero months)', [{ field: 'product_category', op: 'eq', value: ['BRUSH'] }]],
  ] as const) {
    const h = await series(filters as any);
    const r = forecast({ history: h, horizon: 4, method: 'auto', leadTimeDays: 21, serviceLevel: 0.95, currentOnHand: null, skuFiltered: null, metricLabel: 'Orders', through: '2025-12' }, layer);
    console.log(`\n=== ${name}`);
    if (!r.ok) { console.log('  REFUSED:', r.reason); continue; }
    console.log('  history:', r.history.map(p=>p.value).join(','), `(${r.history.length} pts)`);
    console.log('  method:', r.method, '| candidates:', r.candidates.map(c=>`${c.method} ${c.error.toFixed(3)}`).join(', '));
    console.log('  forecast:', r.forecast.map(f=>`${f.period} ${f.value.toFixed(1)} [${f.lo80.toFixed(1)}-${f.hi80.toFixed(1)}]`).join('  '));
    console.log('  sparse:', r.sparse_series, '| low confidence:', r.low_confidence);
    console.log('  inventory: ROP', r.inventory?.reorder_point.toFixed(1), '| safety', r.inventory?.safety_stock.toFixed(1), '| z', r.inventory?.z.toFixed(3));
    console.log('  ' + r.explanation);
    r.notes.forEach(n => console.log('  note:', n));
  }

  console.log('\n=== SKU forecast');
  const refusal = forecast({ history: [], horizon: 4, method: 'auto', leadTimeDays: null, serviceLevel: null, currentOnHand: null, skuFiltered: { sku: 'PAPER-0197', category: 'PAPER' }, metricLabel: 'Orders', through: '2025-12' }, layer);
  if (!refusal.ok) { console.log('  ' + refusal.reason); console.log('  fallback:', JSON.stringify(refusal.fallback)); }
}
main();
