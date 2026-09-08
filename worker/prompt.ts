/**
 * The planner prompt is rendered from the semantic layer at request time.
 *
 * This is the one deliberate boundary crossing in the architecture: the
 * glossary has to reach the model, because it cannot map "courier" onto
 * `carrier` without being told. It is acceptable only under one condition -
 * the catalog and glossary are a versioned artifact injected at runtime and
 * never hand-edited inside a prompt string. layer_version is logged on every
 * request as the audit trail.
 */
import type { Layer } from '../shared/layer-types.ts';
import { isGroupable, minGroupSize } from '../shared/layer-types.ts';
import { dataAsOf } from './time.ts';

export function renderCatalog(layer: Layer): string {
  const metrics = Object.entries(layer.metrics)
    .map(([name, m]) => {
      const notes = m.notes ? `\n      note: ${m.notes.trim().replace(/\s+/g, ' ')}` : '';
      const pit = m.point_in_time === false ? '\n      note: cannot be grouped by a time grain' : '';
      return `  ${name} — ${m.label} (${m.format})${notes}${pit}`;
    })
    .join('\n');

  const dimensions = Object.entries(layer.dimensions)
    .map(([name, d]) => {
      const grain = isGroupable(d) ? 'groupable' : 'FILTER ONLY, never a grain';
      const values = d.values ? `\n      values: ${d.values.join(', ')}` : '';
      const card = !d.values && d.approx_cardinality ? `\n      about ${d.approx_cardinality} distinct values` : '';
      const floor = minGroupSize(layer, name);
      const min = floor === null ? '' : `\n      minimum reportable sample: ${floor}`;
      const notes = d.notes ? `\n      note: ${d.notes.trim().replace(/\s+/g, ' ')}` : '';
      return `  ${name} — ${d.label} [${grain}]${values}${card}${min}${notes}`;
    })
    .join('\n');

  const times = Object.entries(layer.time_dimensions)
    .map(([name, t]) => `  ${name} — ${t.label}, covers ${t.coverage[0]} to ${t.coverage[1]}${t.nullable ? ' (null for 30 of 400 orders)' : ''}`)
    .join('\n');

  const glossary = layer.glossary
    .map((g) => `  ${g.terms.join(', ')} -> ${g.maps_to}${g.note ? ` (${g.note.trim().replace(/\s+/g, ' ')})` : ''}`)
    .join('\n');

  const unanswerable = layer.unanswerable
    .map((u) => `  ${u.pattern} -> ${u.reason.trim().replace(/\s+/g, ' ')}`)
    .join('\n');

  return `METRICS\n${metrics}\n\nDIMENSIONS\n${dimensions}\n\nTIME DIMENSIONS\n${times}\n\nGLOSSARY\n${glossary}\n\nUNANSWERABLE — return intent "unanswerable" with the reason\n${unanswerable}`;
}

export function systemPrompt(layer: Layer): string {
  const anchor = dataAsOf(layer);
  return `You turn a question about logistics data into a query plan. You never answer the question yourself and you never invent a number: a deterministic compiler runs your plan and the result is what the user sees.

RULES
- Emit exactly one submit_query_plan tool call. Never write prose, never write SQL.
- Only use metric and dimension names that appear in the catalog below. Never invent one.
- Prefer intent "clarify" over guessing. A confident wrong answer is the most expensive failure this system has.
- Set confidence honestly. Below 0.5 is routed to clarify whatever intent you chose.
- Metrics: 1 to 4. Dimensions: 0 to 2. Three or more dimensions is nearly always a misparse.
- Never use a FILTER ONLY dimension as a dimension. It may still appear in filters.
- Rates already have their denominator handled by the compiler. Ask for delay_rate, never for delayed_count divided by something.
- interpretation is one sentence describing the plan in the user's terms. It is shown to the user.

TIME
The data ends ${anchor}. All relative ranges resolve against that anchor, never against today's date.
  "last month"        -> relative, n 1, unit month, complete_periods true    => ${anchor.slice(0, 4)}-11
  "last 3 months"     -> relative, n 3, unit month, complete_periods false   => Oct to Dec
  "past 30 days"      -> relative, n 30, unit day, complete_periods false
  "this month"        -> relative, n 1, unit month, complete_periods false   => December, partial
  "2025" / "last year"-> absolute, start 2025-01-01, end 2025-12-31
  no period mentioned -> all_time
Use complete_periods true only when the user asks for whole or completed periods, or says "last month".

FORECASTING
Set intent "forecast" and fill the forecast block for any question about future demand or inventory planning.
Month is the only supported grain. A SKU-level forecast is refused downstream with a category fallback, so still emit the plan with the sku filter and let the service explain why.

${renderCatalog(layer)}`;
}

/** Few-shot examples. Two of them exercise the delivered/delayed denominator
 *  trap, which is the single most likely way to get a plausible wrong number
 *  out of this dataset. */
export function fewShots(): { question: string; plan: Record<string, unknown> }[] {
  const base = {
    version: '1.0', dataset: 'orders', dimensions: [] as string[], time: null,
    filters: [] as unknown[], sort: [] as unknown[], limit: null, forecast: null,
    clarify_question: null, unanswerable_reason: null,
  };
  return [
    {
      question: 'How many orders were delivered late last month?',
      plan: { ...base, intent: 'scalar', metrics: ['delayed_count'],
        time: { field: 'order_date', grain: null, range: { kind: 'relative', n: 1, unit: 'month', complete_periods: true, start: null, end: null } },
        confidence: 0.93, interpretation: 'Count of delayed orders placed in November 2025, the last complete month of data.' },
    },
    {
      question: 'Which carrier has the highest delay rate?',
      plan: { ...base, intent: 'aggregate', metrics: ['delay_rate'], dimensions: ['carrier'],
        sort: [{ by: 'delay_rate', dir: 'desc' }], confidence: 0.95,
        interpretation: 'Delay rate by carrier across all available data, highest first.' },
    },
    {
      question: 'What share of deliveries arrive on time?',
      plan: { ...base, intent: 'scalar', metrics: ['on_time_rate'], confidence: 0.95,
        interpretation: 'On-time deliveries as a share of all completed deliveries.' },
    },
    {
      question: 'Show delayed orders by week for the last 3 months',
      plan: { ...base, intent: 'aggregate', metrics: ['delayed_count'],
        time: { field: 'order_date', grain: 'week', range: { kind: 'relative', n: 3, unit: 'month', complete_periods: false, start: null, end: null } },
        confidence: 0.9, interpretation: 'Weekly count of delayed orders over the last three months of data.' },
    },
    {
      question: 'Delay rate by region for US lanes',
      plan: { ...base, intent: 'aggregate', metrics: ['delay_rate'], dimensions: ['region'],
        filters: [{ field: 'region', op: 'in', value: ['US-C', 'US-E', 'US-W'] }],
        sort: [{ by: 'delay_rate', dir: 'desc' }], confidence: 0.88,
        interpretation: 'Delay rate across the three US regions.' },
    },
    {
      question: 'How many orders are in transit right now?',
      plan: { ...base, intent: 'unanswerable', metrics: [], confidence: 0.94,
        unanswerable_reason: 'In-transit orders in this dataset carry no capture timestamp and span the whole year, so there is no "right now" to report. The historical count of orders labelled in transit is available instead.',
        interpretation: 'Asks for a live backlog the data cannot support.' },
    },
    {
      question: 'Which orders are running late at the moment?',
      plan: { ...base, intent: 'unanswerable', metrics: [], confidence: 0.92,
        unanswerable_reason: 'There is no promised delivery date in this dataset, so lateness is only known once an order reaches a final status. Historical delay rate is available instead.',
        interpretation: 'Asks for current lateness, which requires a promised date the data does not have.' },
    },
    {
      question: 'What did shipping cost us last month?',
      plan: { ...base, intent: 'unanswerable', metrics: [], confidence: 0.95,
        unanswerable_reason: 'This dataset has no cost, freight or margin columns.',
        interpretation: 'Asks for cost data that is not present.' },
    },
    {
      question: 'Predict demand for SKU PAPER-0197 for the next 4 months',
      plan: { ...base, intent: 'forecast', metrics: ['order_count'],
        forecast: { target_metric: 'units_ordered', series_filters: [{ field: 'sku', op: 'eq', value: ['PAPER-0197'] }], horizon_n: 4, horizon_unit: 'month', history_window_n: null, method: 'auto', lead_time_days: 21, service_level: 0.95, current_on_hand: null },
        confidence: 0.9, interpretation: 'Four-month demand forecast for one SKU.' },
    },
    {
      question: 'How much inventory should I plan for crayons over the next quarter?',
      plan: { ...base, intent: 'forecast', metrics: ['units_ordered'],
        forecast: { target_metric: 'units_ordered', series_filters: [{ field: 'product_category', op: 'eq', value: ['CRAYON'] }], horizon_n: 3, horizon_unit: 'month', history_window_n: null, method: 'auto', lead_time_days: 21, service_level: 0.95, current_on_hand: null },
        confidence: 0.87, interpretation: 'Three-month unit demand forecast for CRAYON with an inventory recommendation.' },
    },
    {
      question: 'How is it going?',
      plan: { ...base, intent: 'clarify', metrics: [], confidence: 0.2,
        clarify_question: 'Which measure would you like — on-time rate, delay rate, order volume, or delivery speed? And over what period?',
        interpretation: 'Too broad to plan without knowing the measure.' },
    },
    {
      question: 'Show me the worst performers',
      plan: { ...base, intent: 'clarify', metrics: [], confidence: 0.3,
        clarify_question: 'Worst by what — delay rate, exception rate, or slowest average transit? And broken down by carrier, lane, warehouse or client?',
        interpretation: 'Neither the metric nor the dimension is stated.' },
    },
    {
      question: 'Revenue by product category',
      plan: { ...base, intent: 'aggregate', metrics: ['gross_revenue'], dimensions: ['product_category'],
        sort: [{ by: 'gross_revenue', dir: 'desc' }], confidence: 0.85,
        interpretation: 'Gross revenue by product category, before promotional discount.' },
    },
    {
      question: 'How slow is our worst lane?',
      plan: { ...base, intent: 'aggregate', metrics: ['avg_transit_days', 'p90_transit_days'], dimensions: ['lane'],
        sort: [{ by: 'avg_transit_days', dir: 'desc' }], limit: 20, confidence: 0.8,
        interpretation: 'Lanes ranked by average transit days, with the 90th percentile alongside.' },
    },
  ];
}
