/**
 * Worker routes. All computation lives here; the SPA is a view layer.
 *
 *   GET  /api/layer      catalog the UI needs for labels and filter chips
 *   POST /api/tiles      dashboard tiles, cached, refreshable per tile
 *   POST /api/query      natural language question -> plan -> result
 *   POST /api/forecast   direct forecast, for the Forecast view
 *   GET  /api/coverage   what the layer could not answer
 */
import { layer } from '../semantic/layer.generated.ts';
import type { Filter, QueryIR } from '../shared/ir.ts';
import type { Answer, CoverageRow } from '../shared/types.ts';
import { emptyIR, queryIrSchema } from '../shared/ir.ts';
import { d1Database, type Database } from './db.ts';
import { resolveRange } from './time.ts';
import { execute } from './execute.ts';
import { buildCatalog } from './catalog.ts';
import { breakdownIR, findTile, TILES } from './tiles.ts';
import { openRouterPlanner } from './planner.ts';
import { writeLog } from './log.ts';

export interface Env {
  DB: D1Database;
  /** The static asset router. Assets are served before the Worker runs; this
   *  binding exists so the Worker can hand non-API paths back to it. */
  ASSETS: { fetch(request: Request): Promise<Response> };
  OPENROUTER_API_KEY?: string;
  OPENROUTER_MODEL?: string;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    // Anything that is not an API call is the SPA's problem. Handing it back
    // to the asset router applies not_found_handling, so a deep link returns
    // index.html rather than a 404.
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
    const db = d1Database(env.DB);
    try {
      return await route(url.pathname, request, env, db);
    } catch (e) {
      return json({ error: (e as Error).message }, 500);
    }
  },
};

async function route(path: string, request: Request, env: Env, db: Database): Promise<Response> {
  if (path === '/api/layer') return json(buildCatalog(layer));
  if (path === '/api/tiles') return handleTiles(request, db);
  if (path === '/api/run') return handleRun(request, db);
  if (path === '/api/query') return handleQuery(request, env, db);
  if (path === '/api/forecast') return handleForecast(request, db);
  if (path === '/api/coverage') return handleCoverage(db);
  return json({ error: 'Unknown route' }, 404);
}

function requestId(): string {
  return `req_${crypto.randomUUID().replace(/-/g, '').slice(0, 20)}`;
}

/**
 * Period presets resolve on the server, not in the browser. The anchor and the
 * "what does last month mean" rule are business logic, and duplicating them in
 * the SPA is how the two drift apart.
 */
const PERIOD_PRESETS: Record<string, { kind: 'relative' | 'all_time'; n: number | null; unit: 'month' | null; complete: boolean | null }> = {
  all: { kind: 'all_time', n: null, unit: null, complete: null },
  this_month: { kind: 'relative', n: 1, unit: 'month', complete: false },
  last_month: { kind: 'relative', n: 1, unit: 'month', complete: true },
  last_3_months: { kind: 'relative', n: 3, unit: 'month', complete: false },
  last_6_months: { kind: 'relative', n: 6, unit: 'month', complete: false },
};

function periodFilter(preset: string | undefined): Filter[] {
  const spec = PERIOD_PRESETS[preset ?? 'all'];
  if (!spec || spec.kind === 'all_time') return [];
  const resolved = resolveRange(
    { kind: 'relative', n: spec.n, unit: spec.unit, complete_periods: spec.complete, start: null, end: null },
    layer,
  );
  return [{ field: 'order_date', op: 'between', value: [resolved.start, resolved.end] }];
}

async function handleTiles(request: Request, db: Database): Promise<Response> {
  const body = (await request.json()) as {
    filters?: Filter[];
    period?: string;
    refresh?: string | null;
    breakdownDimension?: string;
    tiles?: string[];
  };
  const filters = [...(body.filters ?? []), ...periodFilter(body.period)];
  const wanted = body.tiles?.length ? body.tiles : TILES.map((t) => t.id);

  const out: Record<string, Answer> = {};
  for (const id of wanted) {
    const tile = findTile(id);
    if (!tile) continue;
    const ir =
      id === 'chart_breakdown'
        ? breakdownIR(body.breakdownDimension ?? 'carrier', filters)
        : tile.ir(filters);
    out[id] = await execute(ir, layer, db, {
      requestId: requestId(),
      cacheable: true,
      refresh: body.refresh === id || body.refresh === 'all',
    });
  }
  return json(out);
}

/**
 * Execute a plan the client already holds — a pinned answer, re-run on load.
 *
 * Pinning saves the IR rather than the result, so a pinned tile stays current
 * and inherits the same cache and refresh behaviour as a built-in one. Running
 * a client-supplied plan grants no power the chat does not already have: it
 * goes through the same validator and compiler, and an invalid plan is
 * refused rather than executed.
 */
async function handleRun(request: Request, db: Database): Promise<Response> {
  const body = (await request.json()) as { ir?: QueryIR; refresh?: boolean };
  if (!body.ir) return json({ error: 'A plan is required.' }, 400);
  const parsed = queryIrSchema.safeParse(body.ir);
  if (!parsed.success) {
    return json({ error: `That plan does not match the schema: ${parsed.error.issues.map((i) => i.message).join('; ')}` }, 400);
  }
  return json(await execute(parsed.data, layer, db, { requestId: requestId(), cacheable: true, refresh: body.refresh }));
}

async function handleQuery(request: Request, env: Env, db: Database): Promise<Response> {
  const body = (await request.json()) as { question?: string; context?: QueryIR | null };
  const question = (body.question ?? '').trim();
  const id = requestId();
  if (!question) return json({ error: 'A question is required.' }, 400);

  if (!env.OPENROUTER_API_KEY) {
    return json({
      request_id: id, trust: 'verified', status: 'invalid',
      message: 'The planner is not configured: OPENROUTER_API_KEY is unset. Dashboard tiles still work, because they are hand-written plans that never touch a model.',
      text: null, chart: null, data: null, explain: null, sufficiency: null, forecast: null, errors: [],
    } satisfies Answer, 503);
  }

  const planner = openRouterPlanner(env.OPENROUTER_API_KEY, env.OPENROUTER_MODEL ?? 'anthropic/claude-sonnet-4.5');
  const contextNote = body.context
    ? `\n\n[The user is looking at a tile with this plan; treat it as the starting context: ${JSON.stringify({ metrics: body.context.metrics, dimensions: body.context.dimensions, filters: body.context.filters, time: body.context.time })}]`
    : '';
  const planned = await planner.plan(question + contextNote, layer);

  if (!planned.ir) {
    await writeLog(db, layer, {
      requestId: id, question, path: 'planner_failed',
      modelId: planned.modelId, plannerLatencyMs: planned.latencyMs,
      clarifyReason: planned.error,
    });
    return json({
      request_id: id, trust: 'verified', status: 'invalid',
      message: `The planner could not produce a valid plan. ${planned.error ?? ''}`.trim(),
      text: null, chart: null, data: null, explain: null, sufficiency: null, forecast: null, errors: [],
    } satisfies Answer, 502);
  }

  const answer = await execute(planned.ir, layer, db, { requestId: id, cacheable: false });

  await writeLog(db, layer, {
    requestId: id,
    question,
    path:
      answer.status === 'ok' ? 'ir'
      : answer.status === 'clarify' ? 'clarify'
      : answer.status === 'unanswerable' ? 'unanswerable'
      : 'invalid',
    intent: planned.ir.intent,
    ir: planned.ir,
    sql: answer.explain?.sql ?? null,
    validatorErrors: answer.errors.length ? answer.errors : null,
    clarifyReason: answer.message,
    modelId: planned.modelId,
    plannerLatencyMs: planned.latencyMs,
    queryLatencyMs: answer.explain?.execution_ms ?? null,
    rowCount: answer.data?.row_count ?? null,
  });

  return json(answer);
}

async function handleForecast(request: Request, db: Database): Promise<Response> {
  const body = (await request.json()) as {
    target_metric?: string;
    category?: string | null;
    region?: string | null;
    sku?: string | null;
    horizon?: number;
    lead_time_days?: number | null;
    service_level?: number | null;
    current_on_hand?: number | null;
  };
  const filters: Filter[] = [];
  if (body.category) filters.push({ field: 'product_category', op: 'eq', value: [body.category] });
  if (body.region) filters.push({ field: 'region', op: 'eq', value: [body.region] });
  if (body.sku) filters.push({ field: 'sku', op: 'eq', value: [body.sku] });

  const ir = emptyIR({
    intent: 'forecast',
    metrics: [body.target_metric ?? 'units_ordered'],
    forecast: {
      target_metric: body.target_metric ?? 'units_ordered',
      series_filters: filters,
      horizon_n: body.horizon ?? 4,
      horizon_unit: 'month',
      history_window_n: null,
      method: 'auto',
      lead_time_days: body.lead_time_days ?? 21,
      service_level: body.service_level ?? 0.95,
      current_on_hand: body.current_on_hand ?? null,
    },
    interpretation: `Demand forecast${body.category ? ` for ${body.category}` : ''}${body.sku ? ` for SKU ${body.sku}` : ''} over the next ${body.horizon ?? 4} months.`,
  });

  return json(await execute(ir, layer, db, { requestId: requestId(), cacheable: false }));
}

/**
 * A question that repeatedly falls through is a missing semantic layer object.
 * With the raw-SQL path deferred, the fall-through classes are clarify,
 * unanswerable, planner_failed and verified-but-empty - which is exactly what
 * this page should show.
 */
async function handleCoverage(db: Database): Promise<Response> {
  const rows = await db.run<{
    question_normalized: string; path: string; clarify_reason: string | null;
    n: number; last_seen: string;
  }>(
    `SELECT question_normalized, path, MAX(clarify_reason) AS clarify_reason,
            COUNT(*) AS n, MAX(occurred_at) AS last_seen
       FROM nl_query_log
      WHERE question_normalized IS NOT NULL
        AND (path IN ('clarify','unanswerable','planner_failed','invalid') OR returned_empty = 1)
      GROUP BY question_normalized, path
      ORDER BY n DESC, last_seen DESC
      LIMIT 100`,
  );
  const totals = await db.run<{ path: string; n: number }>(
    `SELECT path, COUNT(*) AS n FROM nl_query_log GROUP BY path`,
  );
  const coverage: CoverageRow[] = rows.map((r) => ({
    question: r.question_normalized,
    path: r.path,
    reason: r.clarify_reason,
    count: Number(r.n),
    last_seen: r.last_seen,
  }));
  return json({ rows: coverage, totals });
}
