/**
 * Chart selection is a deterministic function of result shape. No model call:
 * the same result always draws the same chart, which is what makes the
 * dashboard and the chat visually consistent.
 */
import type { Layer } from '../shared/layer-types.ts';
import type { QueryIR } from '../shared/ir.ts';
import type { Column } from './compile.ts';
import type { Row } from './db.ts';

export type ChartType =
  | 'big_number' | 'line' | 'multi_line' | 'bar' | 'bar_horizontal'
  | 'scatter' | 'forecast' | 'table';

export interface ChartSpec {
  type: ChartType;
  x: string | null;
  y: string[];
  series: string | null;
  /** Categories beyond this are collapsed into "Other". */
  collapse_to: number | null;
  /** Bars go horizontal when a label cannot fit; lane labels rarely can. */
  reason: string;
}

const LONG_LABEL = 12;
const MAX_CATEGORIES = 12;

export function selectChart(
  ir: QueryIR,
  rows: Row[],
  columns: Column[],
  layer: Layer,
): ChartSpec {
  // The requested metrics, not the expanded set: a denominator dragged in for
  // the sufficiency guard must not turn a bar chart into a scatter.
  const metrics = ir.metrics.filter((m) => m in layer.metrics);
  const dims = ir.dimensions;
  const hasTime = Boolean(ir.time?.grain);
  const table = (reason: string): ChartSpec =>
    ({ type: 'table', x: null, y: metrics, series: null, collapse_to: null, reason });

  if (ir.intent === 'forecast') {
    return { type: 'forecast', x: 'period', y: metrics, series: null, collapse_to: null,
      reason: 'History solid, forecast dashed, interval band.' };
  }

  if (metrics.length === 1 && dims.length === 0) {
    return hasTime
      ? { type: 'line', x: 'period', y: metrics, series: null, collapse_to: null,
          reason: 'One metric over time.' }
      : { type: 'big_number', x: null, y: metrics, series: null, collapse_to: null,
          reason: 'A single value with no breakdown.' };
  }

  if (metrics.length === 1 && dims.length === 1) {
    const dim = dims[0]!;
    if (hasTime) {
      const distinct = new Set(rows.map((r) => String(r[dim]))).size;
      return {
        type: 'multi_line', x: 'period', y: metrics, series: dim,
        collapse_to: distinct > 5 ? 5 : null,
        reason: distinct > 5
          ? `${distinct} series is past what a line chart reads; top 5 by total, rest collapsed.`
          : 'One metric over time, split by a low-cardinality dimension.',
      };
    }
    const categories = rows.length;
    const longest = Math.max(0, ...rows.map((r) => String(r[dim] ?? '').length));
    const horizontal = longest > LONG_LABEL;
    return {
      type: horizontal ? 'bar_horizontal' : 'bar',
      x: dim, y: metrics, series: null,
      collapse_to: categories > MAX_CATEGORIES ? 10 : null,
      reason: [
        categories > MAX_CATEGORIES ? `${categories} categories; top 10 plus Other, full data in the table.` : null,
        horizontal ? `Longest label is ${longest} characters, so bars run horizontally.` : null,
      ].filter(Boolean).join(' ') || 'One metric across a dimension, sorted.',
    };
  }

  if (metrics.length === 2 && dims.length === 1 && !hasTime) {
    return { type: 'scatter', x: metrics[0]!, y: [metrics[1]!], series: dims[0]!, collapse_to: null,
      reason: 'Two metrics across one dimension read as position on two axes.' };
  }

  if (metrics.length >= 2 && hasTime && dims.length === 0) {
    const formats = new Set(metrics.map((m) => layer.metrics[m]!.format));
    if (formats.size === 1) {
      return { type: 'line', x: 'period', y: metrics, series: null, collapse_to: null,
        reason: 'Several metrics sharing one unit, so one axis.' };
    }
    return table('Metrics with different units do not share an axis honestly.');
  }

  return table('No chart reads this shape better than the numbers do.');
}
