/**
 * Ten lines of scale maths instead of a charting library.
 *
 * The design spec asks for hollow points below a sample floor, a shaded
 * quadrant bounded by computed thresholds, per-bar tail highlighting and
 * inline reference labels. Each of those is a fight with a library's theming
 * layer and a few lines of raw SVG.
 */
/**
 * Every chart constant runs through px().
 *
 * The design ramp in docs/DESIGN.md was sampled at a tighter density than this
 * dashboard is read at, so the whole UI is that ramp x 1.25 (src/lib/tokens.css).
 * SVG carries its own font sizes and padding, which no CSS token reaches, so
 * the same factor is applied here.
 *
 * Deliberately not `zoom: 1.25` on the root: zoom changes the coordinate space
 * that ResizeObserver reports to useWidth, and it would also desynchronise the
 * viewport coordinates the explain bubble is positioned from.
 */
export const SCALE = 1.25;

export function px(value: number): number {
  return Math.round(value * SCALE);
}

export type Scale = (value: number) => number;

export function linear(domain: [number, number], range: [number, number]): Scale {
  const [d0, d1] = domain;
  const [r0, r1] = range;
  const span = d1 - d0 || 1;
  return (v) => r0 + ((v - d0) / span) * (r1 - r0);
}

export function band(count: number, range: [number, number], gap = 0.2) {
  const [r0, r1] = range;
  const step = (r1 - r0) / Math.max(1, count);
  const width = step * (1 - gap);
  return {
    step,
    width,
    at: (i: number) => r0 + i * step + (step - width) / 2,
    centre: (i: number) => r0 + i * step + step / 2,
  };
}

/** Ticks on 1 / 2 / 5 x 10^n boundaries, which is what makes an axis readable. */
export function niceTicks(min: number, max: number, count = 5): number[] {
  if (max === min) return [min];
  const raw = (max - min) / count;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const normalized = raw / magnitude;
  const step = (normalized >= 5 ? 5 : normalized >= 2 ? 2 : 1) * magnitude;
  const start = Math.ceil(min / step) * step;
  const out: number[] = [];
  for (let v = start; v <= max + step / 1000; v += step) out.push(Number(v.toFixed(10)));
  return out;
}

/** Value axes start at zero for bars; a rate scatter may float, but the floor
 *  has to be visible so nobody reads the spread as larger than it is. */
export function niceFloor(min: number, step = 0.1): number {
  return Math.max(0, Math.floor(min / step) * step);
}
