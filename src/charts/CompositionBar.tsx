import { formatValue } from '../../shared/format.ts';

const ROLE: Record<string, { fill: string; tint: string; text: string; label: string }> = {
  delivered:  { fill: 'var(--green-fill)',      tint: 'var(--green-tint)',      text: 'var(--green-text)',      label: 'Delivered' },
  delayed:    { fill: 'var(--amber-fill)',      tint: 'var(--amber-tint)',      text: 'var(--amber-text)',      label: 'Delayed' },
  exception:  { fill: 'var(--amber-deep-fill)', tint: 'var(--amber-deep-tint)', text: 'var(--amber-deep-text)', label: 'Exception' },
  in_transit: { fill: 'var(--teal-fill)',       tint: 'var(--teal-tint)',       text: 'var(--teal-text)',       label: 'In transit' },
  canceled:   { fill: 'var(--neutral-fill)',    tint: 'var(--neutral-tint)',    text: 'var(--neutral-text)',    label: 'Canceled' },
};

const ORDER = ['delivered', 'delayed', 'exception', 'in_transit', 'canceled'];

/**
 * Delivery performance across all five statuses.
 *
 * Two denominators, stated rather than implied: the bar is a share of all
 * orders, and the summary line underneath is a share of completed deliveries.
 * Delayed and delivered are mutually exclusive, so a rate over "delivered"
 * would be the wrong number.
 */
export function CompositionBar({ rows }: { rows: Record<string, string | number | null>[] }) {
  const byStatus = new Map(rows.map((r) => [String(r['order_status']), Number(r['order_count'] ?? 0)]));
  const segments = ORDER.map((status) => ({ status, count: byStatus.get(status) ?? 0 })).filter((s) => s.count > 0);
  const total = segments.reduce((sum, s) => sum + s.count, 0);
  const completed = ['delivered', 'delayed', 'exception'].reduce((sum, s) => sum + (byStatus.get(s) ?? 0), 0);

  if (total === 0) return <Empty />;

  const rate = (status: string) => (completed ? (byStatus.get(status) ?? 0) / completed : 0);

  return (
    <div>
      <div style={{ display: 'flex', height: 28, borderRadius: 4, overflow: 'hidden', marginBottom: 10 }}
           role="img" aria-label={segments.map((s) => `${ROLE[s.status]?.label} ${s.count}`).join(', ')}>
        {segments.map((s) => (
          <div key={s.status}
               title={`${ROLE[s.status]?.label}: ${s.count} of ${total}`}
               style={{ flex: s.count, background: ROLE[s.status]?.fill, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            {s.count / total > 0.1 && (
              <span className="tnum" style={{ fontSize: 11, fontWeight: 500, color: s.status === 'canceled' ? 'var(--text-secondary)' : '#FFFFFF' }}>
                {((s.count / total) * 100).toFixed(1)}%
              </span>
            )}
          </div>
        ))}
      </div>

      {/* Amber alone never carries meaning here — the label is always beside it. */}
      <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginBottom: 10 }}>
        {segments.map((s) => (
          <span key={s.status} className="pill tnum"
                style={{ background: ROLE[s.status]?.tint, color: ROLE[s.status]?.text }}>
            {ROLE[s.status]?.label} {s.count}
          </span>
        ))}
      </div>

      <div style={{ borderTop: '0.5px solid var(--border)', paddingTop: 9, display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'baseline' }}>
        <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>Of {completed} completed</span>
        {(['delivered', 'delayed', 'exception'] as const).map((s) => (
          <span key={s} style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
            <span className="tnum" style={{ fontWeight: 500, color: 'var(--text-primary)' }}>{formatValue(rate(s), 'percent')}</span>
            {' '}{s === 'delivered' ? 'on time' : s}
          </span>
        ))}
      </div>
    </div>
  );
}

export function Empty({ message = 'No orders match these filters' }: { message?: string }) {
  return (
    <div style={{ height: 120, display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 13, color: 'var(--text-secondary)' }}>
      {message}
    </div>
  );
}
