/**
 * The dashboard, declared as IRs.
 *
 * Every tile is a query plan, so every tile goes through the same validator,
 * compiler, sufficiency guard and explain builder as a chat answer. That is
 * what makes SPEC.md section 6.1's "cards are bound to metric ids" real: there
 * is no hand-written tile SQL anywhere, and a card cannot drift from the
 * number the chat gives for the same question.
 */
import { emptyIR, type Filter, type QueryIR } from '../shared/ir.ts';
import type { ChartType } from './chart.ts';

export interface TileDef {
  id: string;
  title: string;
  subtitle?: string;
  kind: 'card' | 'chart';
  /** Named components whose form is fixed by DESIGN.md rather than derived
   *  from result shape. */
  chartOverride?: ChartType | 'composition' | 'histogram' | 'breakdown_scatter';
  ir: (filters: Filter[]) => QueryIR;
  /** Extra metric shown under the value on a KPI card. */
  contextMetric?: string;
  note?: string;
}

const ALL_TIME = {
  kind: 'all_time' as const, n: null, unit: null, complete_periods: null, start: null, end: null,
};

export const CARDS: TileDef[] = [
  {
    id: 'card_total_orders',
    title: 'Total orders',
    kind: 'card',
    ir: (filters) => emptyIR({
      intent: 'scalar', metrics: ['order_count', 'units_ordered'], filters,
      interpretation: 'All orders in scope, whatever their status.',
    }),
    contextMetric: 'units_ordered',
  },
  {
    id: 'card_delivered',
    title: 'Delivered orders',
    kind: 'card',
    ir: (filters) => emptyIR({
      intent: 'scalar', metrics: ['on_time_count', 'completed_count'], filters,
      interpretation: 'Orders that reached a final delivered status, on time.',
    }),
    contextMetric: 'completed_count',
  },
  {
    id: 'card_delayed',
    title: 'Delayed orders',
    kind: 'card',
    ir: (filters) => emptyIR({
      intent: 'scalar', metrics: ['delayed_count', 'delay_rate'], filters,
      interpretation: 'Orders flagged delayed, as a share of completed deliveries.',
    }),
    contextMetric: 'delay_rate',
    note: 'Share is of completed deliveries, not of delivered orders — delayed and delivered are mutually exclusive statuses.',
  },
  {
    id: 'card_on_time_rate',
    title: 'On-time delivery rate',
    kind: 'card',
    ir: (filters) => emptyIR({
      intent: 'scalar', metrics: ['on_time_rate'], filters,
      interpretation: 'Delivered on time as a share of all completed deliveries.',
    }),
    contextMetric: 'completed_count',
  },
  {
    id: 'card_avg_transit',
    title: 'Average delivery time',
    kind: 'card',
    ir: (filters) => emptyIR({
      intent: 'scalar', metrics: ['avg_transit_days', 'p90_transit_days'], filters,
      interpretation: 'Mean days from order to delivery, with the 90th percentile alongside.',
    }),
    contextMetric: 'p90_transit_days',
    note: 'Excludes 30 orders with no delivery date (27 in transit, 3 canceled).',
  },
];

export const CHARTS: TileDef[] = [
  {
    id: 'chart_composition',
    title: 'Delivery performance',
    subtitle: 'All five statuses, count and share of total',
    kind: 'chart',
    chartOverride: 'composition',
    ir: (filters) => emptyIR({
      metrics: ['order_count'], dimensions: ['order_status'], filters,
      sort: [{ by: 'order_count', dir: 'desc' }],
      interpretation: 'Order count by status across everything in scope.',
    }),
    note: 'In-transit and canceled counts have no capture timestamp, so this is an untimed total and must not be trended.',
  },
  {
    id: 'chart_volume',
    title: 'Order volume',
    subtitle: 'Monthly',
    kind: 'chart',
    ir: (filters) => emptyIR({
      metrics: ['order_count'], filters,
      time: { field: 'order_date', grain: 'month', range: ALL_TIME },
      interpretation: 'Orders placed per month.',
    }),
  },
  {
    id: 'chart_transit',
    title: 'Transit time',
    subtitle: 'Orders by days in transit',
    kind: 'chart',
    chartOverride: 'histogram',
    ir: (filters) => emptyIR({
      metrics: ['order_count'], dimensions: ['transit_days'],
      // Without this the 30 orders that have no delivery date land in a null
      // bucket and read as the largest group in the chart.
      filters: [...filters, { field: 'delivery_date', op: 'is_not_null', value: [] }],
      sort: [{ by: 'transit_days', dir: 'asc' }], limit: 60,
      interpretation: 'Distribution of completed deliveries by transit days.',
    }),
    note: 'The tail is the story: the mean sits inside the body of the distribution and says nothing about the orders that generate complaints.',
  },
  {
    id: 'chart_breakdown',
    title: 'Breakdown',
    subtitle: 'Volume against on-time rate',
    kind: 'chart',
    chartOverride: 'breakdown_scatter',
    ir: (filters) => breakdownIR('carrier', filters),
    note: 'Darker points are slower. Hollow points fall below the dimension’s minimum sample.',
  },
];

/** The scatter's switchable dimension. Origin city is absent because it is 1:1
 *  with warehouse, and destination city because it partitions identically to
 *  lane — either would draw the same chart under a different name. */
export const BREAKDOWN_DIMENSIONS = ['carrier', 'region', 'warehouse', 'product_category', 'lane', 'client_id'] as const;

export function breakdownIR(dimension: string, filters: Filter[]): QueryIR {
  return emptyIR({
    metrics: ['on_time_rate', 'order_count', 'avg_transit_days', 'p90_transit_days'],
    dimensions: [dimension],
    filters,
    sort: [{ by: 'order_count', dir: 'desc' }],
    limit: 60,
    interpretation: `On-time rate against share of volume by ${dimension}, with average transit days as point darkness.`,
  });
}

export const TILES: TileDef[] = [...CARDS, ...CHARTS];

export function findTile(id: string): TileDef | undefined {
  return TILES.find((t) => t.id === id);
}
