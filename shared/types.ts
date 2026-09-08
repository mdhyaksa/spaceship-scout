/** Wire format between the Worker and the SPA. */
import type { QueryIR } from './ir.ts';
import type { ChartSpec } from '../worker/chart.ts';
import type { Sufficiency } from '../worker/sufficiency.ts';
import type { Column } from '../worker/compile.ts';
import type { ForecastResult, ForecastRefusal } from '../worker/forecast.ts';

export type { ChartSpec, Sufficiency, Column, ForecastResult, ForecastRefusal };

export interface MetricExplain {
  name: string;
  label: string;
  definition: string;
  notes?: string;
}

/** Everything needed to answer "where did this number come from?". Present on
 *  chat answers and on dashboard tiles alike - a KPI card is a one-cell query
 *  and gets the same treatment. */
export interface Explain {
  interpretation: string;
  metrics: MetricExplain[];
  dimensions: { name: string; label: string }[];
  filters: { field: string; label: string; op: string; value: string[] }[];
  time: {
    field: string;
    label: string;
    range: string;
    anchor: string;
    timezone: string;
    partial_period: boolean;
  } | null;
  warnings: string[];
  ir: QueryIR;
  sql: string;
  params: string[];
  layer_version: string;
  row_count: number;
  execution_ms: number;
  cached: boolean;
}

export interface AnswerData {
  columns: Column[];
  rows: Record<string, string | number | null>[];
  row_count: number;
  truncated: boolean;
}

export interface Answer {
  request_id: string;
  /** Only ever "verified" in this release: the raw-SQL path is deferred, so
   *  every answer is computed through the semantic layer. The field ships
   *  anyway so the pin gate does not have to be retrofitted. */
  trust: 'verified';
  status: 'ok' | 'clarify' | 'unanswerable' | 'invalid';
  text: string | null;
  chart: ChartSpec | null;
  data: AnswerData | null;
  explain: Explain | null;
  sufficiency: Sufficiency | null;
  forecast: ForecastResult | ForecastRefusal | null;
  /** status = clarify | unanswerable | invalid */
  message: string | null;
  errors: { code: string; field?: string; message: string }[];
}

export interface LayerCatalog {
  version: string;
  data_as_of: string;
  timezone: string;
  row_count: number;
  coverage: { order_date: [string, string]; delivery_date: [string, string] };
  metrics: { name: string; label: string; format: string; notes?: string; point_in_time?: boolean }[];
  dimensions: {
    name: string; label: string; type: string; groupable: boolean;
    values?: string[]; approx_cardinality?: number; min_group_size: number | null; notes?: string;
  }[];
  time_dimensions: { name: string; label: string; nullable?: boolean; notes?: string }[];
  parameters: {
    tail_threshold_days: number;
    exception_counts_as_late: boolean;
    flat_distribution_p: number;
    volume_threshold_pct: Record<string, number>;
  };
}

export interface CoverageRow {
  question: string;
  path: string;
  reason: string | null;
  count: number;
  last_seen: string;
}
