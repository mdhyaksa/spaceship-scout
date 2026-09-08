import { describe, expect, it } from 'vitest';
import { layer } from '../semantic/layer.generated.ts';
import { emptyIR } from '../shared/ir.ts';
import { validate } from '../worker/validate.ts';
import { ALL_TIME } from './helpers.ts';

const codes = (ir: Parameters<typeof validate>[0]) => validate(ir, layer).map((e) => e.code);

describe('validator', () => {
  it('accepts a well-formed plan', () => {
    expect(codes(emptyIR({ metrics: ['delay_rate'], dimensions: ['carrier'] }))).toEqual([]);
  });

  it('rejects unknown fields', () => {
    expect(codes(emptyIR({ metrics: ['made_up_metric'] }))).toContain('unknown_field');
    expect(codes(emptyIR({ metrics: ['order_count'], dimensions: ['colour'] }))).toContain('unknown_field');
  });

  it('refuses SKU as a grain', () => {
    // 355 SKUs across 400 orders. Filterable, never a breakdown.
    expect(codes(emptyIR({ metrics: ['order_count'], dimensions: ['sku'] }))).toContain('not_groupable');
  });

  it('refuses dimensions that duplicate another grain', () => {
    expect(codes(emptyIR({ metrics: ['order_count'], dimensions: ['destination_city'] }))).toContain('not_groupable');
    expect(codes(emptyIR({ metrics: ['order_count'], dimensions: ['origin_city'] }))).toContain('not_groupable');
  });

  it('refuses to trend a point-in-time metric', () => {
    // In-transit orders carry no capture timestamp and span the whole year, so
    // a monthly breakdown of them is a count of a label, not a backlog.
    const ir = emptyIR({ metrics: ['in_transit_count'], time: { field: 'order_date', grain: 'month', range: ALL_TIME } });
    expect(codes(ir)).toContain('not_trendable');
  });

  it('reports a range outside the data rather than returning an empty chart', () => {
    const ir = emptyIR({ metrics: ['order_count'], time: { field: 'order_date', grain: null, range: { kind: 'absolute', n: null, unit: null, complete_periods: null, start: '2027-01-01', end: '2027-12-31' } } });
    expect(codes(ir)).toContain('out_of_coverage');
  });

  it('rejects filter values outside the declared set', () => {
    expect(codes(emptyIR({ metrics: ['order_count'], filters: [{ field: 'carrier', op: 'eq', value: ['Fedex Ground'] }] }))).toContain('invalid_value');
  });

  it('rejects numeric operators on categorical dimensions', () => {
    expect(codes(emptyIR({ metrics: ['order_count'], filters: [{ field: 'carrier', op: 'gt', value: ['DHL'] }] }))).toContain('invalid_operator');
  });

  it('caps field counts', () => {
    expect(codes(emptyIR({ metrics: ['order_count'], dimensions: ['carrier', 'region', 'warehouse'] }))).toContain('too_many_fields');
    expect(codes(emptyIR({ metrics: ['order_count', 'delay_rate', 'on_time_rate', 'exception_rate', 'gross_revenue'] }))).toContain('too_many_fields');
  });

  it('lets clarify and unanswerable plans through without a query', () => {
    expect(codes(emptyIR({ intent: 'clarify', metrics: [] }))).toEqual([]);
    expect(codes(emptyIR({ intent: 'unanswerable', metrics: [] }))).toEqual([]);
  });
});
