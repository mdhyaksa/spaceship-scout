import { describe, expect, it } from 'vitest';
import { layer } from '../semantic/layer.generated.ts';
import { emptyIR } from '../shared/ir.ts';
import { compile } from '../worker/compile.ts';
import { forecast, zeroFill, type Point } from '../worker/forecast.ts';
import { db, ALL_TIME } from './helpers.ts';

const database = db();
const THROUGH = '2025-12';

async function series(filters: { field: string; op: 'eq'; value: string[] }[] = []): Promise<Point[]> {
  const ir = emptyIR({
    metrics: ['order_count'], filters,
    time: { field: 'order_date', grain: 'month', range: ALL_TIME },
  });
  const compiled = compile(ir, layer);
  const rows = await database.run(compiled.sql, compiled.params);
  return rows.map((r) => ({ period: String(r['period']), value: Number(r['order_count']) }));
}

const request = (history: Point[], extra: Partial<Parameters<typeof forecast>[0]> = {}) =>
  forecast({
    history, horizon: 4, method: 'auto' as const, leadTimeDays: 21, serviceLevel: 0.95,
    currentOnHand: null, skuFiltered: null, metricLabel: 'Orders', through: THROUGH, ...extra,
  }, layer);

describe('zero fill', () => {
  it('fills gaps through the anchor, not just to the last observed row', () => {
    // A GROUP BY returns no row for a month with no orders. Filling only
    // between the first and last row present drops a trailing zero, which
    // shortens the series and biases a trend fit upward.
    const sparse = [{ period: '2025-01', value: 5 }, { period: '2025-03', value: 3 }];
    expect(zeroFill(sparse, '2025-05').map((p) => p.value)).toEqual([5, 0, 3, 0, 0]);
    expect(zeroFill(sparse).map((p) => p.value)).toEqual([5, 0, 3]);
  });
});

describe('forecast service', () => {
  it('refuses a SKU forecast and shows the arithmetic', () => {
    const result = request([], { skuFiltered: { sku: 'PAPER-0197', category: 'PAPER' } });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('insufficient_history');
    expect(result.reason).toContain('355 SKUs');
    expect(result.reason).toContain('1.13 orders per SKU');
    // A refusal with no way forward is a dead end; the parent category is.
    expect(result.fallback!.series_filters[0]!.value).toEqual(['PAPER']);
  });

  it('refuses a series that is too short to validate', () => {
    // `through` is the anchor's month, so a series that stops early is
    // zero-filled forward rather than shortened - which is why the fixture
    // has to end at the anchor for this guard to be the thing under test.
    const short = Array.from({ length: 5 }, (_, i) => ({ period: `2025-0${i + 1}`, value: 10 }));
    const result = request(short, { through: '2025-05' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('at least 8');
  });

  it('keeps every category series at 12 points including zero months', async () => {
    for (const category of ['BRUSH', 'MARKER', 'PAINT', 'CRAYON']) {
      const result = request(await series([{ field: 'product_category', op: 'eq', value: [category] }]));
      expect(result.ok, category).toBe(true);
      if (result.ok) expect(result.history.length, category).toBe(12);
    }
  });

  it('does not fire the sparse-series guard on this dataset', async () => {
    // The worst category is BRUSH at 2 zero months of 12, which is 17% against
    // a 30% threshold. The threshold stays where it is rather than being tuned
    // down to make the branch demonstrable.
    const brush = request(await series([{ field: 'product_category', op: 'eq', value: ['BRUSH'] }]));
    expect(brush.ok).toBe(true);
    if (brush.ok) {
      expect(brush.history.filter((p) => p.value === 0).length).toBe(2);
      expect(brush.sparse_series).toBe(false);
      expect(brush.low_confidence).toBe(true);
    }
  });

  it('returns the losing candidates so the winner is credible', async () => {
    const result = request(await series());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.candidates.length).toBe(3);
    expect(result.candidates.map((c) => c.method).sort()).toEqual(['linear_trend', 'moving_average', 'ses']);
    expect(result.explanation).toContain('Candidates that lost');
  });

  it('widens intervals with the horizon and never projects negative demand', async () => {
    const result = request(await series());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const widths = result.forecast.map((f) => f.hi95 - f.lo95);
    expect(widths[3]!).toBeGreaterThan(widths[0]!);
    for (const point of result.forecast) {
      expect(point.value).toBeGreaterThanOrEqual(0);
      expect(point.lo95).toBeLessThanOrEqual(point.lo80);
      expect(point.hi95).toBeGreaterThanOrEqual(point.hi80);
    }
  });

  it('produces an inventory recommendation and declines to guess stock on hand', async () => {
    const result = request(await series());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const inventory = result.inventory!;
    expect(inventory.z).toBeCloseTo(1.6449, 3);
    expect(inventory.reorder_point).toBeCloseTo(inventory.demand_over_lead_time + inventory.safety_stock, 6);
    expect(inventory.order_up_to).toBeGreaterThan(inventory.reorder_point);
    expect(inventory.suggested_order_qty).toBeNull();
    expect(inventory.note).toContain('needs current stock on hand');
  });

  it('suggests a quantity once stock on hand is supplied', async () => {
    const result = request(await series(), { currentOnHand: 10 });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.inventory!.suggested_order_qty).toBeCloseTo(Math.max(0, result.inventory!.order_up_to - 10), 6);
    }
  });

  it('caps a horizon the history cannot support', () => {
    const nine = Array.from({ length: 9 }, (_, i) => ({ period: `2025-0${i + 1}`.slice(0, 7), value: 10 + i }));
    const result = request(nine, { horizon: 8, through: '2025-09' });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.forecast.length).toBe(4);
      expect(result.notes.some((n) => n.includes('Horizon capped'))).toBe(true);
    }
  });
});
