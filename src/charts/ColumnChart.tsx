import { band, linear, niceTicks, px } from './scale.ts';
import { useWidth } from './useWidth.ts';
import { formatPeriod, formatValue } from '../../shared/format.ts';
import { Empty } from './CompositionBar.tsx';

const H = px(190);
const PAD = { top: px(12), right: px(8), bottom: px(26), left: px(38) };

/**
 * One metric over time. Bars start at zero, always — a truncated count axis
 * misstates the thing it is drawing.
 */
export function ColumnChart({
  rows, valueKey, format, partialLast,
}: {
  rows: Record<string, string | number | null>[];
  valueKey: string;
  format: string;
  partialLast?: boolean;
}) {
  const { ref, width } = useWidth<HTMLDivElement>();
  const values = rows.map((r) => Number(r[valueKey] ?? 0));
  const max = Math.max(...values, 1);
  const ticks = niceTicks(0, max, 4);
  const top = Math.max(max, ticks[ticks.length - 1] ?? max);

  const y = linear([0, top], [H - PAD.bottom, PAD.top]);
  const bars = band(rows.length, [PAD.left, width - PAD.right]);

  // How many labels fit, not how many rows there are.
  //
  // This used to be `rows.length <= 12`, which is exactly the common case — a
  // year of months — so it always rendered all twelve however narrow the chart
  // got, and they collided into a smear. Stride from the measured band step
  // against the widest label instead.
  const labels = rows.map((r) => formatPeriod(String(r['period'])));
  const widest = Math.max(1, ...labels.map((l) => l.length)) * px(6.2);
  const stride = Math.max(1, Math.ceil((widest + px(8)) / bars.step));
  // The most recent period is the one being read, so it always keeps its
  // label; the stride is anchored to the end rather than the start.
  const showLabel = (i: number) => (rows.length - 1 - i) % stride === 0;

  return (
    <div ref={ref}>
      {!rows.length ? <Empty /> : (
    <svg width={width} height={H} viewBox={`0 0 ${width} ${H}`} role="img"
         aria-label={`${valueKey} by period, ${rows.length} periods`}>
      {ticks.map((t) => (
        <g key={t}>
          <line x1={PAD.left} x2={width - PAD.right} y1={y(t)} y2={y(t)} stroke="var(--grid)" strokeWidth={0.5} />
          <text x={PAD.left - px(6)} y={y(t) + px(3)} textAnchor="end" fontSize={px(11)} fill="var(--text-secondary)" className="tnum">
            {formatValue(t, format)}
          </text>
        </g>
      ))}
      <line x1={PAD.left} x2={width - PAD.right} y1={y(0)} y2={y(0)} stroke="var(--axis)" strokeWidth={1} />

      {rows.map((r, i) => {
        const v = Number(r[valueKey] ?? 0);
        const isPartial = partialLast && i === rows.length - 1;
        const h = Math.max(0, y(0) - y(v));
        return (
          <g key={String(r['period'])}>
            <rect x={bars.at(i)} y={y(v)} width={bars.width} height={h} rx={2}
                  fill={isPartial ? 'none' : 'var(--role-ink)'}
                  stroke={isPartial ? 'var(--role-ink)' : 'none'}
                  strokeWidth={isPartial ? 1 : 0}
                  strokeDasharray={isPartial ? '3 2' : undefined}>
              <title>{`${formatPeriod(String(r['period']))}: ${formatValue(v, format)}${isPartial ? ' (partial period)' : ''}`}</title>
            </rect>
            {showLabel(i) && (
              <text x={bars.centre(i)} y={H - px(8)} textAnchor="middle" fontSize={px(11)}
                    fill="var(--text-secondary)" data-axis-label>
                {labels[i]}
              </text>
            )}
          </g>
        );
      })}
    </svg>
      )}
    </div>
  );
}
