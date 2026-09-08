/**
 * Shape of the semantic layer. These are types only — every value lives in
 * semantic/layer.yaml. Nothing here encodes what a metric means.
 */

export type MetricFormat = 'integer' | 'percent' | 'days_1dp' | 'currency_usd';

interface MetricBase {
  label: string;
  format: MetricFormat;
  notes?: string;
  /** False when the metric counts an open status with no capture timestamp:
   *  it cannot be trended or grouped by a time grain. */
  point_in_time?: boolean;
}

/** count_distinct | avg | sum | max — one aggregate over one expression. */
export interface SimpleMetric extends MetricBase {
  agg: 'count_distinct' | 'avg' | 'sum' | 'max';
  expr: string;
  /** Compiles to FILTER (WHERE ...) inside the aggregate, never to a WHERE. */
  filter?: string;
}

export interface PercentileMetric extends MetricBase {
  agg: 'percentile_disc';
  percentile: number;
  expr: string;
  filter?: string;
}

/** Computed at the final grain as numerator / denominator, never as an
 *  average of per-row ratios. */
export interface RatioMetric extends MetricBase {
  agg: 'ratio';
  numerator: string;
  denominator: string;
  null_policy?: 'null_when_denominator_zero';
}

export type Metric = SimpleMetric | PercentileMetric | RatioMetric;

export interface Dimension {
  label: string;
  expr: string;
  /** ordinal sorts numerically rather than lexically: transit day 10 comes
   *  after 2, not before it. */
  type: 'categorical' | 'ordinal' | 'boolean';
  values?: string[];
  approx_cardinality?: number;
  parent?: string;
  high_cardinality?: boolean;
  /** Absent means true. False means filterable but never a grain. */
  groupable?: boolean;
  value_labels?: Record<string, string>;
  notes?: string;
}

export interface TimeDimension {
  label: string;
  expr: string;
  default?: boolean;
  coverage: [string, string];
  nullable?: boolean;
  notes?: string;
}

export interface Layer {
  version: string;
  time_anchor: {
    mode: 'max_data_date' | 'now';
    field: string;
    value: string;
    timezone: string;
  };
  snapshot_now: string | null;
  datasets: Record<string, {
    label: string;
    description: string;
    base_table: string;
    postgres_schema?: string;
    primary_key: string;
    grain: string;
    joins: unknown[];
    row_count: number;
    coverage: Record<string, [string, string]>;
  }>;
  parameters: {
    completed_statuses: string[];
    open_statuses: string[];
    exception_counts_as_late: boolean;
    /** Derived from exception_counts_as_late by the build step; substituted
     *  into metric filters as {{delayed_statuses}}. */
    delayed_statuses: string[];
    min_group_size: Record<string, number | null>;
    tail_threshold_days: number;
    flat_distribution_p: number;
    priority_quadrant: {
      rate_threshold: string;
      volume_threshold_pct: Record<string, number>;
    };
  };
  metrics: Record<string, Metric>;
  dimensions: Record<string, Dimension>;
  time_dimensions: Record<string, TimeDimension>;
  glossary: { terms: string[]; maps_to: string; note?: string }[];
  unanswerable: { pattern: string; reason: string }[];
}

/** True unless the dimension explicitly opts out. */
export function isGroupable(d: Dimension): boolean {
  return d.groupable !== false;
}

/** Per-dimension sample floor, falling back to the default. A null value means
 *  the dimension is never a valid reporting grain. */
export function minGroupSize(layer: Layer, dimension: string): number | null {
  const floors = layer.parameters.min_group_size;
  if (dimension in floors) return floors[dimension] ?? null;
  return floors['default'] ?? 30;
}
