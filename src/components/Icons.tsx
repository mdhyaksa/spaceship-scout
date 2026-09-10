/** Six inline icons instead of an icon font. */
const base = { width: 17, height: 17, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };

export const RefreshIcon = () => (<svg {...base}><path d="M20 11A8.1 8.1 0 0 0 4.5 9M4 5v4h4" /><path d="M4 13a8.1 8.1 0 0 0 15.5 2m.5 4v-4h-4" /></svg>);
export const PinIcon = () => (<svg {...base}><path d="M9 4v6l-2 4v2h10v-2l-2-4V4M12 16v5M8 4h8" /></svg>);
export const ChatIcon = () => (<svg {...base}><path d="M3 20l1.3-3.9A9 9 0 1 1 7.9 19.7L3 20" /></svg>);
export const InfoIcon = () => (<svg {...base}><circle cx="12" cy="12" r="9" /><path d="M12 8h.01M11 12h1v4h1" /></svg>);
export const ChevronIcon = ({ open }: { open?: boolean }) => (
  <svg {...base} style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .15s' }}><path d="M6 9l6 6 6-6" /></svg>
);
export const WarnIcon = () => (<svg {...base}><path d="M12 9v4M12 17h.01M10.3 3.9 2 18a2 2 0 0 0 1.7 3h16.6a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" /></svg>);
