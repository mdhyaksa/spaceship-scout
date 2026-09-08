import { useState } from 'react';
import type { Answer, LayerCatalog } from '../../shared/types.ts';
import { formatValue } from '../../shared/format.ts';
import { ExplainPanel } from './ExplainPanel.tsx';
import { ChatIcon, ChevronIcon, RefreshIcon } from './Icons.tsx';
import { IconButton } from './TileFrame.tsx';

/**
 * A KPI card is a one-cell query, and it gets the same explainability as a
 * chart. Every card is bound to a metric id in the semantic layer rather than
 * to hand-written SQL, which is why a card and a chat answer cannot disagree.
 */
export function KpiCard({
  title, answer, metric, contextMetric, note, catalog, onRefresh, onAddToChat,
}: {
  title: string;
  answer: Answer | null;
  metric: string;
  contextMetric?: string;
  note?: string;
  catalog: LayerCatalog | null;
  onRefresh: () => void;
  onAddToChat: () => void;
}) {
  const [open, setOpen] = useState(false);
  const row = answer?.data?.rows[0];
  const format = catalog?.metrics.find((m) => m.name === metric)?.format ?? 'integer';
  const contextFormat = catalog?.metrics.find((m) => m.name === contextMetric)?.format ?? 'integer';
  const contextLabel = catalog?.metrics.find((m) => m.name === contextMetric)?.label ?? '';

  return (
    <div className="card" style={{ padding: 10, minWidth: 140, display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6 }}>
        <p style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 5 }}>{title}</p>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 1 }}>
          <IconButton label="Add to chat" onClick={onAddToChat}><ChatIcon /></IconButton>
          <IconButton label="Refresh" onClick={onRefresh}><RefreshIcon /></IconButton>
        </div>
      </div>

      <p className="tnum" style={{ fontSize: 20, fontWeight: 500, lineHeight: 1.2 }}>
        {row ? formatValue(row[metric] as number, format) : '—'}
      </p>

      {contextMetric && row && (
        <p className="tnum" style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 3 }}>
          {contextLabel.toLowerCase()} {formatValue(row[contextMetric] as number, contextFormat)}
        </p>
      )}

      {note && <p style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 5, lineHeight: 1.4 }}>{note}</p>}

      {answer?.explain && (
        <>
          <button onClick={() => setOpen(!open)} className="focusable"
                  style={{ marginTop: 'auto', paddingTop: 6, display: 'flex', alignItems: 'center', gap: 3,
                           background: 'none', border: 'none', cursor: 'pointer', fontSize: 10, color: 'var(--text-secondary)' }}>
            <ChevronIcon open={open} /> {open ? 'Hide' : 'Explain'}
          </button>
          {open && <ExplainPanel answer={answer} />}
        </>
      )}
    </div>
  );
}
