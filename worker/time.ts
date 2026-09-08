/**
 * Relative time resolution, anchored to the data rather than the clock.
 *
 * The dataset ends 2025-12-30 and today is well past that, so every range
 * anchored to now() returns zero rows. Ranges resolve against
 * layer.time_anchor.value instead, and the resolved absolute window is stated
 * in the explainability panel on every answer so nobody mistakes it for live
 * data.
 *
 * `complete_periods` distinguishes the two readings of a relative range:
 *   true  - the N complete periods before the anchor's own period.
 *           "last month" from a 30 Dec anchor is 1-30 November.
 *   false - the N periods ending with the anchor's own period, which may be
 *           partial. "last 3 months" is 1 Oct - 30 Dec, partial_period true.
 * The planner picks; this module only implements both faithfully.
 */
import type { Layer } from '../shared/layer-types.ts';
import type { Range, TimeSpec } from '../shared/ir.ts';

export interface ResolvedRange {
  start: string; // ISO date, inclusive
  end: string; // ISO date, inclusive
  partial_period: boolean;
  /** Human-readable, for the explain panel: "1 Oct 2025 - 30 Dec 2025". */
  label: string;
}

type Unit = 'day' | 'week' | 'month' | 'quarter' | 'year';

const MS_DAY = 86_400_000;

function toUTC(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y!, (m ?? 1) - 1, d ?? 1));
}

function iso(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addDays(date: Date, n: number): Date {
  return new Date(date.getTime() + n * MS_DAY);
}

/** First day of the period containing `date`. Weeks start Monday, matching
 *  SQLite's %W and ISO convention. */
function startOfPeriod(date: Date, unit: Unit): Date {
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth();
  switch (unit) {
    case 'day':
      return date;
    case 'week': {
      const dow = (date.getUTCDay() + 6) % 7; // Monday = 0
      return addDays(date, -dow);
    }
    case 'month':
      return new Date(Date.UTC(y, m, 1));
    case 'quarter':
      return new Date(Date.UTC(y, Math.floor(m / 3) * 3, 1));
    case 'year':
      return new Date(Date.UTC(y, 0, 1));
  }
}

/** Last day of the period containing `date`. */
function endOfPeriod(date: Date, unit: Unit): Date {
  const start = startOfPeriod(date, unit);
  return addDays(shiftPeriods(start, unit, 1), -1);
}

function shiftPeriods(date: Date, unit: Unit, n: number): Date {
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth();
  const d = date.getUTCDate();
  switch (unit) {
    case 'day':
      return addDays(date, n);
    case 'week':
      return addDays(date, n * 7);
    case 'month':
      return new Date(Date.UTC(y, m + n, d));
    case 'quarter':
      return new Date(Date.UTC(y, m + n * 3, d));
    case 'year':
      return new Date(Date.UTC(y + n, m, d));
  }
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function pretty(isoDate: string): string {
  const d = toUTC(isoDate);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

export function dataAsOf(layer: Layer): string {
  return layer.time_anchor.mode === 'now'
    ? iso(new Date())
    : layer.time_anchor.value;
}

export function resolveRange(range: Range, layer: Layer): ResolvedRange {
  const anchor = toUTC(dataAsOf(layer));

  if (range.kind === 'all_time') {
    const coverage = layer.datasets['orders']!.coverage['order_date']!;
    return {
      start: coverage[0],
      end: coverage[1],
      partial_period: false,
      label: `${pretty(coverage[0])} - ${pretty(coverage[1])}`,
    };
  }

  if (range.kind === 'absolute') {
    const start = range.start ?? layer.datasets['orders']!.coverage['order_date']![0];
    const end = range.end ?? dataAsOf(layer);
    return { start, end, partial_period: false, label: `${pretty(start)} - ${pretty(end)}` };
  }

  const unit = (range.unit ?? 'month') as Unit;
  const n = range.n ?? 1;
  // Default false: include the anchor's own period and mark it partial, rather
  // than silently dropping the most recent data the user is asking about.
  const complete = range.complete_periods ?? false;

  let start: Date;
  let end: Date;
  let partial = false;

  if (complete) {
    end = addDays(startOfPeriod(anchor, unit), -1);
    start = startOfPeriod(shiftPeriods(end, unit, -(n - 1)), unit);
  } else {
    const periodEnd = endOfPeriod(anchor, unit);
    // Clamp to the data. December 2025 ends on the 30th, so this fires often.
    end = periodEnd > anchor ? anchor : periodEnd;
    partial = periodEnd > anchor;
    start = startOfPeriod(shiftPeriods(anchor, unit, -(n - 1)), unit);
  }

  return {
    start: iso(start),
    end: iso(end),
    partial_period: partial,
    label: `${pretty(iso(start))} - ${pretty(iso(end))}`,
  };
}

/** Does the requested window intersect the data at all? An out-of-coverage
 *  message beats an empty chart every time. */
export function intersectsCoverage(resolved: ResolvedRange, layer: Layer, field: string): boolean {
  const coverage = layer.datasets['orders']!.coverage[field];
  if (!coverage) return true;
  return !(resolved.end < coverage[0] || resolved.start > coverage[1]);
}

export function resolveTime(time: TimeSpec, layer: Layer): ResolvedRange {
  return resolveRange(time.range, layer);
}
