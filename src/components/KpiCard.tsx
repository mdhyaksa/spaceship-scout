import { useRef, useState } from 'react';
import type { Answer, LayerCatalog } from '../../shared/types.ts';
import { formatValue } from '../../shared/format.ts';
import { ExplainPanel } from './ExplainPanel.tsx';
import { ExplainBubble } from './ExplainBubble.tsx';
import { InfoTooltip } from './InfoTooltip.tsx';
import { ChatIcon, RefreshIcon } from './Icons.tsx';
import { IconButton } from './TileFrame.tsx';

/**
 * A KPI card is a one-cell query, and it explains itself like everything else.
 *
 * Two differences from a chart tile. The explanation opens in a floating
 * bubble, because expanding inline stretched every card in the grid row. And
 * it is the compact variant: a single value has no rows to inspect beyond the
 * number on its face, and someone clicking Explain on "82.2%" wants to know
 * what it is a share of, not to read an IR.
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
  const triggerRef = useRef<HTMLButtonElement>(null);
  const row = answer?.data?.rows[0];
  const meta = (name?: string) => catalog?.metrics.find((m) => m.name === name);
  const format = meta(metric)?.format ?? 'integer';

  return (
    <div className="card" style={{ padding: 'var(--pad-card)', minWidth: 0, display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
        <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>{title}</p>
        {note && <InfoTooltip text={note} label={title} />}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 1 }}>
          <IconButton label="Add to chat" onClick={onAddToChat}><ChatIcon /></IconButton>
          <IconButton label="Refresh" onClick={onRefresh}><RefreshIcon /></IconButton>
        </div>
      </div>

      <p className="tnum" style={{ fontSize: 'var(--kpi)', fontWeight: 500, lineHeight: 1.15, marginTop: 8 }}>
        {row ? formatValue(row[metric] as number, format) : '—'}
      </p>

      {contextMetric && row && (
        <p className="tnum" style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)', marginTop: 5 }}>
          {(meta(contextMetric)?.label ?? '').toLowerCase()}{' '}
          {formatValue(row[contextMetric] as number, meta(contextMetric)?.format ?? 'integer')}
        </p>
      )}

      {answer?.explain && (
        <>
          <button ref={triggerRef} onClick={() => setOpen(!open)} className="focusable"
                  aria-expanded={open}
                  style={{ marginTop: 'auto', paddingTop: 12, display: 'flex', alignItems: 'center', gap: 5,
                           background: 'none', border: 'none', cursor: 'pointer',
                           fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>
            Explain
          </button>
          <ExplainBubble open={open} anchorRef={triggerRef} onClose={() => setOpen(false)} label={title}>
            <ExplainPanel answer={answer} variant="compact" />
          </ExplainBubble>
        </>
      )}
    </div>
  );
}
