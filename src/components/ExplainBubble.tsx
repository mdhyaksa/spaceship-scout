import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/**
 * A floating panel anchored to its trigger.
 *
 * Explanations used to expand inline. In a CSS grid that stretches every card
 * in the row to match, so opening one card's explanation moved four unrelated
 * cards — and inside a rounded, padded card the panel had no room and spilled
 * across its neighbours.
 *
 * Rendering into a portal on document.body fixes both: the bubble is out of
 * flow so the grid never reflows, and no ancestor's overflow or border-radius
 * can clip it.
 */
const MARGIN = 12;
const MAX_WIDTH = 560;

export function ExplainBubble({
  open, anchorRef, onClose, label, children,
}: {
  open: boolean;
  anchorRef: React.RefObject<HTMLElement | null>;
  onClose: () => void;
  label: string;
  children: React.ReactNode;
}) {
  const bubbleRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ top: number; left: number; width: number } | null>(null);

  useLayoutEffect(() => {
    if (!open) { setPosition(null); return; }
    const place = () => {
      const anchor = anchorRef.current?.getBoundingClientRect();
      if (!anchor) return;
      // clientWidth, not innerWidth: innerWidth includes the scrollbar, so a
      // bubble sized against it overhangs the right edge by the scrollbar's
      // width on any page tall enough to scroll — which is this one.
      const viewportWidth = document.documentElement.clientWidth;
      const viewportHeight = document.documentElement.clientHeight;
      const width = Math.min(MAX_WIDTH, viewportWidth - MARGIN * 2);
      const height = bubbleRef.current?.offsetHeight ?? 320;

      // Below the trigger by default; above when there is not room below but
      // there is above.
      const roomBelow = viewportHeight - anchor.bottom - MARGIN;
      const above = roomBelow < height && anchor.top - MARGIN > roomBelow;
      const top = above ? Math.max(MARGIN, anchor.top - height - 6) : anchor.bottom + 6;

      // Prefer left-aligned with the trigger, clamped into the viewport.
      const left = Math.min(Math.max(MARGIN, anchor.left), viewportWidth - width - MARGIN);
      setPosition({ top, left, width });
    };
    place();
    // Re-place after the first paint, once the real height is known.
    const raf = requestAnimationFrame(place);
    window.addEventListener('resize', place);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', place);
    };
  }, [open, anchorRef, children]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { onClose(); anchorRef.current?.focus(); }
    };
    const onPointer = (e: PointerEvent) => {
      const target = e.target as Node;
      if (bubbleRef.current?.contains(target) || anchorRef.current?.contains(target)) return;
      onClose();
    };
    // Scrolling the page moves the anchor out from under the bubble; closing
    // is less jarring than chasing it.
    const onScroll = () => onClose();
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointer);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointer);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [open, onClose, anchorRef]);

  if (!open) return null;

  return createPortal(
    <div ref={bubbleRef} role="dialog" aria-label={`How ${label} was computed`}
         style={{
           position: 'fixed',
           top: position?.top ?? -9999,
           left: position?.left ?? -9999,
           width: position?.width ?? MAX_WIDTH,
           maxHeight: '70vh',
           overflowY: 'auto',
           overflowX: 'hidden',
           background: 'var(--surface-card)',
           border: '0.5px solid var(--border-strong)',
           borderRadius: 'var(--radius-card)',
           boxShadow: '0 10px 30px rgba(20, 20, 20, 0.14)',
           padding: 'var(--pad-card)',
           zIndex: 100,
           visibility: position ? 'visible' : 'hidden',
         }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 8 }}>
        <p style={{ fontSize: 'var(--text-md)', fontWeight: 500 }}>{label}</p>
        <button onClick={() => { onClose(); anchorRef.current?.focus(); }} className="focusable"
                aria-label="Close" style={{
                  marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer',
                  color: 'var(--text-muted)', fontSize: 'var(--text-md)', lineHeight: 1, padding: 2,
                }}>
          ✕
        </button>
      </div>
      {children}
    </div>,
    document.body,
  );
}
