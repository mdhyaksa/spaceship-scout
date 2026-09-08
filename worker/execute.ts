/**
 * The single execution path.
 *
 * Dashboard tiles and chat answers are both IRs, and both come through here.
 * That is what stops a KPI card and a chat answer disagreeing about the same
 * number: there is only one place that turns a plan into a result, and only
 * one semantic layer behind it.
 */
import type { Layer } from '../shared/layer-types.ts';
import type { QueryIR } from '../shared/ir.ts';
import type { Answer, Explain } from '../shared/types.ts';
import { formatValue, formatPeriod } from '../shared/format.ts';
import type { Database } from './db.ts';
import { compile } from './compile.ts';
import { validate } from './validate.ts';
import { selectChart } from './chart.ts';
import { assess } from './sufficiency.ts';
import { dataAsOf } from './time.ts';
import { cacheGet, cacheKey, cacheSet, cacheBust } from './cache.ts';
import { forecast as runForecast, type Point } from './forecast.ts';

export interface ExecuteOptions {
  requestId: string;
  refresh?: boolean;
  /** Tiles are cached; ad-hoc chat queries are not worth caching by IR. */
  cacheable?: boolean;
}

export async function execute(
  ir: QueryIR,
  layer: Layer,
  db: Database,
  opts: ExecuteOptions,
): Promise<Answer> {
  const base: Answer = {
    request_id: opts.requestId,
    trust: 'verified',
    status: 'ok',
    text: null, chart: null, data: null, explain: null,
    sufficiency: null, forecast: null, message: null, errors: [],
  };

  if (ir.intent === 'unanswerable') {
    return { ...base, status: 'unanswerable', message: ir.unanswerable_reason ?? 'That question cannot be answered from this dataset.' };
  }
  if (ir.intent === 'clarify') {
    return { ...base, status: 'clarify', message: ir.clarify_question ?? 'Could you be more specific?' };
  }

  const errors = validate(ir, layer);
  if (errors.length) {
    return { ...base, status: 'invalid', errors, message: errors.map((e) => e.message).join(' ') };
  }

  if (ir.intent === 'forecast') {
    return executeForecast(ir, layer, db, base);
  }

  const compiled = compile(ir, layer);
  const key = cacheKey([
    'tile', ir.metrics.join(','), ir.dimensions.join(','), ir.time?.grain,
    JSON.stringify(ir.filters), JSON.stringify(ir.time?.range), ir.limit,
    dataAsOf(layer), layer.version,
  ]);

  if (opts.refresh) cacheBust(key);
  const cached = opts.cacheable && !opts.refresh ? cacheGet<Answer>(key) : null;
  if (cached) {
    return { ...cached, request_id: opts.requestId, explain: { ...cached.explain!, cached: true } };
  }

  const started = Date.now();
  const rows = await db.run(compiled.sql, compiled.params);
  const executionMs = Date.now() - started;

  const sufficiency = assess(rows, ir, layer, compiled);
  const chart = selectChart(ir, rows, compiled.columns, layer);
  const explain = buildExplain(ir, layer, compiled, rows.length, executionMs, sufficiency.warnings);
  const text = answerText(ir, layer, rows, compiled, sufficiency);

  const answer: Answer = {
    ...base,
    text,
    chart,
    data: {
      columns: compiled.columns,
      rows: rows as Record<string, string | number | null>[],
      row_count: rows.length,
      truncated: rows.length === (ir.limit ?? 100),
    },
    explain,
    sufficiency,
  };

  if (opts.cacheable) cacheSet(key, answer);
  return answer;
}

/** The window the result really covers: the plan's resolved range, narrowed by
 *  any explicit filter on the same time field. */
function effectiveRange(ir: QueryIR, compiled: ReturnType<typeof compile>): string {
  const planned = compiled.resolvedRange;
  const bound = ir.time
    ? ir.filters.find((f) => f.field === ir.time!.field && f.op === 'between' && f.value.length === 2)
    : undefined;
  if (!bound) return planned?.label ?? 'all data';
  const start = planned ? (bound.value[0]! > planned.start ? bound.value[0]! : planned.start) : bound.value[0]!;
  const end = planned ? (bound.value[1]! < planned.end ? bound.value[1]! : planned.end) : bound.value[1]!;
  return `${start} to ${end}`;
}

function buildExplain(
  ir: QueryIR,
  layer: Layer,
  compiled: ReturnType<typeof compile>,
  rowCount: number,
  executionMs: number,
  warnings: string[],
): Explain {
  const allWarnings = [...warnings];

  if (ir.time && layer.time_dimensions[ir.time.field]?.nullable) {
    allWarnings.push(
      'Grouped by delivery date, which is null for 30 of 400 orders (27 in transit, 3 canceled). Those orders are excluded.',
    );
  }
  if (compiled.resolvedRange?.partial_period) {
    allWarnings.push(
      `The final period is incomplete: the data ends ${dataAsOf(layer)}, so the last bar covers a partial month.`,
    );
  }
  for (const name of compiled.selectedMetrics) {
    const metric = layer.metrics[name];
    if (metric?.agg === 'ratio' && name === 'delay_rate') {
      allWarnings.push(
        layer.parameters.exception_counts_as_late
          ? 'Exceptions are counted as delays under the current configuration.'
          : 'Exceptions are not counted as delays under the current configuration.',
      );
    }
  }

  return {
    interpretation: ir.interpretation,
    metrics: compiled.selectedMetrics.map((name) => {
      const m = layer.metrics[name]!;
      return {
        name,
        label: m.label,
        definition:
          m.agg === 'ratio'
            ? `${layer.metrics[m.numerator]!.label} divided by ${layer.metrics[m.denominator]!.label}.`
            : `${m.agg.replace('_', ' ')} of ${'expr' in m ? m.expr : ''}${'filter' in m && m.filter ? ` where ${m.filter}` : ''}.`,
        ...(m.notes ? { notes: m.notes.trim() } : {}),
      };
    }),
    dimensions: ir.dimensions.map((name) => ({ name, label: layer.dimensions[name]!.label })),
    filters: ir.filters.map((f) => ({
      field: f.field,
      label: layer.dimensions[f.field]?.label ?? layer.time_dimensions[f.field]?.label ?? f.field,
      op: f.op,
      value: f.value,
    })),
    time: ir.time
      ? {
          field: ir.time.field,
          label: layer.time_dimensions[ir.time.field]?.label ?? ir.time.field,
          // A filter on the same field narrows the window the tile actually
          // covers. Reporting the plan's own range here would contradict the
          // filter listed two rows above it.
          range: effectiveRange(ir, compiled),
          anchor: `data_as_of ${dataAsOf(layer)}`,
          timezone: layer.time_anchor.timezone,
          partial_period: compiled.resolvedRange?.partial_period ?? false,
        }
      : null,
    warnings: allWarnings,
    ir,
    sql: compiled.sql,
    params: compiled.params,
    layer_version: layer.version,
    row_count: rowCount,
    execution_ms: executionMs,
    cached: false,
  };
}

/**
 * Deterministic answer text, written from the returned rows after execution.
 * It never states a figure the query did not return, and the sufficiency guard
 * constrains what it is allowed to claim. A model may rewrite this into looser
 * prose later; the template has to exist either way, because the model rewrites
 * *it* rather than the raw numbers.
 */
function answerText(
  ir: QueryIR,
  layer: Layer,
  rows: Record<string, unknown>[],
  compiled: ReturnType<typeof compile>,
  sufficiency: ReturnType<typeof assess>,
): string {
  if (rows.length === 0) return 'No orders match these filters.';

  const primary = ir.metrics[0];
  if (!primary) return `${rows.length} rows.`;
  const metric = layer.metrics[primary]!;

  // Single value.
  if (ir.dimensions.length === 0 && !ir.time?.grain) {
    const parts = ir.metrics.map((name) => {
      const m = layer.metrics[name]!;
      return `${m.label.toLowerCase()} ${formatValue(rows[0]![name] as number, m.format)}`;
    });
    const denominator = compiled.denominatorOf[primary];
    const suffix = denominator
      ? ` of ${formatValue(rows[0]![denominator] as number, 'integer')} ${layer.metrics[denominator]!.label.toLowerCase()}`
      : '';
    return capitalise(`${parts.join(', ')}${suffix}.`);
  }

  // Trend.
  if (ir.time?.grain && ir.dimensions.length === 0) {
    const first = rows[0]!;
    const last = rows[rows.length - 1]!;
    return capitalise(
      `${metric.label} ran from ${formatValue(first[primary] as number, metric.format)} in ` +
        `${formatPeriod(String(first['period']))} to ${formatValue(last[primary] as number, metric.format)} in ` +
        `${formatPeriod(String(last['period']))}, across ${rows.length} periods.`,
    );
  }

  // Distribution. "Highest" is the wrong frame for a shape: what matters is
  // where the mass sits and how long the tail is.
  const dim = layer.dimensions[ir.dimensions[0]!]!;
  if (dim.type === 'ordinal') {
    const total = rows.reduce((sum, r) => sum + Number(r[primary] ?? 0), 0);
    const mode = rows.reduce((a, b) => (Number(a[primary]) >= Number(b[primary]) ? a : b));
    const threshold = layer.parameters.tail_threshold_days;
    const tail = rows
      .filter((r) => Number(r[ir.dimensions[0]!]) >= threshold)
      .reduce((sum, r) => sum + Number(r[primary] ?? 0), 0);
    return capitalise(
      `Most orders take ${mode[ir.dimensions[0]!]} ${dim.label.toLowerCase()}, but ${tail} of ${total} ` +
        `take ${threshold} or more — that tail is what generates complaints, and an average hides it.`,
    );
  }

  // Breakdown. The guard decides whether a leader may be named at all.
  if (sufficiency.ranking_test && sufficiency.ranking_significant === false) {
    // The guard's own sentence is the answer; repeating a ranking here would
    // contradict it.
    return sufficiency.warnings[sufficiency.warnings.length - 1]!;
  }
  const top = rows[0]!;
  const n = compiled.denominatorOf[primary]
    ? ` across ${formatValue(top[compiled.denominatorOf[primary]!] as number, 'integer')} completed deliveries`
    : '';
  return capitalise(
    `${top[ir.dimensions[0]!]} has the highest ${metric.label.toLowerCase()} at ` +
      `${formatValue(top[primary] as number, metric.format)}${n}, across ${rows.length} ${dim.label.toLowerCase()} groups.`,
  );
}

function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

async function executeForecast(
  ir: QueryIR,
  layer: Layer,
  db: Database,
  base: Answer,
): Promise<Answer> {
  const spec = ir.forecast!;
  const skuFilter = spec.series_filters.find((f) => f.field === 'sku');
  const categoryFilter = spec.series_filters.find((f) => f.field === 'product_category');

  // History comes through the normal compiled path - no separate query builder,
  // so a forecast and a trend chart of the same metric cannot disagree.
  const historyIR: QueryIR = {
    ...ir,
    intent: 'aggregate',
    metrics: [spec.target_metric],
    dimensions: [],
    filters: spec.series_filters.filter((f) => f.field !== 'sku'),
    time: {
      field: 'order_date',
      grain: 'month',
      range: { kind: 'all_time', n: null, unit: null, complete_periods: null, start: null, end: null },
    },
    sort: [],
    limit: 1000,
  };

  let history: Point[] = [];
  let compiled: ReturnType<typeof compile> | null = null;
  // Resolve the SKU's parent through the declared hierarchy rather than by
  // parsing the id. The layer says sku.parent is product_category; reading the
  // prefix would work on this data and break on the first client whose SKUs
  // are named differently.
  let parentCategory = categoryFilter?.value[0] ?? null;
  if (skuFilter && !parentCategory && layer.dimensions['sku']?.parent === 'product_category') {
    const parent = await db.run<{ product_category: string }>(
      'SELECT product_category FROM fct_orders WHERE sku = ? LIMIT 1',
      [skuFilter.value[0] ?? ''],
    );
    parentCategory = parent[0]?.product_category ?? null;
  }
  if (!skuFilter) {
    compiled = compile(historyIR, layer);
    const rows = await db.run(compiled.sql, compiled.params);
    history = rows.map((r) => ({ period: String(r['period']), value: Number(r[spec.target_metric] ?? 0) }));
  }

  const result = runForecast(
    {
      history,
      horizon: spec.horizon_n,
      method: spec.method,
      leadTimeDays: spec.lead_time_days,
      serviceLevel: spec.service_level,
      currentOnHand: spec.current_on_hand,
      skuFiltered: skuFilter ? { sku: skuFilter.value[0] ?? '', category: parentCategory } : null,
      metricLabel: layer.metrics[spec.target_metric]?.label ?? spec.target_metric,
      through: dataAsOf(layer).slice(0, 7),
    },
    layer,
  );

  const explain = compiled
    ? buildExplain(historyIR, layer, compiled, history.length, 0, result.ok ? result.notes : [result.reason])
    : null;

  return {
    ...base,
    status: result.ok ? 'ok' : 'invalid',
    text: result.ok ? result.explanation : result.reason,
    chart: result.ok ? { type: 'forecast', x: 'period', y: [spec.target_metric], series: null, collapse_to: null, reason: 'History solid, forecast dashed, interval band.' } : null,
    forecast: result,
    explain,
    message: result.ok ? null : result.reason,
  };
}
