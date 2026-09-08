/**
 * Runs after execution, before any answer text is written. Deterministic - it
 * is a check on the result set, not a model judgement - and it changes what
 * the answer is allowed to claim.
 *
 * This is the difference between a tool people trust and one that gets a
 * carrier dropped over two orders. It applies in production exactly as it does
 * here, because thin slices are a property of segmentation, not of mock data.
 */
import type { Layer } from '../shared/layer-types.ts';
import { minGroupSize } from '../shared/layer-types.ts';
import type { QueryIR } from '../shared/ir.ts';
import type { CompiledQuery } from './compile.ts';
import type { Row } from './db.ts';
import { chiSquareTest, twoProportionTest } from './stats.ts';

export interface Sufficiency {
  /** Smallest denominator present, or null when no ratio metric is shown. */
  min_group_n: number | null;
  floor: number | null;
  groups_total: number;
  groups_clearing_floor: number;
  groups_below_threshold: string[];
  ranking_significant: boolean | null;
  ranking_test: { method: 'two_proportion'; p: number; leader: string; runner_up: string | null } | null;
  distribution_test: { method: 'chi_square'; p: number; flat: boolean } | null;
  /** Rendered on the tile and in the answer. Never silently dropped. */
  warnings: string[];
  /** Coverage caption: "10 of 47 lanes meet the minimum sample of 10." */
  coverage_caption: string | null;
}

const EMPTY: Sufficiency = {
  min_group_n: null, floor: null, groups_total: 0, groups_clearing_floor: 0,
  groups_below_threshold: [], ranking_significant: null, ranking_test: null,
  distribution_test: null, warnings: [], coverage_caption: null,
};

function pct(x: number): string {
  return `${(x * 100).toFixed(1)}%`;
}

export function assess(
  rows: Row[],
  ir: QueryIR,
  layer: Layer,
  compiled: CompiledQuery,
): Sufficiency {
  const dimension = ir.dimensions[0];
  const ratioMetric = compiled.selectedMetrics.find((m) => layer.metrics[m]?.agg === 'ratio');
  if (!dimension || !ratioMetric || rows.length === 0) return { ...EMPTY, groups_total: rows.length };

  const denominatorKey = compiled.denominatorOf[ratioMetric];
  if (!denominatorKey) return { ...EMPTY, groups_total: rows.length };

  const metric = layer.metrics[ratioMetric]!;
  const numeratorKey = metric.agg === 'ratio' ? metric.numerator : null;
  const dim = layer.dimensions[dimension]!;
  const floor = minGroupSize(layer, dimension);

  const groups = rows.map((r) => ({
    key: String(r[dimension] ?? ''),
    rate: Number(r[ratioMetric] ?? 0),
    n: Number(r[denominatorKey] ?? 0),
    x: numeratorKey ? Number(r[numeratorKey] ?? Number(r[ratioMetric] ?? 0) * Number(r[denominatorKey] ?? 0)) : null,
  }));

  const below = groups.filter((g) => floor !== null && g.n < floor);
  const clearing = groups.length - below.length;
  const warnings: string[] = [];

  // --- Small groups ------------------------------------------------------
  if (floor !== null && below.length) {
    const smallest = below.reduce((a, b) => (a.n <= b.n ? a : b));
    const swing = smallest.n > 0 ? 1 / smallest.n : 0;
    warnings.push(
      `Sample sizes are small: ${below.length} of ${groups.length} ${dim.label.toLowerCase()} groups have fewer than ` +
        `${floor} completed deliveries. The smallest has ${smallest.n}, so a single order moves its rate by about ` +
        `${(swing * 100).toFixed(0)} points.`,
    );
  }

  const coverage_caption =
    floor !== null
      ? `${clearing} of ${groups.length} ${dim.label.toLowerCase()} groups meet the minimum sample of ${floor}.` +
        (clearing === 0 ? ' No group reaches it, so every rate here is indicative only.' : '')
      : null;

  // --- Flat distribution --------------------------------------------------
  // The omnibus test runs first because it gates the ranking test below.
  let distribution_test: Sufficiency['distribution_test'] = null;
  if (groups.length > 1 && numeratorKey) {
    const successes = groups.map((g) => g.x ?? 0);
    const totals = groups.map((g) => g.n);
    const { p } = chiSquareTest(successes, totals);
    const flat = p > layer.parameters.flat_distribution_p;
    distribution_test = { method: 'chi_square', p, flat };
    if (flat) {
      warnings.push(
        `The differences shown are within what random variation would produce at these sample sizes ` +
          `(chi-square p = ${p.toFixed(2)}). Treat this breakdown as flat rather than as a ranking.`,
      );
    }
  }

  // --- Ranking -----------------------------------------------------------
  // A leader may be asserted only if it clears all three guards:
  //
  //   1. the omnibus chi-square rejects flatness,
  //   2. the leader's own sample reaches the dimension's floor,
  //   3. a two-proportion test separates it from every other group pooled.
  //
  // Requiring (1) before (3) is a closed testing procedure, and it is not
  // optional here: the maximum of 47 lanes will pass a pairwise test on noise
  // alone perfectly often. A lane at 2 of 2 delayed beats the pooled rate at
  // p = 0.03 while telling you nothing at all.
  let ranking_test: Sufficiency['ranking_test'] = null;
  let ranking_significant: boolean | null = null;
  const sortsByRatio = ir.sort.some((s) => s.by === ratioMetric);
  if (sortsByRatio && groups.length > 1 && numeratorKey) {
    const ordered = [...groups].sort((a, b) => b.rate - a.rate);
    const leader = ordered[0]!;
    const rest = ordered.slice(1);
    const restX = rest.reduce((sum, g) => sum + (g.x ?? 0), 0);
    const restN = rest.reduce((sum, g) => sum + g.n, 0);
    const test = twoProportionTest(leader.x ?? 0, leader.n, restX, restN);
    const clearsFloor = floor === null || leader.n >= floor;
    const notFlat = !distribution_test?.flat;
    ranking_significant = test.p < 0.05 && clearsFloor && notFlat;
    const meaningful = ordered.find((g) => floor !== null && g.n >= floor && g.key !== leader.key) ?? null;
    ranking_test = {
      method: 'two_proportion',
      p: test.p,
      leader: leader.key,
      runner_up: meaningful?.key ?? null,
    };
    if (!ranking_significant) {
      const overall = restN + leader.n > 0 ? (restX + (leader.x ?? 0)) / (restN + leader.n) : 0;
      const because = !clearsFloor
        ? `that is ${leader.x} of ${leader.n} - not enough to distinguish it from the ${pct(overall)} overall rate`
        : !notFlat
          ? `the spread across all ${groups.length} groups is within normal variation, so the top position is not a finding`
          : `it does not separate from the ${pct(overall)} overall rate (p = ${test.p.toFixed(2)})`;
      let sentence = `${leader.key} shows the highest ${metric.label.toLowerCase()} at ${pct(leader.rate)}, but ${because}.`;
      if (meaningful && !clearsFloor) {
        sentence += ` ${meaningful.key} at ${pct(meaningful.rate)} across ${meaningful.n} is the more meaningful signal.`;
      }
      warnings.push(sentence);
    }
  }

  return {
    min_group_n: groups.length ? Math.min(...groups.map((g) => g.n)) : null,
    floor,
    groups_total: groups.length,
    groups_clearing_floor: clearing,
    groups_below_threshold: below.map((g) => g.key),
    ranking_significant,
    ranking_test,
    distribution_test,
    warnings,
    coverage_caption,
  };
}
