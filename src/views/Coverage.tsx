import { useEffect, useState } from 'react';
import type { CoverageRow } from '../../shared/types.ts';
import { api } from '../lib/api.ts';

/**
 * What the semantic layer could not answer.
 *
 * A question that repeatedly falls through is a missing layer object, not an
 * error. The clustering, gap taxonomy and promotion workflow that turn this
 * into a roadmap are specified and deliberately not built; the log that feeds
 * them ships from day one, because retrofitting it later throws away the most
 * informative weeks of usage there are.
 */
export function Coverage() {
  const [rows, setRows] = useState<CoverageRow[]>([]);
  const [totals, setTotals] = useState<{ path: string; n: number }[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.coverage().then((r) => { setRows(r.rows); setTotals(r.totals); }).catch((e) => setError((e as Error).message));
  }, []);

  const total = totals.reduce((s, t) => s + Number(t.n), 0);
  const verified = Number(totals.find((t) => t.path === 'ir')?.n ?? 0);

  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <section className="card" style={{ padding: '12px 14px' }}>
        <h3 style={{ fontSize: 12, fontWeight: 500 }}>Coverage</h3>
        <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 6, lineHeight: 1.55, maxWidth: 640 }}>
          Every request writes a row, whatever path it took. Questions that clarified, were refused, or ran
          perfectly and returned nothing are listed below — each one is a candidate metric, dimension or
          glossary term rather than a bug.
        </p>
        <div style={{ display: 'flex', gap: 6, marginTop: 10, flexWrap: 'wrap' }}>
          {totals.map((t) => (
            <span key={t.path} className="pill tnum"
                  style={{ background: t.path === 'ir' ? 'var(--green-tint)' : 'var(--surface-inset)',
                           color: t.path === 'ir' ? 'var(--green-text)' : 'var(--text-secondary)' }}>
              {t.path} {t.n}
            </span>
          ))}
          {total > 0 && (
            <span className="pill tnum" style={{ background: 'var(--surface-inset)', color: 'var(--text-secondary)' }}>
              verified answer rate {((verified / total) * 100).toFixed(0)}%
            </span>
          )}
        </div>
      </section>

      <section className="card" style={{ padding: '12px 14px' }}>
        {error && <p style={{ fontSize: 12, color: 'var(--amber-text)' }}>{error}</p>}
        {!error && rows.length === 0 && (
          <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            Nothing has fallen through yet. Ask something the layer cannot express and it will appear here.
          </p>
        )}
        {rows.length > 0 && (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr>
                {['Question', 'Path', 'Why', 'Count'].map((h, i) => (
                  <th key={h} style={{ textAlign: i === 3 ? 'right' : 'left', padding: '5px 8px',
                                       borderBottom: '0.5px solid var(--border-strong)', fontWeight: 500,
                                       color: 'var(--text-secondary)' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} style={{ background: i % 2 ? 'var(--surface-inset)' : 'transparent' }}>
                  <td style={{ padding: '5px 8px' }}>{r.question}</td>
                  <td style={{ padding: '5px 8px' }}>
                    <span className="pill" style={{ background: 'var(--amber-tint)', color: 'var(--amber-text)' }}>{r.path}</span>
                  </td>
                  <td style={{ padding: '5px 8px', color: 'var(--text-muted)', maxWidth: 420 }}>{r.reason ?? '—'}</td>
                  <td className="tnum" style={{ padding: '5px 8px', textAlign: 'right' }}>{r.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
