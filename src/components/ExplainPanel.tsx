import { useState } from 'react';
import type { Answer } from '../../shared/types.ts';
import { formatValue } from '../../shared/format.ts';

/**
 * Every answer and every tile can show how it was computed: the filters that
 * were applied, the metric definitions behind the numbers, the query plan, the
 * compiled SQL, and the rows themselves.
 *
 * Two variants. A chart tile or a chat answer gets the full panel. A KPI card
 * gets the compact one — a single value has no rows to inspect beyond the
 * number on its face, and a query plan is not what someone clicking Explain on
 * "82.2%" is asking for. They want to know what the 82.2% is a share of.
 */
export function ExplainPanel({ answer, variant = 'full' }: { answer: Answer; variant?: 'full' | 'compact' }) {
  const [tab, setTab] = useState<'plan' | 'data' | 'sql'>('plan');
  const explain = answer.explain;
  if (!explain) return null;

  const compact = variant === 'compact';

  return (
    <div style={{ minWidth: 0 }}>
      {!compact && (
        <div style={{ display: 'flex', gap: 5, marginBottom: 10, flexWrap: 'wrap', alignItems: 'baseline', minWidth: 0 }}>
          {(['plan', 'data', 'sql'] as const).map((t) => (
            <button key={t} onClick={() => setTab(t)} className="focusable"
                    style={{
                      fontSize: 'var(--text-sm)', padding: '4px 11px', borderRadius: 'var(--radius-pill)', cursor: 'pointer',
                      border: '0.5px solid ' + (tab === t ? 'var(--border-strong)' : 'transparent'),
                      background: tab === t ? 'var(--surface-inset)' : 'transparent',
                      color: tab === t ? 'var(--text-primary)' : 'var(--text-secondary)',
                    }}>
              {t === 'plan' ? 'Query plan' : t === 'data' ? `Data (${explain.row_count})` : 'SQL'}
            </button>
          ))}
          <span style={{ marginLeft: 'auto', fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }} className="tnum">
            layer {explain.layer_version} · {explain.execution_ms} ms{explain.cached ? ' · cached' : ''}
          </span>
        </div>
      )}

      {(compact || tab === 'plan') && (
        <div style={{ display: 'grid', gap: 9, fontSize: 'var(--text-md)', minWidth: 0 }}>
          <Row label="Interpretation">{explain.interpretation || '—'}</Row>
          <Row label="Metrics">
            <ul style={{ margin: 0, paddingLeft: 16 }}>
              {explain.metrics.map((m) => (
                <li key={m.name} style={{ marginBottom: 4 }}>
                  <strong style={{ fontWeight: 500 }}>{m.label}</strong> — {m.definition}
                  {m.notes && <div style={{ color: 'var(--text-muted)', fontSize: 'var(--text-sm)' }}>{m.notes}</div>}
                </li>
              ))}
            </ul>
          </Row>
          {explain.dimensions.length > 0 && (
            <Row label="Dimensions">{explain.dimensions.map((d) => d.label).join(', ')}</Row>
          )}
          <Row label="Filters">
            {explain.filters.length
              ? explain.filters.map((f) => `${f.label} ${f.op} ${f.value.join(', ')}`).join(' · ')
              : 'None'}
          </Row>
          {explain.time && (
            <Row label="Period">
              <span className="tnum">{explain.time.range}</span> on {explain.time.label.toLowerCase()}
              <div style={{ color: 'var(--text-muted)', fontSize: 'var(--text-sm)' }}>
                Anchored to {explain.time.anchor} — relative dates resolve against the data, not today.
                {' '}Timezone {explain.time.timezone}.
                {explain.time.partial_period && ' The final period is incomplete.'}
              </div>
            </Row>
          )}
          {compact ? (
            <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }} className="tnum">
              layer {explain.layer_version} · {explain.execution_ms} ms{explain.cached ? ' · cached' : ''}
            </p>
          ) : (
            <Row label="Plan">
              <pre style={preStyle}>{JSON.stringify(explain.ir, null, 2)}</pre>
            </Row>
          )}
        </div>
      )}

      {!compact && tab === 'data' && answer.data && <DataTable answer={answer} />}

      {!compact && tab === 'sql' && (
        <div style={{ minWidth: 0 }}>
          <pre style={preStyle}>{explain.sql}</pre>
          {explain.params.length > 0 && (
            <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)', marginTop: 6 }}>
              Bound parameters: {explain.params.map((p) => JSON.stringify(p)).join(', ')}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    // minWidth: 0 on the content column is the whole fix for the overflow in
    // ref/Screenshot 2026-09-10 at 09.31.01.png. A grid track's implicit
    // min-width is auto — min-content — so without it the wide <pre> sizes the
    // track instead of scrolling inside it, and overflow-x never engages.
    <div style={{ display: 'grid', gridTemplateColumns: '104px minmax(0, 1fr)', gap: 12, alignItems: 'baseline', minWidth: 0 }}>
      <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)' }}>{label}</span>
      <div style={{ color: 'var(--text-secondary)', minWidth: 0 }}>{children}</div>
    </div>
  );
}

function DataTable({ answer }: { answer: Answer }) {
  const { columns, rows } = answer.data!;
  const isText = (type: string) => type === 'categorical' || type === 'time' || type === 'ordinal';
  return (
    <div style={{ overflowX: 'auto', overflowY: 'auto', maxHeight: 300, minWidth: 0 }}>
      <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 'var(--text-sm)' }}>
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} style={{ textAlign: isText(c.type) ? 'left' : 'right',
                                       padding: '5px 10px', borderBottom: '0.5px solid var(--border-strong)',
                                       fontWeight: 500, color: 'var(--text-secondary)', whiteSpace: 'nowrap',
                                       position: 'sticky', top: 0, background: 'var(--surface-card)' }}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} style={{ background: i % 2 ? 'var(--surface-inset)' : 'transparent' }}>
              {columns.map((c) => (
                <td key={c.key} className="tnum"
                    style={{ textAlign: isText(c.type) ? 'left' : 'right',
                             padding: '5px 10px', whiteSpace: 'nowrap' }}>
                  {isText(c.type) ? String(r[c.key] ?? '—') : formatValue(r[c.key] as number, c.type)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const preStyle: React.CSSProperties = {
  margin: 0, background: 'var(--surface-inset)', padding: 10, borderRadius: 8,
  fontSize: 'var(--text-sm)', lineHeight: 1.5,
  overflowX: 'auto', overflowY: 'auto', maxHeight: 260, maxWidth: '100%',
  whiteSpace: 'pre',
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
};
