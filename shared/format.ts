/** Shared by the Worker (answer text) and the SPA (axes, tiles, tables) so a
 *  number never renders two ways. */
import type { MetricFormat } from './layer-types.ts';

export function formatValue(value: number | string | null, format: MetricFormat | string): string {
  if (value === null || value === '') return '—';
  const n = typeof value === 'number' ? value : Number(value);
  if (Number.isNaN(n)) return String(value);
  switch (format) {
    case 'percent':
      return `${(n * 100).toFixed(1)}%`;
    case 'days_1dp':
      return `${n.toFixed(1)} d`;
    case 'currency_usd':
      return n >= 10_000
        ? `$${(n / 1000).toFixed(1)}k`
        : `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    case 'integer':
      return Math.round(n).toLocaleString('en-US');
    default:
      return String(value);
  }
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Period keys come back as 2025-03, 2025-W12, 2025-Q1, 2025 or a full date. */
export function formatPeriod(period: string): string {
  const month = /^(\d{4})-(\d{2})$/.exec(period);
  if (month) return `${MONTHS[Number(month[2]) - 1]} ${month[1]!.slice(2)}`;
  const day = /^(\d{4})-(\d{2})-(\d{2})$/.exec(period);
  if (day) return `${Number(day[3])} ${MONTHS[Number(day[2]) - 1]}`;
  return period.replace('-W', ' w');
}
