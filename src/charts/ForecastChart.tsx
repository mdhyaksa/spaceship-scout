import {
  Area, CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import type { ForecastResult } from '../../shared/types.ts';
import { formatPeriod } from '../../shared/format.ts';

/**
 * The one place a charting library earns its keep: a band plus two line styles
 * is fiddly in raw SVG and trivial in a ComposedChart.
 *
 * Forecasts must not look like history. History is solid, the projection is
 * dashed at the same weight, and the interval band is the honest part of the
 * chart — when backtest error is high the band is wide and is allowed to look
 * wide. Never clamp the visual range to make a projection look confident.
 */
export function ForecastChart({ result }: { result: ForecastResult }) {
  const boundary = result.history[result.history.length - 1]!;

  const data = [
    ...result.history.map((p) => ({
      period: p.period,
      history: p.value,
      forecast: null as number | null,
      band80: null as [number, number] | null,
      band95: null as [number, number] | null,
    })),
    // Repeat the boundary point so the dashed line joins the solid one instead
    // of floating a gap between history and projection.
    ...result.forecast.map((p, i) => ({
      period: p.period,
      history: null,
      forecast: p.value,
      band80: [p.lo80, p.hi80] as [number, number],
      band95: [p.lo95, p.hi95] as [number, number],
      ...(i === 0 ? {} : {}),
    })),
  ];
  const joined = data.map((d, i) =>
    i === result.history.length - 1 ? { ...d, forecast: boundary.value, band80: [boundary.value, boundary.value] as [number, number], band95: [boundary.value, boundary.value] as [number, number] } : d,
  );

  return (
    <div style={{ width: '100%', height: 240 }}>
      <ResponsiveContainer>
        <ComposedChart data={joined} margin={{ top: 12, right: 16, bottom: 4, left: -12 }}>
          <CartesianGrid stroke="var(--grid)" strokeWidth={0.5} vertical={false} />
          <XAxis dataKey="period" tickFormatter={formatPeriod} tick={{ fontSize: 11, fill: 'var(--text-secondary)' }}
                 axisLine={{ stroke: 'var(--axis)', strokeWidth: 0.5 }} tickLine={false} />
          <YAxis tick={{ fontSize: 11, fill: 'var(--text-secondary)' }} axisLine={false} tickLine={false} width={44} />
          <Tooltip
            contentStyle={{ background: 'var(--surface-card)', border: '0.5px solid var(--border)', borderRadius: 8, fontSize: 12 }}
            labelFormatter={(v) => formatPeriod(String(v))}
            formatter={(value: unknown, name: string) => {
              if (Array.isArray(value)) return [`${(value[0] as number).toFixed(1)} – ${(value[1] as number).toFixed(1)}`, name === 'band80' ? '80% interval' : '95% interval'];
              return [typeof value === 'number' ? value.toFixed(1) : String(value), name === 'history' ? 'Actual' : 'Forecast'];
            }}
          />
          <Area dataKey="band95" stroke="none" fill="var(--seq-1)" isAnimationActive={false} />
          <Area dataKey="band80" stroke="none" fill="var(--green-tint)" isAnimationActive={false} />
          <Line dataKey="history" stroke="var(--green-fill)" strokeWidth={2} dot={false} isAnimationActive={false} connectNulls={false} />
          <Line dataKey="forecast" stroke="var(--green-fill)" strokeWidth={2} strokeDasharray="5 4" dot={false} isAnimationActive={false} connectNulls={false} />
          <ReferenceLine x={boundary.period} stroke="var(--role-reference)" strokeWidth={1}
                         label={{ value: 'Forecast from', position: 'insideTopLeft', fontSize: 10, fill: 'var(--text-muted)' }} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
