/**
 * Display metadata for the dashboard.
 *
 * The plans themselves live in worker/tiles.ts and never reach the browser —
 * the SPA asks for a tile by id and renders what comes back. Titles and notes
 * are presentation, so they live here.
 */
export interface CardMeta {
  id: string;
  title: string;
  metric: string;
  contextMetric?: string;
  note?: string;
}

export const CARDS: CardMeta[] = [
  { id: 'card_total_orders', title: 'Total orders', metric: 'order_count', contextMetric: 'units_ordered' },
  {
    id: 'card_completed', title: 'Completed orders', metric: 'completed_count', contextMetric: 'on_time_count',
    note: 'Orders that reached a final delivery outcome — delivered, delayed or exception. All three carry a delivery date; delayed orders arrived, just late. Excludes 27 in transit and 3 canceled.',
  },
  {
    id: 'card_delayed', title: 'Delayed orders', metric: 'delayed_count', contextMetric: 'delay_rate',
    note: 'Share is of completed deliveries, not of delivered orders — delayed and delivered are mutually exclusive statuses.',
  },
  { id: 'card_on_time_rate', title: 'On-time delivery rate', metric: 'on_time_rate', contextMetric: 'completed_count' },
  {
    id: 'card_avg_transit', title: 'Average delivery time', metric: 'avg_transit_days', contextMetric: 'p95_transit_days',
    note: 'Excludes 30 orders with no delivery date (27 in transit, 3 canceled).',
  },
];

export interface ChartMeta {
  id: string;
  title: string;
  subtitle?: string;
  note?: string;
}

export const CHARTS: ChartMeta[] = [
  {
    id: 'chart_composition', title: 'Delivery performance', subtitle: 'All five statuses, count and share of total',
    note: 'In-transit and canceled counts have no capture timestamp, so this is an untimed total and must not be trended.',
  },
  { id: 'chart_volume', title: 'Order volume', subtitle: 'Monthly' },
  { id: 'chart_transit', title: 'Transit time', subtitle: 'Orders by days in transit' },
  { id: 'chart_breakdown', title: 'Breakdown', subtitle: 'Volume against on-time rate' },
];

/** Origin city is absent because it is 1:1 with warehouse, and destination
 *  city because it partitions identically to lane. */
export const BREAKDOWN_DIMENSIONS = ['carrier', 'region', 'warehouse', 'product_category', 'lane', 'client_id'] as const;
