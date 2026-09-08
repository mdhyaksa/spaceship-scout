import { describe, expect, it } from 'vitest';
import { layer } from '../semantic/layer.generated.ts';
import { emptyIR } from '../shared/ir.ts';
import { compile } from '../worker/compile.ts';
import { postgres, sqlite } from '../worker/dialect.ts';
import { ALL_TIME } from './helpers.ts';

/** Guards on the SQL shape itself. The parity tests prove the numbers; these
 *  prove the construction, so a regression is caught as a shape change rather
 *  than as a number that happens to still look plausible. */
describe('compiler', () => {
  it('puts a metric filter inside the aggregate, never in a WHERE clause', () => {
    const { sql } = compile(emptyIR({ metrics: ['delayed_count', 'completed_count'] }), layer);
    expect(sql).toContain("FILTER (WHERE status IN ('delayed'))");
    expect(sql).toContain("FILTER (WHERE status IN ('delivered','delayed','exception'))");
    // Every mention of status must be inside a FILTER. A top-level WHERE would
    // corrupt the sibling aggregate — the single most important rule in the
    // compiler, and the reason delay_rate cannot be built by hand.
    const statusMentions = [...sql.matchAll(/WHERE status/g)];
    expect(statusMentions.length).toBe(2);
    for (const match of statusMentions) {
      expect(sql.slice(Math.max(0, match.index! - 8), match.index!)).toContain('FILTER (');
    }
  });

  it('drags a ratio denominator into the result whether or not it was asked for', () => {
    const compiled = compile(emptyIR({ metrics: ['delay_rate'], dimensions: ['carrier'] }), layer);
    expect(compiled.selectedMetrics).toContain('completed_count');
    expect(compiled.denominatorOf['delay_rate']).toBe('completed_count');
    // No rate may be displayed without its n.
    expect(compiled.columns.map((c) => c.key)).toContain('completed_count');
  });

  it('computes ratios at the final grain, guarded against a zero denominator', () => {
    const { sql } = compile(emptyIR({ metrics: ['delay_rate'] }), layer);
    expect(sql).toContain('NULLIF(');
    expect(sql).toContain('CAST(');
    expect(sql).not.toContain('AVG(');
  });

  it('uses CUME_DIST for percentiles and never PERCENT_RANK', () => {
    const { sql } = compile(emptyIR({ metrics: ['p90_transit_days'], dimensions: ['lane'] }), layer);
    expect(sql).toContain('CUME_DIST() OVER');
    expect(sql).toContain('cd >= 0.9');
    // PERCENT_RANK is (rank - 1) / (n - 1) and overshoots: it disagrees with
    // PERCENTILE_DISC on 4 of the 9 carriers in this dataset.
    expect(sql).not.toContain('PERCENT_RANK');
  });

  it('partitions the percentile window by alias, not by source expression', () => {
    // The subquery projects aliases only. A dimension whose alias equals its
    // column would work either way; lane is origin_city || ' -> ' || dest.
    const { sql } = compile(emptyIR({ metrics: ['p90_transit_days'], dimensions: ['lane'] }), layer);
    expect(sql).toContain('PARTITION BY lane');
  });

  it('binds query filter values as parameters', () => {
    const compiled = compile(emptyIR({
      metrics: ['order_count'],
      filters: [{ field: 'carrier', op: 'in', value: ['DHL', 'UPS'] }],
    }), layer);
    expect(compiled.sql).toContain('carrier IN (?, ?)');
    expect(compiled.params).toEqual(['DHL', 'UPS']);
    expect(compiled.sql).not.toContain('DHL');
  });

  it('substitutes semantic-layer parameters into metric filters', () => {
    const { sql } = compile(emptyIR({ metrics: ['delayed_count'] }), layer);
    expect(sql).toContain("status IN ('delayed')");
    expect(sql).not.toContain('{{');
  });

  it('excludes rows with a null date when grouping by a nullable time field', () => {
    const { sql } = compile(emptyIR({
      metrics: ['order_count'],
      time: { field: 'delivery_date', grain: 'month', range: ALL_TIME },
    }), layer);
    expect(sql).toContain('delivery_date IS NOT NULL');
  });

  it('emits the same plan against Postgres with native constructs', () => {
    const ir = emptyIR({
      metrics: ['avg_transit_days'],
      time: { field: 'order_date', grain: 'month', range: ALL_TIME },
    });
    const sqliteSql = compile(ir, layer, sqlite).sql;
    const postgresSql = compile(ir, layer, postgres).sql;

    expect(sqliteSql).toContain('julianday(delivery_date) - julianday(order_date)');
    expect(sqliteSql).toContain("strftime('%Y-%m'");
    expect(sqliteSql).toContain('FROM fct_orders');

    expect(postgresSql).toContain('(delivery_date - order_date)');
    expect(postgresSql).toContain("date_trunc('month'");
    expect(postgresSql).toContain('FROM analytics.fct_orders');
  });
});
