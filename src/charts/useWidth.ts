import { useEffect, useRef, useState } from 'react';

/**
 * Measure the container so the SVG viewBox matches its rendered width.
 *
 * Without this an SVG with a fixed viewBox scales to fit, and every font size
 * in it scales too — an 11px axis tick specified by the design system renders
 * at 28px in a full-width tile. Type sizes have to survive the layout, so one
 * SVG unit is pinned to one CSS pixel.
 */
export function useWidth<T extends HTMLElement>(fallback = 520) {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(fallback);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      const next = entry?.contentRect.width ?? 0;
      if (next > 0) setWidth(Math.round(next));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return { ref, width };
}
