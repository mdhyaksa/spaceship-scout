import { linear, niceTicks, px } from './scale.ts';
import { useWidth } from './useWidth.ts';
import { formatValue } from '../../shared/format.ts';
import { Empty } from './CompositionBar.tsx';

const H = px(280);
const PAD = { top: px(24), right: px(16), bottom: px(52), left: px(48) };

export interface ScatterPoint {
  key: string;
  share: number;        // x — share of total volume
  rate: number;         // y — on-time rate
  transit: number;      // fill darkness
  p95: number;          // tooltip only
  n: number;            // completed deliveries, decides hollow vs filled
}

/**
 * The breakdown scatter, per DESIGN.md section 6.1.
 *
 * Each metric is matched to how precisely it needs to be read: volume and rate
 * take the two position channels, transit takes fill darkness because "slower
 * than others" is all it has to say, and p95 is a lookup so it lives in the
 * tooltip.
 *
 * Size is deliberately not an encoding. Points are a fixed radius: size reads
 * as importance, and volume already holds that meaning on the x axis. Two
 * channels claiming the same intuition is worse than leaving one unused.
 */
export function BreakdownScatter({
  points, target, volumeThresholdPct, minGroupSize, dimensionLabel,
}: {
  points: ScatterPoint[];
  target: number;
  volumeThresholdPct: number;
  minGroupSize: number | null;
  dimensionLabel: string;
}) {
  const { ref, width } = useWidth<HTMLDivElement>();
  // Pad the domain so the largest point is not sitting on the frame, which
  // both crops its label and reads as though the axis were truncated.
  const maxShare = Math.max(...points.map((p) => p.share), volumeThresholdPct / 100 * 1.4) * 1.12;
  const minRate = Math.min(...points.map((p) => p.rate));
  // The floor is visible on the axis so nobody reads the vertical spread as
  // larger than it is.
  const floor = Math.max(0, Math.floor(minRate * 10) / 10 - 0.05);

  const x = linear([0, maxShare], [PAD.left, width - PAD.right]);
  const y = linear([floor, 1], [H - PAD.bottom, PAD.top]);

  const transits = points.map((p) => p.transit).filter((t) => Number.isFinite(t));
  const tMin = Math.min(...transits);
  const tMax = Math.max(...transits);
  const RAMP = ['var(--graphite-300)', 'var(--graphite-400)', 'var(--graphite-500)', 'var(--graphite-600)', 'var(--graphite-700)'];
  const shade = (t: number) => {
    if (!Number.isFinite(t) || tMax === tMin) return RAMP[2]!;
    return RAMP[Math.min(RAMP.length - 1, Math.floor(((t - tMin) / (tMax - tMin)) * RAMP.length))]!;
  };

  const thresholdX = x(volumeThresholdPct / 100);
  const inQuadrant = points.filter((p) => p.rate < target && p.share >= volumeThresholdPct / 100);

  // Labels are offset until they fit, and connected by a leader when they end
  // up away from their mark.
  //
  // The previous version skipped placement entirely below thirteen points,
  // which is exactly the case that collides: eight product categories were
  // labelled blind and landed on top of each other. Placement now always runs,
  // and a collision moves a label rather than deleting it — a dropped label
  // loses information that a short line preserves.
  // Measured against rendered labels: digits run ~7.9px per character at this
  // font size and uppercase runs wider still. Estimating narrow is the failure
  // that matters — it lets two labels the model thinks are clear overlap in
  // fact — so the estimate is deliberately generous. Costing a label an extra
  // offset step is cheaper than shipping a collision.
  // Lane names run to "San Francisco, CA -> Sacramento, CA" — some 320px on a
  // 520px plot, so two of them cannot coexist and most points end up unnamed.
  // Truncating for display buys back the room; the circle's tooltip carries
  // the full name, so nothing is lost.
  const MAX_LABEL = 22;
  const shortLabel = (key: string) => (key.length > MAX_LABEL ? `${key.slice(0, MAX_LABEL - 1)}…` : key);

  const CHAR_W = px(7.4);
  const PAD_X = px(2);
  const LINE_H = px(13);
  const R = px(6);

  type Anchor = 'start' | 'middle' | 'end';
  interface Placement { x: number; y: number; anchor: Anchor; leader: boolean }
  interface Box { left: number; right: number; top: number; bottom: number }

  const boxFor = (cx: number, cy: number, dx: number, dy: number, anchor: Anchor, key: string): Box => {
    const w = key.length * CHAR_W + PAD_X * 2;
    const originX = cx + dx;
    const left = anchor === 'start' ? originX - PAD_X : anchor === 'end' ? originX - w + PAD_X : originX - w / 2;
    return { left, right: left + w, top: cy + dy - LINE_H * 0.75, bottom: cy + dy + LINE_H * 0.25 };
  };
  const overlaps = (a: Box, b: Box) =>
    !(a.right < b.left || a.left > b.right || a.bottom < b.top || a.top > b.bottom);

  // Seed the occupied set with the captions, which are text too — in the
  // reference screenshot the target caption sat on top of the points near it.
  const occupied: Box[] = [
    { left: width - PAD.right - px(74), right: width - PAD.right, top: y(target) - px(15), bottom: y(target) - px(3) },
    { left: width - PAD.right - px(110), right: width - PAD.right, top: y(floor) - px(14), bottom: y(floor) },
  ];
  // A label sitting on another point is as unreadable as one sitting on
  // another label, so the marks occupy space too.
  for (const p of points) {
    occupied.push({ left: x(p.share) - R, right: x(p.share) + R, top: y(p.rate) - R, bottom: y(p.rate) + R });
  }

  // Beside the mark first, then centred above or below it, then further out
  // where a leader has to carry the association. Centred slots matter: when a
  // point has neighbours to its left and right, the space directly above it is
  // usually free and every side candidate is blocked.
  const CANDIDATES: [number, number, Anchor][] = [
    [R + px(4), px(4), 'start'],
    [-(R + px(4)), px(4), 'end'],
    [0, -(R + px(6)), 'middle'],
    [0, R + px(13), 'middle'],
    [R + px(4), -px(11), 'start'],
    [R + px(4), px(17), 'start'],
    [-(R + px(4)), -px(11), 'end'],
    [-(R + px(4)), px(17), 'end'],
    [0, -(R + px(19)), 'middle'],
    [0, R + px(26), 'middle'],
    [R + px(4), -px(25), 'start'],
    [-(R + px(4)), -px(25), 'end'],
    [R + px(4), px(31), 'start'],
    [-(R + px(4)), px(31), 'end'],
  ];

  // Leaders make denser labelling readable, so the cap is higher than it was —
  // but 47 lanes still cannot all carry a label.
  const LABEL_CAP = 16;
  const placements = new Map<string, Placement>();
  const priority = [...points].sort((a, b) => {
    const aq = inQuadrant.includes(a) ? 0 : 1;
    const bq = inQuadrant.includes(b) ? 0 : 1;
    if (aq !== bq) return aq - bq;
    return Math.abs(b.rate - target) - Math.abs(a.rate - target);
  });

  for (const p of priority) {
    if (placements.size >= LABEL_CAP) break;
    const cx = x(p.share);
    const cy = y(p.rate);
    for (const [dx, dy, anchor] of CANDIDATES) {
      const box = boxFor(cx, cy, dx, dy, anchor, shortLabel(p.key));
      if (box.left < PAD.left || box.right > width - PAD.right) continue;
      if (box.top < PAD.top || box.bottom > y(floor)) continue;
      if (occupied.some((o) => overlaps(box, o))) continue;
      occupied.push(box);
      placements.set(p.key, { x: cx + dx, y: cy + dy, anchor, leader: anchor === 'middle' || Math.abs(dy) > px(8) });
      break;
    }
  }

  if (!points.length) return <div ref={ref}><Empty /></div>;

  return (
    <div ref={ref}>
    <svg width={width} height={H} viewBox={`0 0 ${width} ${H}`} role="img"
         aria-label={`On-time rate against share of volume by ${dimensionLabel}. ${points.length} groups, ${inQuadrant.length} high volume and below target.`}>
      {/* Priority quadrant: below the target line and right of the volume
          threshold. The y axis runs low to high upward, so below target is
          bottom-right, not top-right. */}
      <rect x={thresholdX} y={y(target)} width={Math.max(0, width - PAD.right - thresholdX)}
            height={Math.max(0, y(floor) - y(target))} fill="var(--quadrant)" />

      {niceTicks(floor, 1, 4).map((t) => (
        <g key={t}>
          <line x1={PAD.left} x2={width - PAD.right} y1={y(t)} y2={y(t)} stroke="var(--grid)" strokeWidth={0.5} />
          <text x={PAD.left - px(6)} y={y(t) + px(3)} textAnchor="end" fontSize={px(10)} fill="var(--text-muted)" className="tnum">
            {(t * 100).toFixed(0)}%
          </text>
        </g>
      ))}
      {niceTicks(0, maxShare, 4).map((t) => (
        <text key={t} x={x(t)} y={H - PAD.bottom + px(16)} textAnchor="middle" fontSize={px(10)} fill="var(--text-muted)" className="tnum">
          {(t * 100).toFixed(0)}%
        </text>
      ))}

      <line x1={PAD.left} x2={width - PAD.right} y1={y(target)} y2={y(target)}
            stroke="var(--role-reference)" strokeWidth={1} strokeDasharray="4 3" />
      <text x={width - PAD.right - px(2)} y={y(target) - px(4)} textAnchor="end" fontSize={px(10)}
            stroke="var(--surface-card)" strokeWidth={px(2.5)} strokeLinejoin="round" paintOrder="stroke"
            fill="var(--text-primary)" className="tnum">
        {formatValue(target, 'percent')} target
      </text>
      <line x1={thresholdX} x2={thresholdX} y1={PAD.top} y2={y(floor)} stroke="var(--role-reference)" strokeWidth={0.5} strokeDasharray="3 3" opacity={0.3} />
      <line x1={PAD.left} x2={width - PAD.right} y1={y(floor)} y2={y(floor)} stroke="var(--axis)" strokeWidth={1} />

      {inQuadrant.length > 0 ? (
        <text x={width - PAD.right - px(4)} y={y(floor) - px(6)} textAnchor="end" fontSize={px(10)} fill="var(--amber-text)">
          High volume, below target
        </text>
      ) : (
        <text x={(width + PAD.left) / 2} y={y(floor) - px(8)} textAnchor="middle" fontSize={px(12)} fill="var(--text-muted)">
          No high-volume {dimensionLabel.toLowerCase()} is below target.
        </text>
      )}

      {points.map((p) => {
        // A hollow point keeps its true position, so a promising small group is
        // still visible as promising while the outline says the value is not
        // bankable.
        const thin = minGroupSize !== null && p.n < minGroupSize;
        return (
          <g key={p.key}>
            <circle cx={x(p.share)} cy={y(p.rate)} r={thin ? 5 : 6}
                    fill={thin ? 'var(--surface-card)' : shade(p.transit)}
                    stroke={thin ? shade(p.transit) : 'none'} strokeWidth={thin ? 1.5 : 0}>
              <title>
                {`${p.key}\non-time ${formatValue(p.rate, 'percent')} of ${p.n} completed\n` +
                 `share of volume ${(p.share * 100).toFixed(1)}%\n` +
                 `avg transit ${p.transit.toFixed(1)} d · p95 ${p.p95} d` +
                 (thin ? `\nbelow the minimum sample of ${minGroupSize}` : '')}
              </title>
            </circle>
            {(() => {
              const place = placements.get(p.key);
              if (!place) return null;
              return (
                <>
                  {place.leader && (
                    <line x1={x(p.share)} y1={y(p.rate)}
                          x2={place.x + (place.anchor === 'start' ? -px(2) : place.anchor === 'end' ? px(2) : 0)}
                          y2={place.y - (place.y < y(p.rate) ? -px(2) : px(3))}
                          stroke="var(--graphite-300)" strokeWidth={0.5} />
                  )}
                  {/* A halo in the card colour, so the target line, the
                      gridlines and the quadrant edge do not run through the
                      text. Cheaper and more legible than routing labels
                      around every rule on the chart. */}
                  <text x={place.x} y={place.y} fontSize={px(11)} textAnchor={place.anchor}
                        stroke="var(--surface-card)" strokeWidth={px(2.5)} strokeLinejoin="round"
                        paintOrder="stroke" aria-hidden="true"
                        fill={thin ? 'var(--text-muted)' : 'var(--text-primary)'} data-point-label>
                    {shortLabel(p.key)}
                  </text>
                </>
              );
            })()}
          </g>
        );
      })}

      <text x={(width + PAD.left) / 2} y={H - px(6)} textAnchor="middle" fontSize={px(11)} fill="var(--text-secondary)">
        Share of order volume
      </text>
    </svg>
    </div>
  );
}
