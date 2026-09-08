/**
 * Query IR — the contract between the model and everything downstream.
 *
 * The model's only job is to produce one of these. Validation, SQL
 * compilation, chart selection and forecasting are all deterministic from
 * here, which is why explainability falls out of the architecture instead of
 * being bolted on: the IR *is* the query plan shown to the user.
 *
 * Every field is required and nullable rather than optional. Strict
 * schema-constrained decoding (OpenRouter `strict: true`) rejects schemas with
 * optional properties, and a nullable-required field is the portable way to
 * say "may be absent".
 */
import * as z from 'zod/v4';

export const FILTER_OPS = [
  'eq', 'neq', 'in', 'not_in', 'gt', 'gte', 'lt', 'lte', 'between', 'is_null', 'is_not_null',
] as const;

export const TIME_GRAINS = ['day', 'week', 'month', 'quarter', 'year'] as const;

/** Values always arrive as strings; the compiler coerces per the field's
 *  declared type. One shape survives strict decoding far better than a union,
 *  and `between` is simply a two-element array. */
export const filterSchema = z.object({
  field: z.string(),
  op: z.enum(FILTER_OPS),
  value: z.array(z.string()),
});

export const rangeSchema = z.object({
  kind: z.enum(['relative', 'absolute', 'all_time']),
  /** relative only: "last 3 months" -> n 3, unit month */
  n: z.number().int().positive().nullable(),
  unit: z.enum(TIME_GRAINS).nullable(),
  /** relative only: exclude the current, incomplete period. Default true. */
  complete_periods: z.boolean().nullable(),
  /** absolute only, inclusive, ISO dates */
  start: z.string().nullable(),
  end: z.string().nullable(),
});

export const timeSchema = z.object({
  field: z.string(),
  /** Null means "filter by time but do not break the result out by it". */
  grain: z.enum(TIME_GRAINS).nullable(),
  range: rangeSchema,
});

export const sortSchema = z.object({
  by: z.string(),
  dir: z.enum(['asc', 'desc']),
});

export const forecastSchema = z.object({
  target_metric: z.string(),
  series_filters: z.array(filterSchema),
  horizon_n: z.number().int().positive(),
  /** Month is the only viable grain on this data: 12 points at any grain
   *  coarser, and single-digit counts at any grain finer. */
  horizon_unit: z.literal('month'),
  history_window_n: z.number().int().positive().nullable(),
  method: z.enum(['auto', 'moving_average', 'linear_trend', 'ses']),
  lead_time_days: z.number().int().positive().nullable(),
  service_level: z.number().nullable(),
  current_on_hand: z.number().nullable(),
});

export const queryIrSchema = z.object({
  version: z.literal('1.0'),
  /** The routing decision. Not a separate model call — this enum is what
   *  dispatches to the query tool or the forecast tool. */
  intent: z.enum(['aggregate', 'scalar', 'forecast', 'clarify', 'unanswerable']),
  dataset: z.literal('orders'),
  metrics: z.array(z.string()).max(4),
  /** Three or more dimensions is nearly always a misparse. */
  dimensions: z.array(z.string()).max(2),
  time: timeSchema.nullable(),
  filters: z.array(filterSchema),
  sort: z.array(sortSchema),
  limit: z.number().int().positive().nullable(),
  forecast: forecastSchema.nullable(),
  /** intent = clarify: what to ask the user. */
  clarify_question: z.string().nullable(),
  /** intent = unanswerable: why, in the user's terms. */
  unanswerable_reason: z.string().nullable(),
  /** Below 0.5 routes to clarify regardless of what intent says. */
  confidence: z.number().min(0).max(1),
  /** One sentence, shown in the explainability panel. */
  interpretation: z.string(),
});

export type QueryIR = z.infer<typeof queryIrSchema>;
export type Filter = z.infer<typeof filterSchema>;
export type TimeSpec = z.infer<typeof timeSchema>;
export type Range = z.infer<typeof rangeSchema>;
export type ForecastSpec = z.infer<typeof forecastSchema>;

/** JSON Schema for the planner's single forced tool call. */
export function irJsonSchema(): Record<string, unknown> {
  return z.toJSONSchema(queryIrSchema, { target: 'draft-7' }) as Record<string, unknown>;
}

/** An empty plan, used as the base for hand-written IRs (dashboard tiles and
 *  tests) so they never have to spell out every nullable field. */
export function emptyIR(patch: Partial<QueryIR> = {}): QueryIR {
  return {
    version: '1.0',
    intent: 'aggregate',
    dataset: 'orders',
    metrics: [],
    dimensions: [],
    time: null,
    filters: [],
    sort: [],
    limit: null,
    forecast: null,
    clarify_question: null,
    unanswerable_reason: null,
    confidence: 1,
    interpretation: '',
    ...patch,
  };
}
