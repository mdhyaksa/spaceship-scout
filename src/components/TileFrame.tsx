import { useRef, useState } from 'react';
import type { Answer } from '../../shared/types.ts';
import { ExplainPanel } from './ExplainPanel.tsx';
import { ExplainBubble } from './ExplainBubble.tsx';
import { ChatIcon, RefreshIcon, WarnIcon } from './Icons.tsx';

/**
 * Every tile gets the same controls once: refresh (busts this tile's cache key
 * only), add to chat (attaches this tile's plan as context), pin, and the
 * explanation.
 *
 * The explanation opens in a floating bubble rather than expanding inline —
 * two tiles side by side in a grid row would otherwise stretch together, so
 * opening one moved the other.
 */
export function TileFrame({
  title, subtitle, answer, note, onRefresh, onAddToChat, actions, children,
}: {
  title: string;
  subtitle?: string;
  answer?: Answer | null;
  note?: string;
  onRefresh?: () => void;
  onAddToChat?: () => void;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const warnings = answer?.explain?.warnings ?? [];

  return (
    <section className="card" style={{ padding: 'var(--pad-tile)', minWidth: 0 }}>
      <header style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 12, flexWrap: 'wrap' }}>
        <div style={{ minWidth: 0 }}>
          <h3 style={{ fontSize: 'var(--text-md)', fontWeight: 500 }}>{title}</h3>
          {subtitle && <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)' }}>{subtitle}</p>}
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 2 }}>
          {actions}
          {onAddToChat && <IconButton label="Add to chat" onClick={onAddToChat}><ChatIcon /></IconButton>}
          {onRefresh && <IconButton label="Refresh" onClick={onRefresh}><RefreshIcon /></IconButton>}
        </div>
      </header>

      {children}

      {note && <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)', marginTop: 10 }}>{note}</p>}

      {warnings.length > 0 && (
        <ul style={{ listStyle: 'none', margin: '10px 0 0', padding: 0, display: 'grid', gap: 6 }}>
          {warnings.map((w, i) => (
            <li key={i} style={{ display: 'flex', gap: 8, fontSize: 'var(--text-sm)', color: 'var(--amber-text)',
                                 background: 'var(--amber-tint)', padding: '7px 10px', borderRadius: 7 }}>
              <span style={{ flex: 'none', marginTop: 2 }}><WarnIcon /></span>
              <span>{w}</span>
            </li>
          ))}
        </ul>
      )}

      {answer?.explain && (
        <>
          <button ref={triggerRef} onClick={() => setOpen(!open)} className="focusable"
                  aria-expanded={open}
                  style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 5, background: 'none',
                           border: 'none', padding: 0, cursor: 'pointer',
                           fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>
            How was this computed?
          </button>
          <ExplainBubble open={open} anchorRef={triggerRef} onClose={() => setOpen(false)} label={title}>
            <ExplainPanel answer={answer} />
          </ExplainBubble>
        </>
      )}
    </section>
  );
}

export function IconButton({ label, onClick, active, children }: {
  label: string; onClick: () => void; active?: boolean; children: React.ReactNode;
}) {
  return (
    <button aria-label={label} title={label} onClick={onClick} className="focusable"
            style={{ background: active ? 'var(--surface-inset)' : 'none', border: 'none', cursor: 'pointer',
                     padding: 5, borderRadius: 6, display: 'flex',
                     color: active ? 'var(--text-primary)' : 'var(--text-muted)' }}>
      {children}
    </button>
  );
}
