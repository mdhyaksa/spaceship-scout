import { describe, expect, it } from 'vitest';
import { layer } from '../semantic/layer.generated.ts';
import { resolveRange, dataAsOf } from '../worker/time.ts';
import type { Range } from '../shared/ir.ts';

const relative = (n: number, unit: Range['unit'], complete: boolean): Range =>
  ({ kind: 'relative', n, unit, complete_periods: complete, start: null, end: null });

describe('time resolution', () => {
  it('anchors to the data, not the clock', () => {
    expect(dataAsOf(layer)).toBe('2025-12-30');
    // The whole point: today is well past the data, so a wall-clock anchor
    // would make every relative range return nothing.
    expect(new Date().toISOString().slice(0, 10) > dataAsOf(layer)).toBe(true);
  });

  it('resolves "last month" to the previous complete month', () => {
    const r = resolveRange(relative(1, 'month', true), layer);
    expect([r.start, r.end]).toEqual(['2025-11-01', '2025-11-30']);
    expect(r.partial_period).toBe(false);
  });

  it('resolves "last 3 months" through the anchor and flags the partial period', () => {
    const r = resolveRange(relative(3, 'month', false), layer);
    // December ends on the 30th in this dataset, so the window is clamped and
    // the final period is incomplete.
    expect([r.start, r.end]).toEqual(['2025-10-01', '2025-12-30']);
    expect(r.partial_period).toBe(true);
  });

  it('resolves "past 30 days" against the anchor', () => {
    const r = resolveRange(relative(30, 'day', false), layer);
    expect([r.start, r.end]).toEqual(['2025-12-01', '2025-12-30']);
  });

  it('resolves "this month" as partial', () => {
    const r = resolveRange(relative(1, 'month', false), layer);
    expect([r.start, r.end]).toEqual(['2025-12-01', '2025-12-30']);
    expect(r.partial_period).toBe(true);
  });

  it('handles quarters and weeks', () => {
    expect(resolveRange(relative(2, 'quarter', false), layer).start).toBe('2025-07-01');
    const week = resolveRange(relative(1, 'week', true), layer);
    expect([week.start, week.end]).toEqual(['2025-12-22', '2025-12-28']);
  });

  it('passes absolute ranges through', () => {
    const r = resolveRange({ kind: 'absolute', n: null, unit: null, complete_periods: null, start: '2025-01-01', end: '2025-12-31' }, layer);
    expect([r.start, r.end]).toEqual(['2025-01-01', '2025-12-31']);
  });
});
