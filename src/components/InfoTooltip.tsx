import { useEffect, useRef, useState } from 'react';
import { InfoIcon } from './Icons.tsx';

/**
 * A caveat that has to stay reachable without taking a paragraph of space.
 *
 * The delayed-orders denominator and the excluded-orders note are load-bearing
 * — the first is the exact trap the semantic layer exists to prevent — so they
 * keep a visible affordance rather than being demoted into the explain panel.
 * Opens on hover and on focus, toggles on click so it works by touch and by
 * keyboard, and stays in the accessibility tree either way.
 */
export function InfoTooltip({ text, label, children, width = 250 }: {
  text: string;
  label: string;
  /** Trigger. Defaults to an info icon; pass an element to make that element
   *  the trigger instead — the Verified pill explains itself this way. */
  children?: React.ReactNode;
  width?: number;
}) {
  const [open, setOpen] = useState(false);
  const [pinned, setPinned] = useState(false);
  const wrapRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setOpen(false); setPinned(false); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  const id = `note-${label.replace(/\W+/g, '-').toLowerCase()}`;

  return (
    <span ref={wrapRef} style={{ position: 'relative', display: 'inline-flex' }}
          onMouseEnter={() => setOpen(true)}
          onMouseLeave={() => !pinned && setOpen(false)}>
      <button type="button" className="focusable"
              aria-label={`About ${label}`}
              aria-expanded={open}
              aria-describedby={open ? id : undefined}
              onClick={() => { setPinned(!pinned); setOpen(!pinned || !open); }}
              onFocus={() => setOpen(true)}
              onBlur={() => !pinned && setOpen(false)}
              style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer',
                       display: 'flex', color: open ? 'var(--text-secondary)' : 'var(--text-muted)' }}>
        {children ?? <InfoIcon />}
      </button>
      {open && (
        <span id={id} role="tooltip"
              style={{
                position: 'absolute', top: 'calc(100% + 7px)', left: '50%', transform: 'translateX(-50%)',
                textAlign: 'left',
                width, zIndex: 60, padding: '9px 11px',
                background: 'var(--surface-rail)', color: 'var(--text-on-rail)',
                borderRadius: 8, fontSize: 'var(--text-sm)', lineHeight: 1.5, fontWeight: 400,
                boxShadow: '0 8px 22px rgba(20, 20, 20, 0.22)',
              }}>
          {text}
        </span>
      )}
    </span>
  );
}
