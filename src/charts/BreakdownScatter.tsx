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
  p90: number;          // tooltip only
  n: number;            // completed deliveries, decides hollow vs filled
}

/**
 * The breakdown scatter, per DESIGN.md section 6.1.
 *
 * Each metric is matched to how precisely it needs to be read: volume and rate
 * take the two position channels, transit takes fill darkness because "slower
 * than others" is all it has to say, and p90 is a lookup so it lives in the
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

  // Beyond about a dozen categories, labelling everything collides into noise
  // and defeats the chart. Distance from the target line is not enough of a
  // filter on its own: 20-odd lanes sit at exactly 100%, all of them "far from
  // target", and they land on the same pixel row.
  //
  // So labels are placed greedily in priority order - the priority quadrant
  // first, because that is what the reader came for, then furthest from target
  // - and any label that would overlap one already placed is dropped. The
  // point keeps its position and its tooltip either way.
  const labelled = new Set<string>();
  if (points.length <= 12) {
    points.forEach((p) => labelled.add(p.key));
  } else {
    const placed: { x: number; y: number; halfWidth: number }[] = [];
    const priority = [...points].sort((a, b) => {
      const aq = inQuadrant.includes(a) ? 0 : 1;
      const bq = inQuadrant.includes(b) ? 0 : 1;
      if (aq !== bq) return aq - bq;
      return Math.abs(b.rate - target) - Math.abs(a.rate - target);
    });
    for (const p of priority) {
      if (labelled.size >= 12) break;
      const px = x(p.share);
      const py = y(p.rate);
      const halfWidth = (p.key.length * 6) / 2 + 12;
      const collides = placed.some(
        (q) => Math.abs(q.y - py) < 12 && Math.abs(q.x - px) < q.halfWidth + halfWidth,
      );
      if (collides) continue;
      placed.push({ x: px, y: py, halfWidth });
      labelled.add(p.key);
    }
  }
  const shouldLabel = (p: ScatterPoint) => labelled.has(p.key);

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
      <text x={width - PAD.right - px(2)} y={y(target) - px(4)} textAnchor="end" fontSize={px(10)} fill="var(--text-primary)" className="tnum">
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
                 `avg transit ${p.transit.toFixed(1)} d · p90 ${p.p90} d` +
                 (thin ? `\nbelow the minimum sample of ${minGroupSize}` : '')}
              </title>
            </circle>
            {shouldLabel(p) && (() => {
              // Flip the label inside the plot when it would run off the right
              // edge. The highest-volume group is the one a reader most wants
              // named, and it is exactly the one that sits closest to the frame.
              const flip = x(p.share) + 12 + p.key.length * 6 > width - PAD.right;
              return (
                <text x={x(p.share) + (flip ? -px(9) : px(9))} y={y(p.rate) + px(3)} fontSize={px(11)}
                      textAnchor={flip ? 'end' : 'start'}
                      fill={thin ? 'var(--text-muted)' : 'var(--text-primary)'}>
                  {p.key}
                </text>
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
