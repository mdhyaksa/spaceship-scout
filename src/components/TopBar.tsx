import { forwardRef } from 'react';
import type { LayerCatalog } from '../../shared/types.ts';
import { VIEWS, type View } from '../lib/views.ts';
import { ChatIcon } from './Icons.tsx';

/**
 * One bar across the top, sticky, replacing a 132px vertical rail that spent
 * most of its width on background. Horizontal navigation costs no content
 * width at all and stays reachable after scrolling.
 */
export const TopBar = forwardRef<HTMLElement, {
  view: View;
  onChange: (v: View) => void;
  catalog: LayerCatalog | null;
  chatOpen: boolean;
  onToggleChat: () => void;
}>(function TopBar({ view, onChange, catalog, chatOpen, onToggleChat }, ref) {
  return (
    <header ref={ref} style={{
      position: 'sticky', top: 14, zIndex: 50,
      background: 'var(--surface-rail)', borderRadius: 'var(--radius-card)',
      padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 18, flexWrap: 'wrap',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
        <span style={{ width: 17, height: 17, background: 'var(--brand)', borderRadius: 4, display: 'inline-block' }} />
        <span style={{ fontSize: 'var(--text-md)', fontWeight: 500, color: 'var(--text-on-rail)' }}>Space Scout</span>
      </div>

      <nav style={{ display: 'flex', gap: 2 }}>
        {VIEWS.map((item) => {
          const active = view === item.id;
          return (
            <button key={item.id} className="focusable"
                    aria-current={active ? 'page' : undefined}
                    onClick={() => onChange(item.id)}
                    style={{
                      padding: '6px 12px', borderRadius: 7, border: 'none', cursor: 'pointer',
                      background: active ? 'rgba(255,255,255,0.11)' : 'transparent',
                      color: active ? 'var(--text-on-rail)' : 'var(--text-rail-dim)',
                      fontSize: 'var(--text-sm)', fontWeight: active ? 500 : 400, whiteSpace: 'nowrap',
                    }}>
              {item.label}
            </button>
          );
        })}
      </nav>

      <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 14 }}>
        <span className="tnum" style={{ fontSize: 'var(--text-xs)', color: '#7A7A80', whiteSpace: 'nowrap' }}>
          Data through {catalog?.data_as_of ?? '—'} · layer {catalog?.version ?? '—'}
        </span>
        <button onClick={onToggleChat} className="focusable"
                aria-expanded={chatOpen}
                style={{
                  display: 'flex', alignItems: 'center', gap: 7, cursor: 'pointer',
                  padding: '6px 13px', borderRadius: 'var(--radius-pill)', border: 'none',
                  background: chatOpen ? 'var(--brand-soft)' : 'rgba(255,255,255,0.11)',
                  color: chatOpen ? 'var(--text-primary)' : 'var(--text-on-rail)',
                  fontSize: 'var(--text-sm)', fontWeight: 500, whiteSpace: 'nowrap',
                }}>
          <ChatIcon /> Ask
        </button>
      </div>
    </header>
  );
});
