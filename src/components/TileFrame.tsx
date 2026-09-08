import { useState } from 'react';
import type { Answer } from '../../shared/types.ts';
import { ExplainPanel } from './ExplainPanel.tsx';
import { ChatIcon, ChevronIcon, PinIcon, RefreshIcon, WarnIcon } from './Icons.tsx';

/**
 * Every tile gets the same controls once: refresh (busts this tile's cache key
 * only), add to chat (attaches this tile's plan as context), pin, and the
 * explainability disclosure.
 */
export function TileFrame({
  title, subtitle, answer, note, onRefresh, onAddToChat, onPin, pinned, actions, children,
}: {
  title: string;
  subtitle?: string;
  answer?: Answer | null;
  note?: string;
  onRefresh?: () => void;
  onAddToChat?: () => void;
  onPin?: () => void;
  pinned?: boolean;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const warnings = answer?.explain?.warnings ?? [];

  return (
    <section className="card" style={{ padding: '12px 14px', minWidth: 260 }}>
      <header style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 10 }}>
        <div style={{ minWidth: 0 }}>
          <h3 style={{ fontSize: 12, fontWeight: 500 }}>{title}</h3>
          {subtitle && <p style={{ fontSize: 11, color: 'var(--text-muted)' }}>{subtitle}</p>}
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 2 }}>
          {actions}
          {onAddToChat && <IconButton label="Add to chat" onClick={onAddToChat}><ChatIcon /></IconButton>}
          {onPin && <IconButton label={pinned ? 'Unpin' : 'Pin to dashboard'} onClick={onPin} active={pinned}><PinIcon /></IconButton>}
          {onRefresh && <IconButton label="Refresh" onClick={onRefresh}><RefreshIcon /></IconButton>}
        </div>
      </header>

      {children}

      {note && <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 8 }}>{note}</p>}

      {warnings.length > 0 && (
        <ul style={{ listStyle: 'none', margin: '8px 0 0', padding: 0, display: 'grid', gap: 5 }}>
          {warnings.map((w, i) => (
            <li key={i} style={{ display: 'flex', gap: 6, fontSize: 11, color: 'var(--amber-text)',
                                 background: 'var(--amber-tint)', padding: '5px 8px', borderRadius: 6 }}>
              <span style={{ flex: 'none', marginTop: 1 }}><WarnIcon /></span>
              <span>{w}</span>
            </li>
          ))}
        </ul>
      )}

      {answer?.explain && (
        <>
          <button onClick={() => setOpen(!open)} className="focusable"
                  style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 4, background: 'none',
                           border: 'none', padding: 0, cursor: 'pointer', fontSize: 11, color: 'var(--text-secondary)' }}>
            <ChevronIcon open={open} /> {open ? 'Hide' : 'How was this computed?'}
          </button>
          {open && <ExplainPanel answer={answer} />}
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
                     padding: 4, borderRadius: 5, display: 'flex',
                     color: active ? 'var(--text-primary)' : 'var(--text-muted)' }}>
      {children}
    </button>
  );
}
