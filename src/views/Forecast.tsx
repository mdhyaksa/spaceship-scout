import { useCallback, useEffect, useState } from 'react';
import type { Answer, ForecastResult, LayerCatalog } from '../../shared/types.ts';
import { api } from '../lib/api.ts';
import { TileFrame } from '../components/TileFrame.tsx';
import { ForecastChart } from '../charts/ForecastChart.tsx';
import { WarnIcon } from '../components/Icons.tsx';

export function ForecastView({ catalog }: { catalog: LayerCatalog | null }) {
  const [category, setCategory] = useState<string>('');
  const [sku, setSku] = useState('');
  const [horizon, setHorizon] = useState(4);
  const [leadTime, setLeadTime] = useState(21);
  const [serviceLevel, setServiceLevel] = useState(0.95);
  const [onHand, setOnHand] = useState<string>('');
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [busy, setBusy] = useState(false);

  const categories = catalog?.dimensions.find((d) => d.name === 'product_category')?.values ?? [];

  const run = useCallback(async (override?: { category?: string; sku?: string }) => {
    setBusy(true);
    try {
      const next = await api.forecast({
        target_metric: 'units_ordered',
        category: override?.category ?? (override?.sku ? null : category || null),
        sku: override?.sku ?? (sku.trim() || null),
        horizon,
        lead_time_days: leadTime,
        service_level: serviceLevel,
        current_on_hand: onHand.trim() ? Number(onHand) : null,
      });
      setAnswer(next);
    } finally {
      setBusy(false);
    }
  }, [category, sku, horizon, leadTime, serviceLevel, onHand]);

  useEffect(() => { void run(); /* first load only */ }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const result = answer?.forecast ?? null;
  const ok = result && 'ok' in result && result.ok ? (result as ForecastResult) : null;
  const refused = result && 'ok' in result && !result.ok ? result : null;

  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <section className="card" style={{ padding: '12px 14px' }}>
        <h3 style={{ fontSize: 12, fontWeight: 500, marginBottom: 10 }}>Demand forecast</h3>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <Field label="Product category">
            <select value={category} onChange={(e) => { setCategory(e.target.value); setSku(''); }} style={inputStyle}>
              <option value="">All categories</option>
              {categories.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </Field>
          <Field label="or a SKU">
            <input value={sku} onChange={(e) => setSku(e.target.value)} placeholder="PAPER-0197" style={inputStyle} />
          </Field>
          <Field label="Horizon (months)">
            <input type="number" min={1} max={12} value={horizon} onChange={(e) => setHorizon(Number(e.target.value))} style={{ ...inputStyle, width: 76 }} />
          </Field>
          <Field label="Lead time (days)">
            <input type="number" min={1} value={leadTime} onChange={(e) => setLeadTime(Number(e.target.value))} style={{ ...inputStyle, width: 84 }} />
          </Field>
          <Field label="Service level">
            <select value={serviceLevel} onChange={(e) => setServiceLevel(Number(e.target.value))} style={inputStyle}>
              <option value={0.9}>90%</option><option value={0.95}>95%</option><option value={0.99}>99%</option>
            </select>
          </Field>
          <Field label="On hand (optional)">
            <input value={onHand} onChange={(e) => setOnHand(e.target.value)} placeholder="unknown" style={{ ...inputStyle, width: 96 }} />
          </Field>
          <button onClick={() => void run()} disabled={busy} className="focusable"
                  style={{ fontSize: 12, padding: '7px 16px', borderRadius: 'var(--radius-pill)', border: 'none',
                           background: 'var(--brand-soft)', cursor: busy ? 'wait' : 'pointer' }}>
            {busy ? 'Fitting…' : 'Forecast'}
          </button>
        </div>
      </section>

      {refused && (
        <section className="card" style={{ padding: '12px 14px' }}>
          <div style={{ display: 'flex', gap: 8, background: 'var(--amber-tint)', color: 'var(--amber-text)',
                        padding: '10px 12px', borderRadius: 8, fontSize: 12, lineHeight: 1.5 }}>
            <span style={{ flex: 'none', marginTop: 2 }}><WarnIcon /></span>
            <div>
              <p style={{ fontWeight: 500, marginBottom: 4 }}>This series cannot be forecast.</p>
              <p>{refused.reason}</p>
              {refused.fallback && (
                <button onClick={() => { setSku(''); setCategory(refused.fallback!.series_filters[0]!.value[0]!); void run({ category: refused.fallback!.series_filters[0]!.value[0]! }); }}
                        className="focusable"
                        style={{ marginTop: 8, fontSize: 11, padding: '4px 12px', borderRadius: 'var(--radius-pill)',
                                 border: '0.5px solid var(--amber-text)', background: 'transparent', color: 'var(--amber-text)', cursor: 'pointer' }}>
                  {refused.fallback.label}
                </button>
              )}
            </div>
          </div>
        </section>
      )}

      {ok && (
        <>
          <TileFrame title={`Projected units${category ? ` — ${category}` : ''}`}
                     subtitle={`${ok.method.replace('_', ' ')}, chosen by backtest`}
                     answer={answer}>
            <ForecastChart result={ok} />
            {ok.low_confidence && (
              <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 6 }}>
                Fitted on {ok.history.length} monthly points. The band is the answer here, not the line.
              </p>
            )}
          </TileFrame>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 10 }}>
            <section className="card" style={{ padding: '12px 14px' }}>
              <h3 style={{ fontSize: 12, fontWeight: 500, marginBottom: 8 }}>Method</h3>
              <p style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.55 }}>{ok.explanation}</p>
              <table style={{ marginTop: 10, width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
                <tbody>
                  {ok.candidates.map((c) => (
                    <tr key={c.method} style={{ color: c.method === ok.method ? 'var(--text-primary)' : 'var(--text-muted)' }}>
                      <td style={{ padding: '3px 0' }}>{c.method.replace('_', ' ')}{c.method === ok.method ? ' ✓' : ''}</td>
                      <td className="tnum" style={{ textAlign: 'right' }}>{c.metric} {c.error.toFixed(3)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {ok.notes.map((n, i) => (
                <p key={i} style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 8, lineHeight: 1.5 }}>{n}</p>
              ))}
            </section>

            {ok.inventory && (
              <section className="card" style={{ padding: '12px 14px' }}>
                <h3 style={{ fontSize: 12, fontWeight: 500, marginBottom: 8 }}>Inventory recommendation</h3>
                <dl style={{ margin: 0, display: 'grid', gridTemplateColumns: '1fr auto', gap: '5px 12px', fontSize: 12 }}>
                  <Stat label="Demand over lead time" value={ok.inventory.demand_over_lead_time.toFixed(1)} />
                  <Stat label={`Safety stock (z ${ok.inventory.z.toFixed(2)})`} value={ok.inventory.safety_stock.toFixed(1)} />
                  <Stat label="Reorder point" value={ok.inventory.reorder_point.toFixed(1)} strong />
                  <Stat label="Order-up-to level" value={ok.inventory.order_up_to.toFixed(1)} strong />
                  {ok.inventory.suggested_order_qty !== null && (
                    <Stat label="Suggested order" value={ok.inventory.suggested_order_qty.toFixed(0)} strong />
                  )}
                </dl>
                <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 10, lineHeight: 1.5 }}>{ok.inventory.note}</p>
              </section>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'grid', gap: 4 }}>
      <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{label}</span>
      {children}
    </label>
  );
}

function Stat({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <>
      <dt style={{ color: 'var(--text-secondary)' }}>{label}</dt>
      <dd className="tnum" style={{ margin: 0, textAlign: 'right', fontWeight: strong ? 500 : 400 }}>{value}</dd>
    </>
  );
}

const inputStyle: React.CSSProperties = {
  fontSize: 12, padding: '6px 9px', borderRadius: 6,
  border: '0.5px solid var(--border-strong)', background: 'var(--surface-card)',
};
