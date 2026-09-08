import { layer } from '../semantic/layer.generated.ts';
import { nodeDatabase } from '../db/db-node.ts';
import { execute } from '../worker/execute.ts';
import { CARDS, CHARTS, breakdownIR } from '../worker/tiles.ts';

const db = nodeDatabase();
async function main() {
  for (const tile of [...CARDS, ...CHARTS]) {
    const a = await execute(tile.ir([]), layer, db, { requestId: 'r', cacheable: true });
    console.log(`\n[${tile.kind}] ${tile.title}`);
    console.log('  status:', a.status, '| chart:', tile.chartOverride ?? a.chart?.type);
    console.log('  text:', a.text);
    if (a.data && a.data.rows.length <= 6) console.log('  rows:', JSON.stringify(a.data.rows));
    else console.log('  rows:', a.data?.row_count, 'first:', JSON.stringify(a.data?.rows.slice(0, 3)));
    a.explain?.warnings.forEach((w) => console.log('  ! ' + w));
  }
  const scatter = await execute(breakdownIR('carrier', []), layer, db, { requestId: 'r', cacheable: true });
  console.log('\n[scatter carrier]');
  console.log('  ', JSON.stringify(scatter.data?.rows.slice(0, 3)));
  console.log('  coverage:', scatter.sufficiency?.coverage_caption);
}
main();
