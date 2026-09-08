import { useState } from 'react';
import type { Answer } from '../../shared/types.ts';
import { formatValue } from '../../shared/format.ts';

/**
 * Every answer and every tile can show how it was computed: the filters that
 * were applied, the metric definitions behind the numbers, the query plan, the
 * compiled SQL, and the rows themselves.
 *
 * A KPI card is a one-cell query and gets exactly the same treatment as a
 * chart, because "where did 82.2% come from" is the same question either way.
 */
export function ExplainPanel({ answer }: { answer: Answer }) {
  const [tab, setTab] = useState<'plan' | 'data' | 'sql'>('plan');
  const explain = answer.explain;
  if (!explain) return null;

  return (
    <div style={{ borderTop: '0.5px solid var(--border)', marginTop: 10, paddingTop: 9 }}>
      <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
        {(['plan', 'data', 'sql'] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)} className="focusable"
                  style={{
                    fontSize: 11, padding: '3px 9px', borderRadius: 'var(--radius-pill)', cursor: 'pointer',
                    border: '0.5px solid ' + (tab === t ? 'var(--border-strong)' : 'transparent'),
                    background: tab === t ? 'var(--surface-inset)' : 'transparent',
                    color: tab === t ? 'var(--text-primary)' : 'var(--text-secondary)',
                  }}>
            {t === 'plan' ? 'Query plan' : t === 'data' ? `Data (${explain.row_count})` : 'SQL'}
          </button>
        ))}
        <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--text-muted)' }} className="tnum">
          layer {explain.layer_version} · {explain.execution_ms} ms{explain.cached ? ' · cached' : ''}
        </span>
      </div>

      {tab === 'plan' && (
        <div style={{ display: 'grid', gap: 8, fontSize: 12 }}>
          <Row label="Interpretation">{explain.interpretation || '—'}</Row>
          <Row label="Metrics">
            <ul style={{ margin: 0, paddingLeft: 14 }}>
              {explain.metrics.map((m) => (
                <li key={m.name} style={{ marginBottom: 3 }}>
                  <strong style={{ fontWeight: 500 }}>{m.label}</strong> — {m.definition}
                  {m.notes && <div style={{ color: 'var(--text-muted)', fontSize: 11 }}>{m.notes}</div>}
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
              <div style={{ color: 'var(--text-muted)', fontSize: 11 }}>
                Anchored to {explain.time.anchor} — relative dates resolve against the data, not today.
                {' '}Timezone {explain.time.timezone}.
                {explain.time.partial_period && ' The final period is incomplete.'}
              </div>
            </Row>
          )}
          <Row label="Plan">
            <pre style={preStyle}>{JSON.stringify(explain.ir, null, 2)}</pre>
          </Row>
        </div>
      )}

      {tab === 'data' && answer.data && <DataTable answer={answer} />}

      {tab === 'sql' && (
        <div>
          <pre style={preStyle}>{explain.sql}</pre>
          {explain.params.length > 0 && (
            <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
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
    <div style={{ display: 'grid', gridTemplateColumns: '92px 1fr', gap: 10, alignItems: 'baseline' }}>
      <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{label}</span>
      <div style={{ color: 'var(--text-secondary)' }}>{children}</div>
    </div>
  );
}

function DataTable({ answer }: { answer: Answer }) {
  const { columns, rows } = answer.data!;
  return (
    <div style={{ overflowX: 'auto', maxHeight: 260, overflowY: 'auto' }}>
      <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 12 }}>
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} style={{ textAlign: c.type === 'categorical' || c.type === 'time' ? 'left' : 'right',
                                       padding: '4px 8px', borderBottom: '0.5px solid var(--border-strong)',
                                       fontWeight: 500, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
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
                    style={{ textAlign: c.type === 'categorical' || c.type === 'time' ? 'left' : 'right',
                             padding: '4px 8px', whiteSpace: 'nowrap' }}>
                  {c.type === 'categorical' || c.type === 'time' || c.type === 'ordinal'
                    ? String(r[c.key] ?? '—')
                    : formatValue(r[c.key] as number, c.type)}
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
  margin: 0, background: 'var(--surface-inset)', padding: 8, borderRadius: 6,
  fontSize: 11, lineHeight: 1.5, overflowX: 'auto', maxHeight: 220,
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
};
