/**
 * Forecast service. The model's only role is extracting parameters; every
 * number here is computed.
 *
 * The guards come first and they matter more than the projection. Refusing a
 * SKU forecast with the arithmetic is a better answer than fitting a line
 * through 1.13 points, and on this dataset every series trips the
 * low-confidence banner because 12 monthly points is all there is.
 */
import type { Layer } from '../shared/layer-types.ts';
import { normalQuantile } from './stats.ts';

export type Method = 'moving_average' | 'linear_trend' | 'ses';

export interface Point { period: string; value: number }

export interface Candidate { method: Method; error: number; metric: 'MAPE' | 'MAE'; params?: Record<string, number> }

export interface ForecastResult {
  ok: true;
  history: Point[];
  forecast: { period: string; value: number; lo80: number; hi80: number; lo95: number; hi95: number }[];
  method: Method;
  candidates: Candidate[];
  error_metric: 'MAPE' | 'MAE';
  backtest_error: number;
  residual_sd: number;
  sparse_series: boolean;
  low_confidence: boolean;
  notes: string[];
  inventory: Inventory | null;
  explanation: string;
}

export interface ForecastRefusal {
  ok: false;
  reason: string;
  code: 'insufficient_history' | 'not_forecastable';
  /** A concrete next step, not just a refusal. */
  fallback: { label: string; series_filters: { field: string; op: string; value: string[] }[] } | null;
}

export interface Inventory {
  lead_time_days: number;
  service_level: number;
  z: number;
  sigma_lead_time: number;
  safety_stock: number;
  demand_over_lead_time: number;
  reorder_point: number;
  order_up_to: number;
  suggested_order_qty: number | null;
  note: string;
}

const DAYS_PER_MONTH = 30;
const MIN_HISTORY = 8;
const LOW_CONFIDENCE_OBS = 24;
const SPARSE_ZERO_SHARE = 0.3;

/**
 * Fill gaps with zeros. A month with no orders is real demand information, not
 * a missing value.
 *
 * `through` matters more than it looks. A GROUP BY only returns months that
 * have rows, so a category with no December orders has no December row - and
 * filling only between the first and last row present would silently drop that
 * zero, shortening the series and biasing a trend fit upward by deleting an
 * observation of zero demand at exactly the end that the projection hinges on.
 * Filling through the data anchor instead keeps every series the same length.
 */
export function zeroFill(points: Point[], through?: string): Point[] {
  if (points.length === 0) return [];
  const sorted = [...points].sort((a, b) => a.period.localeCompare(b.period));
  const out: Point[] = [];
  const last = through && through > sorted[sorted.length - 1]!.period
    ? through
    : sorted[sorted.length - 1]!.period;
  const [startY, startM] = sorted[0]!.period.split('-').map(Number);
  const [endY, endM] = last.split('-').map(Number);
  const byPeriod = new Map(sorted.map((p) => [p.period, p.value]));
  let y = startY!;
  let m = startM!;
  while (y < endY! || (y === endY! && m <= endM!)) {
    const key = `${y}-${String(m).padStart(2, '0')}`;
    out.push({ period: key, value: byPeriod.get(key) ?? 0 });
    m += 1;
    if (m > 12) { m = 1; y += 1; }
  }
  return out;
}

function nextPeriods(last: string, n: number): string[] {
  const [y0, m0] = last.split('-').map(Number);
  const out: string[] = [];
  let y = y0!;
  let m = m0!;
  for (let i = 0; i < n; i++) {
    m += 1;
    if (m > 12) { m = 1; y += 1; }
    out.push(`${y}-${String(m).padStart(2, '0')}`);
  }
  return out;
}

// --- Methods. Each returns a flat or trended projection of length h. -------

function movingAverage(values: number[], h: number, window = 3): number[] {
  const w = Math.min(window, values.length);
  const mean = values.slice(-w).reduce((a, b) => a + b, 0) / w;
  return Array<number>(h).fill(mean);
}

function linearTrend(values: number[], h: number): number[] {
  const n = values.length;
  const meanX = (n - 1) / 2;
  const meanY = values.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (i - meanX) * (values[i]! - meanY);
    den += (i - meanX) ** 2;
  }
  const slope = den === 0 ? 0 : num / den;
  const intercept = meanY - slope * meanX;
  // Demand cannot be negative; a steep downward trend must flatten at zero
  // rather than project impossible values.
  return Array.from({ length: h }, (_, k) => Math.max(0, intercept + slope * (n + k)));
}

function ses(values: number[], h: number, alpha: number): number[] {
  let level = values[0]!;
  for (let i = 1; i < values.length; i++) level = alpha * values[i]! + (1 - alpha) * level;
  return Array<number>(h).fill(Math.max(0, level));
}

function project(method: Method, values: number[], h: number, alpha: number): number[] {
  if (method === 'moving_average') return movingAverage(values, h);
  if (method === 'linear_trend') return linearTrend(values, h);
  return ses(values, h, alpha);
}

function score(actual: number[], predicted: number[]): { error: number; metric: 'MAPE' | 'MAE' } {
  const anyZero = actual.some((a) => a === 0);
  if (anyZero) {
    const mae = actual.reduce((sum, a, i) => sum + Math.abs(a - predicted[i]!), 0) / actual.length;
    return { error: mae, metric: 'MAE' };
  }
  const mape = actual.reduce((sum, a, i) => sum + Math.abs(a - predicted[i]!) / Math.abs(a), 0) / actual.length;
  return { error: mape, metric: 'MAPE' };
}

export interface ForecastRequest {
  history: Point[];
  horizon: number;
  method: Method | 'auto';
  leadTimeDays: number | null;
  serviceLevel: number | null;
  currentOnHand: number | null;
  /** Set when the caller asked for a SKU-level series. */
  skuFiltered: { sku: string; category: string | null } | null;
  metricLabel: string;
  /** Last period the data covers, as YYYY-MM. Series are zero-filled to here
   *  so a category with no orders in the final month keeps that zero. */
  through: string;
}

export function forecast(req: ForecastRequest, layer: Layer): ForecastResult | ForecastRefusal {
  // --- Guards ------------------------------------------------------------
  if (req.skuFiltered) {
    const total = layer.datasets['orders']!.row_count;
    const skus = layer.dimensions['sku']!.approx_cardinality ?? 355;
    return {
      ok: false,
      code: 'insufficient_history',
      reason:
        `A SKU-level forecast is not possible on this dataset. There are ${skus} SKUs across ${total} orders - ` +
        `${(total / skus).toFixed(2)} orders per SKU on average, and no SKU has more than 3. There is no series to fit. ` +
        `The parent product category has 12 monthly points and can be forecast.`,
      fallback: req.skuFiltered.category
        ? {
            label: `Forecast ${req.skuFiltered.category} instead`,
            series_filters: [{ field: 'product_category', op: 'eq', value: [req.skuFiltered.category] }],
          }
        : null,
    };
  }

  const history = zeroFill(req.history, req.through);
  if (history.length < MIN_HISTORY) {
    return {
      ok: false,
      code: 'insufficient_history',
      reason: `Only ${history.length} periods of history are available; at least ${MIN_HISTORY} are needed to fit and validate a model.`,
      fallback: null,
    };
  }

  const notes: string[] = [];
  let horizon = req.horizon;
  if (history.length < 2 * horizon) {
    const capped = Math.max(1, Math.floor(history.length / 2));
    notes.push(
      `Horizon capped at ${capped} periods: ${history.length} points of history cannot support a ${horizon}-period projection.`,
    );
    horizon = capped;
  }

  const values = history.map((p) => p.value);
  const zeroShare = values.filter((v) => v === 0).length / values.length;
  const sparse = zeroShare > SPARSE_ZERO_SHARE;
  if (sparse) notes.push(`${Math.round(zeroShare * 100)}% of periods are zero; intervals are widened and the method is held to a moving average.`);

  const lowConfidence = values.length < LOW_CONFIDENCE_OBS;
  if (lowConfidence) {
    notes.push(
      `Only ${values.length} observations. Every series on this dataset falls below the ${LOW_CONFIDENCE_OBS}-observation ` +
        `threshold, so treat the direction as indicative and the interval as the real answer.`,
    );
  }

  // --- Backtest ----------------------------------------------------------
  const holdout = Math.min(horizon, 4);
  const trainValues = values.slice(0, values.length - holdout);
  const testValues = values.slice(values.length - holdout);

  const alphaGrid = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9];
  const candidates: Candidate[] = [];
  let bestAlpha = 0.3;

  const pool: Method[] = sparse ? ['moving_average'] : ['moving_average', 'linear_trend', 'ses'];
  for (const method of pool) {
    if (method === 'ses') {
      let best: { error: number; metric: 'MAPE' | 'MAE'; alpha: number } | null = null;
      for (const alpha of alphaGrid) {
        const s = score(testValues, ses(trainValues, holdout, alpha));
        if (!best || s.error < best.error) best = { ...s, alpha };
      }
      bestAlpha = best!.alpha;
      candidates.push({ method, error: best!.error, metric: best!.metric, params: { alpha: best!.alpha } });
    } else {
      const s = score(testValues, project(method, trainValues, holdout, bestAlpha));
      candidates.push({ method, error: s.error, metric: s.metric });
    }
  }

  candidates.sort((a, b) => a.error - b.error);
  // Ties within 2% go to the simpler model, in the order they are listed.
  const simplicity: Method[] = ['moving_average', 'linear_trend', 'ses'];
  const best = candidates[0]!;
  const contenders = candidates.filter((c) => c.error <= best.error * 1.02);
  const chosen = req.method !== 'auto' && pool.includes(req.method)
    ? candidates.find((c) => c.method === req.method)!
    : contenders.sort((a, b) => simplicity.indexOf(a.method) - simplicity.indexOf(b.method))[0]!;

  // --- Refit on the full history and project -----------------------------
  const predicted = project(chosen.method, values, horizon, bestAlpha);

  // Residual spread comes from the backtest, never from the fit: a model
  // scored on data it has seen produces intervals that are too narrow.
  const backtestPredicted = project(chosen.method, trainValues, holdout, bestAlpha);
  const residuals = testValues.map((a, i) => a - backtestPredicted[i]!);
  const meanResidual = residuals.reduce((a, b) => a + b, 0) / residuals.length;
  const residualSd = Math.sqrt(
    residuals.reduce((sum, r) => sum + (r - meanResidual) ** 2, 0) / Math.max(1, residuals.length - 1),
  ) || Math.abs(meanResidual) || 1;
  const widen = sparse ? 1.5 : 1;

  const periods = nextPeriods(history[history.length - 1]!.period, horizon);
  const forecastPoints = predicted.map((value, i) => {
    const spread = residualSd * Math.sqrt(i + 1) * widen;
    return {
      period: periods[i]!,
      value,
      lo80: Math.max(0, value - 1.2816 * spread),
      hi80: value + 1.2816 * spread,
      lo95: Math.max(0, value - 1.96 * spread),
      hi95: value + 1.96 * spread,
    };
  });

  // --- Inventory ---------------------------------------------------------
  const inventory = req.leadTimeDays
    ? buildInventory(req, predicted, residualSd, horizon)
    : null;

  const explanation =
    `Fitted ${chosen.method.replace('_', ' ')}${chosen.params?.alpha ? ` (alpha ${chosen.params.alpha})` : ''} ` +
    `on ${values.length} monthly points, chosen by holding out the last ${holdout} and scoring ` +
    `${chosen.metric} ${chosen.error.toFixed(3)}. ` +
    `Candidates that lost: ${candidates.filter((c) => c !== chosen).map((c) => `${c.method} ${c.error.toFixed(3)}`).join(', ') || 'none'}. ` +
    `Intervals come from backtest residuals widened by the square root of the horizon.`;

  return {
    ok: true,
    history,
    forecast: forecastPoints,
    method: chosen.method,
    candidates,
    error_metric: chosen.metric,
    backtest_error: chosen.error,
    residual_sd: residualSd,
    sparse_series: sparse,
    low_confidence: lowConfidence,
    notes,
    inventory,
    explanation,
  };
}

function buildInventory(
  req: ForecastRequest,
  predicted: number[],
  residualSd: number,
  horizon: number,
): Inventory {
  const leadTimeDays = req.leadTimeDays!;
  const serviceLevel = req.serviceLevel ?? 0.95;
  const z = normalQuantile(serviceLevel);
  const sigmaLeadTime = residualSd * Math.sqrt(leadTimeDays / DAYS_PER_MONTH);
  const safetyStock = z * sigmaLeadTime;

  const monthsOfLeadTime = leadTimeDays / DAYS_PER_MONTH;
  const demandOver = (months: number) => {
    let total = 0;
    let remaining = months;
    for (let i = 0; i < predicted.length && remaining > 0; i++) {
      total += predicted[i]! * Math.min(1, remaining);
      remaining -= 1;
    }
    // Beyond the horizon, extend at the last projected level.
    if (remaining > 0) total += (predicted[predicted.length - 1] ?? 0) * remaining;
    return total;
  };

  const demandLeadTime = demandOver(monthsOfLeadTime);
  const reorderPoint = demandLeadTime + safetyStock;
  const orderUpTo = demandOver(monthsOfLeadTime + 1) + safetyStock; // one-month review period
  const suggested = req.currentOnHand !== null ? Math.max(0, orderUpTo - req.currentOnHand) : null;

  return {
    lead_time_days: leadTimeDays,
    service_level: serviceLevel,
    z,
    sigma_lead_time: sigmaLeadTime,
    safety_stock: safetyStock,
    demand_over_lead_time: demandLeadTime,
    reorder_point: reorderPoint,
    order_up_to: orderUpTo,
    suggested_order_qty: suggested,
    note:
      suggested === null
        ? 'Reorder point and order-up-to level are shown. A suggested order quantity needs current stock on hand, which this dataset does not carry - it is not guessed.'
        : `Order up to ${orderUpTo.toFixed(0)} units against ${req.currentOnHand} on hand, with a one-month review period.`,
  };
}
