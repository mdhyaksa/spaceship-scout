import { band, linear, niceTicks, px } from './scale.ts';
import { useWidth } from './useWidth.ts';
import { Empty } from './CompositionBar.tsx';

const H = px(200);
const PAD = { top: px(16), right: px(10), bottom: px(38), left: px(38) };

/**
 * Transit-time distribution.
 *
 * The tail is the subject. The body renders in graphite-300 and everything at
 * or beyond the tail threshold in ink, and both the mean and the p95 are drawn
 * as reference lines — carrying both is the point. The mean sits inside the
 * body and says nothing about the orders that generate complaints; p95 is the
 * number a service target can actually be set against.
 *
 * p95 is the same boundary the shading uses, so the chart states one
 * definition of the tail rather than two. The two can still separate: the
 * shading follows the configured tail_threshold_days while the line follows
 * the p95 of whatever is currently displayed, so under a filter the line
 * shows where this subset's tail begins against the configured boundary.
 *
 * Both statistics are derived from the bars themselves, so the chart cannot
 * disagree with the distribution it is drawing.
 */
export function Histogram({
  rows, tailThreshold,
}: {
  rows: Record<string, string | number | null>[];
  tailThreshold: number;
}) {
  const { ref, width } = useWidth<HTMLDivElement>();
  const points = rows
    .map((r) => ({ days: Number(r['transit_days']), count: Number(r['order_count'] ?? 0) }))
    .filter((p) => Number.isFinite(p.days))
    .sort((a, b) => a.days - b.days);

  const total = points.reduce((s, p) => s + p.count, 0) || 1;
  const mean = points.reduce((s, p) => s + p.days * p.count, 0) / total;

  // Discrete p95: the smallest value whose cumulative share reaches 0.95. Same
  // definition metric.p95_transit_days uses, so the line lands on a real bar.
  let cumulative = 0;
  let p95 = points[points.length - 1]!.days;
  for (const p of points) {
    cumulative += p.count;
    if (cumulative / total >= 0.95) { p95 = p.days; break; }
  }
  const tailCount = points.filter((p) => p.days >= tailThreshold).reduce((s, p) => s + p.count, 0);

  const max = Math.max(1, ...points.map((p) => p.count));
  const ticks = niceTicks(0, max, 4);
  const top = Math.max(max, ticks[ticks.length - 1] ?? max);
  const y = linear([0, top], [H - PAD.bottom, PAD.top]);
  const bars = band(points.length, [PAD.left, width - PAD.right]);
  const xAt = (days: number) => {
    const i = points.findIndex((p) => p.days === days);
    return i >= 0 ? bars.centre(i) : bars.centre(points.length - 1);
  };

  if (!points.length) return <div ref={ref}><Empty /></div>;

  return (
    <div ref={ref}>
      <svg width={width} height={H} viewBox={`0 0 ${width} ${H}`} role="img"
           aria-label={`Orders by transit days. Mean ${mean.toFixed(1)}, p95 ${p95}, ${tailCount} orders at or beyond ${tailThreshold} days.`}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD.left} x2={width - PAD.right} y1={y(t)} y2={y(t)} stroke="var(--grid)" strokeWidth={0.5} />
            <text x={PAD.left - px(6)} y={y(t) + px(3)} textAnchor="end" fontSize={px(11)} fill="var(--text-secondary)" className="tnum">{t}</text>
          </g>
        ))}
        <line x1={PAD.left} x2={width - PAD.right} y1={y(0)} y2={y(0)} stroke="var(--axis)" strokeWidth={1} />

        {points.map((p, i) => (
          <g key={p.days}>
            <rect x={bars.at(i)} y={y(p.count)} width={bars.width} height={Math.max(0, y(0) - y(p.count))} rx={2}
                  fill={p.days >= tailThreshold ? 'var(--role-ink)' : 'var(--graphite-300)'}>
              <title>{`${p.days} days: ${p.count} orders`}</title>
            </rect>
            <text x={bars.centre(i)} y={H - px(18)} textAnchor="middle" fontSize={px(11)} fill="var(--text-secondary)" className="tnum">{p.days}</text>
          </g>
        ))}

        {/* Reference lines: mean inside the body, p95 where the tail starts. */}
        <line x1={xAt(Math.round(mean))} x2={xAt(Math.round(mean))} y1={PAD.top} y2={y(0)}
              stroke="var(--role-reference)" strokeWidth={1} strokeDasharray="4 3" opacity={0.45} />
        <text x={xAt(Math.round(mean)) + 4} y={PAD.top + px(9)} fontSize={px(10)} fill="var(--text-muted)" className="tnum">
          mean {mean.toFixed(1)}
        </text>
        <line x1={xAt(p95)} x2={xAt(p95)} y1={PAD.top} y2={y(0)} stroke="var(--role-reference)" strokeWidth={1} strokeDasharray="4 3" />
        <text x={xAt(p95) + px(4)} y={PAD.top + px(22)} fontSize={px(10)} fill="var(--text-primary)" className="tnum">p95 {p95}</text>

        <text x={(width + PAD.left) / 2} y={H - px(3)} textAnchor="middle" fontSize={px(11)} fill="var(--text-muted)">Days in transit</text>
      </svg>
      <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
        <span className="tnum">{tailCount}</span> of <span className="tnum">{total}</span> orders take {tailThreshold} days or more.
        Mean <span className="tnum">{mean.toFixed(1)}</span> d · p95 <span className="tnum">{p95}</span> d.
      </p>
    </div>
  );
}
