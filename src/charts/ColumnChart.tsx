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
            {(rows.length <= 12 || i % 2 === 0) && (
              <text x={bars.centre(i)} y={H - px(8)} textAnchor="middle" fontSize={px(11)} fill="var(--text-secondary)">
                {formatPeriod(String(r['period']))}
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
