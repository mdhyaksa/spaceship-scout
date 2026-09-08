/**
 * The two statistical tests the sufficiency guard needs, with no dependency.
 * Both are ported from scripts/verify_data_facts.py, where they are already
 * exercised against this dataset.
 */

/** Regularized upper incomplete gamma, i.e. P(X > x) for chi-square with df
 *  degrees of freedom. Series expansion of the lower incomplete gamma. */
export function chiSquareP(stat: number, df: number): number {
  if (stat <= 0 || df <= 0) return 1;
  const shape = df / 2;
  const scaled = stat / 2;
  let term = 1 / shape;
  let total = term;
  for (let n = 1; n < 10_000; n++) {
    term *= scaled / (shape + n);
    total += term;
    if (term < 1e-15 * total) break;
  }
  const lower = total * Math.exp(-scaled + shape * Math.log(scaled) - lnGamma(shape));
  return Math.max(0, 1 - lower);
}

function lnGamma(x: number): number {
  // Lanczos approximation, g = 7, n = 9.
  const g = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313,
    -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6,
    1.5056327351493116e-7,
  ];
  if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - lnGamma(1 - x);
  x -= 1;
  let a = g[0]!;
  const t = x + 7.5;
  for (let i = 1; i < 9; i++) a += g[i]! / (x + i);
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}

/** Chi-square test of independence on a 2 x k table of successes and failures. */
export function chiSquareTest(successes: number[], totals: number[]): { stat: number; df: number; p: number } {
  const n = successes.length;
  const grandSuccess = successes.reduce((a, b) => a + b, 0);
  const grandTotal = totals.reduce((a, b) => a + b, 0);
  const grandFailure = grandTotal - grandSuccess;
  if (grandTotal === 0 || grandSuccess === 0 || grandFailure === 0) {
    return { stat: 0, df: Math.max(0, n - 1), p: 1 };
  }
  let stat = 0;
  for (let i = 0; i < n; i++) {
    const rowTotal = totals[i]!;
    const observed = [successes[i]!, rowTotal - successes[i]!];
    const expected = [(rowTotal * grandSuccess) / grandTotal, (rowTotal * grandFailure) / grandTotal];
    for (let j = 0; j < 2; j++) {
      if (expected[j]! > 0) stat += (observed[j]! - expected[j]!) ** 2 / expected[j]!;
    }
  }
  const df = n - 1;
  return { stat, df, p: chiSquareP(stat, df) };
}

/** Standard normal CDF via Abramowitz & Stegun 7.1.26. */
export function normalCdf(z: number): number {
  const sign = z < 0 ? -1 : 1;
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-x * x);
  return 0.5 * (1 + sign * y);
}

/** Inverse standard normal CDF, Acklam's rational approximation. Used for the
 *  service-level z in the inventory calculation. */
export function normalQuantile(p: number): number {
  if (p <= 0 || p >= 1) throw new Error(`normalQuantile expects 0 < p < 1, got ${p}`);
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1, 2.506628277459239];
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
  const pLow = 0.02425;
  if (p < pLow) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0]! * q + c[1]!) * q + c[2]!) * q + c[3]!) * q + c[4]!) * q + c[5]!) /
      ((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1);
  }
  if (p > 1 - pLow) return -normalQuantile(1 - p);
  const q = p - 0.5;
  const r = q * q;
  return ((((((a[0]! * r + a[1]!) * r + a[2]!) * r + a[3]!) * r + a[4]!) * r + a[5]!) * q) /
    (((((b[0]! * r + b[1]!) * r + b[2]!) * r + b[3]!) * r + b[4]!) * r + 1);
}

/** Two-proportion z test, top group against every other group pooled. */
export function twoProportionTest(x1: number, n1: number, x2: number, n2: number): { z: number; p: number } {
  if (n1 === 0 || n2 === 0) return { z: 0, p: 1 };
  const p1 = x1 / n1;
  const p2 = x2 / n2;
  const pooled = (x1 + x2) / (n1 + n2);
  const se = Math.sqrt(pooled * (1 - pooled) * (1 / n1 + 1 / n2));
  if (se === 0) return { z: 0, p: 1 };
  const z = (p1 - p2) / se;
  return { z, p: 2 * (1 - normalCdf(Math.abs(z))) };
}
