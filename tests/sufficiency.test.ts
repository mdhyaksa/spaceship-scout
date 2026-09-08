import { describe, expect, it } from 'vitest';
import { layer } from '../semantic/layer.generated.ts';
import { emptyIR } from '../shared/ir.ts';
import { compile } from '../worker/compile.ts';
import { assess } from '../worker/sufficiency.ts';
import { chiSquareTest, normalQuantile, twoProportionTest } from '../worker/stats.ts';
import { db } from './helpers.ts';

const database = db();

async function breakdown(dimension: string) {
  const ir = emptyIR({
    metrics: ['delay_rate'], dimensions: [dimension],
    sort: [{ by: 'delay_rate', dir: 'desc' }], limit: 60,
  });
  const compiled = compile(ir, layer);
  const rows = await database.run(compiled.sql, compiled.params);
  return assess(rows, ir, layer, compiled);
}

describe('statistics', () => {
  it('reproduces the Python chi-square exactly', () => {
    // Same inputs as scripts/verify_data_facts.py: delayed against completed
    // per carrier. Python reports 15.345 on 8 df, p 0.0528.
    const delayed = [3, 0, 11, 2, 2, 4, 5, 17, 11];
    const completed = [58, 18, 85, 8, 24, 27, 25, 78, 47];
    const { stat, df, p } = chiSquareTest(delayed, completed);
    expect(stat).toBeCloseTo(15.345, 3);
    expect(df).toBe(8);
    expect(p).toBeCloseTo(0.0528, 4);
  });

  it('computes the service-level z', () => {
    expect(normalQuantile(0.95)).toBeCloseTo(1.6449, 4);
    expect(normalQuantile(0.99)).toBeCloseTo(2.3263, 4);
  });

  it('does not separate GLS from the overall rate', () => {
    expect(twoProportionTest(2, 8, 53, 362).p).toBeCloseTo(0.415, 3);
  });
});

describe('sufficiency guard', () => {
  it('refuses to name a leader chosen by a tiny sample', async () => {
    const s = await breakdown('carrier');
    expect(s.ranking_test!.leader).toBe('GLS');
    expect(s.ranking_significant).toBe(false);
    // The warning must name the sample and offer the meaningful alternative,
    // rather than simply declining to answer.
    const warning = s.warnings.find((w) => w.startsWith('GLS'))!;
    expect(warning).toContain('2 of 8');
    expect(warning).toContain('USPS');
    expect(s.coverage_caption).toBe('4 of 9 carrier groups meet the minimum sample of 30.');
  });

  it('reports a flat breakdown as flat', async () => {
    const s = await breakdown('region');
    expect(s.distribution_test!.p).toBeGreaterThan(0.2);
    expect(s.distribution_test!.flat).toBe(true);
    expect(s.warnings.some((w) => w.includes('within what random variation'))).toBe(true);
  });

  it('never asserts a winner when the omnibus test says flat', async () => {
    // The multiple-comparisons trap: the maximum of 47 lanes passes a pairwise
    // test on noise alone. Requiring the chi-square to reject flatness first
    // is what stops a lane at 2 of 2 delayed being reported as the worst.
    for (const dimension of ['lane', 'client_id']) {
      const s = await breakdown(dimension);
      expect(s.distribution_test!.flat, dimension).toBe(true);
      expect(s.ranking_significant, dimension).toBe(false);
    }
  });

  it('reports coverage honestly for every dimension', async () => {
    expect((await breakdown('lane')).coverage_caption).toContain('10 of 47');
    expect((await breakdown('client_id')).coverage_caption).toContain('5 of 30');
    expect((await breakdown('warehouse')).coverage_caption).toContain('9 of 9');
  });
});
