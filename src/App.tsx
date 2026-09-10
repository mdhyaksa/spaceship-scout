import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { LayerCatalog } from '../shared/types.ts';
import type { QueryIR } from '../shared/ir.ts';
import { api } from './lib/api.ts';
import type { View } from './lib/views.ts';
import {
  CHAT_KEY, load, newConversation, save, titleFor,
  type ChatTurn, type Conversation, type TileContext,
} from './lib/chat.ts';
import { TopBar } from './components/TopBar.tsx';
import { ChatSidebar } from './components/ChatSidebar.tsx';
import { Overview } from './views/Overview.tsx';
import { Coverage } from './views/Coverage.tsx';

// Recharts is only needed for the forecast band, and it is most of the bundle.
// Everything else draws in hand-rolled SVG, so it should not be paid for on
// the overview.
const ForecastView = lazy(() =>
  import('./views/Forecast.tsx').then((m) => ({ default: m.ForecastView })),
);

const SIDEBAR_WIDTH = 380;
/** Split only while the main column would still be usable afterwards: below
 *  this the sidebar would leave it under ~620px, which is narrower than a
 *  single chart tile wants. Overlay instead. */
const SPLIT_MIN_WIDTH = 1040;

function currentView(): View {
  const hash = window.location.hash.replace('#/', '');
  return hash === 'forecast' || hash === 'coverage' ? hash : 'overview';
}

/**
 * The app shell owns the chat and the pins.
 *
 * Both cross component boundaries: the sidebar sits beside every view, while
 * "Add to chat" and "Pin to dashboard" originate in tiles and in chat answers
 * respectively. Holding them here is what lets a tile hand its plan to the
 * chat and a chat answer land back on the dashboard, without either knowing
 * about the other.
 */
export function App() {
  const [view, setView] = useState<View>(currentView);
  const [catalog, setCatalog] = useState<LayerCatalog | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [chatOpen, setChatOpen] = useState(false);
  const [conversations, setConversations] = useState<Conversation[]>(() => load<Conversation[]>(CHAT_KEY, []));
  const [activeId, setActiveId] = useState<string | null>(() => load<Conversation[]>(CHAT_KEY, [])[0]?.id ?? null);
  const [context, setContext] = useState<TileContext | null>(null);
  const [busy, setBusy] = useState(false);

  const [wide, setWide] = useState(() => window.innerWidth >= SPLIT_MIN_WIDTH);

  // The filter bar sticks directly beneath the topbar, and the sidebar starts
  // below it. Both offsets depend on the topbar's height, which changes when
  // the nav wraps — so it is measured rather than assumed, and published as a
  // custom property the rest of the shell reads.
  const topBarRef = useRef<HTMLElement>(null);
  const shellRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const bar = topBarRef.current;
    const shell = shellRef.current;
    if (!bar || !shell) return;
    const publish = () => shell.style.setProperty('--topbar-h', `${Math.round(bar.offsetHeight)}px`);
    publish();
    const observer = new ResizeObserver(publish);
    observer.observe(bar);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    api.layer().then(setCatalog).catch((e) => setError((e as Error).message));
    const onHash = () => setView(currentView());
    const onResize = () => setWide(window.innerWidth >= SPLIT_MIN_WIDTH);
    window.addEventListener('hashchange', onHash);
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('hashchange', onHash);
      window.removeEventListener('resize', onResize);
    };
  }, []);

  useEffect(() => save(CHAT_KEY, conversations), [conversations]);

  const go = (next: View) => {
    window.location.hash = `#/${next}`;
    setView(next);
  };

  const addToChat = useCallback((label: string, ir: QueryIR) => {
    setContext({ label, ir });
    setChatOpen(true);
  }, []);

  const startConversation = useCallback(() => {
    const conversation = newConversation();
    setConversations((all) => [conversation, ...all]);
    setActiveId(conversation.id);
    return conversation.id;
  }, []);

  const ask = useCallback(async (question: string) => {
    let id = activeId;
    if (!id || !conversations.some((c) => c.id === id)) id = startConversation();

    const pending: ChatTurn = { question, answer: null, pending: true };
    setConversations((all) => all.map((c) => (c.id === id ? { ...c, turns: [...c.turns, pending] } : c)));
    setBusy(true);

    const settle = (turn: ChatTurn) =>
      setConversations((all) =>
        all.map((c) => {
          if (c.id !== id) return c;
          const turns = [...c.turns.slice(0, -1), turn];
          return { ...c, turns, title: titleFor({ ...c, turns }) };
        }),
      );

    try {
      settle({ question, answer: await api.query(question, context?.ir ?? null) });
    } catch (e) {
      settle({ question, answer: null, error: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }, [activeId, conversations, context, startConversation]);


  const sidebar = chatOpen && (
    <div style={
      wide
        ? {
            width: SIDEBAR_WIDTH, flex: 'none', alignSelf: 'flex-start',
            position: 'sticky', top: 'calc(var(--topbar-h, 56px) + 26px)',
            height: 'calc(100vh - var(--topbar-h, 56px) - 40px)',
          }
        // Below the split threshold, 380px is most of the screen — overlay
        // rather than crushing the charts into a column.
        : { position: 'fixed', inset: 'calc(var(--topbar-h, 56px) + 24px) 10px 10px 10px', zIndex: 80 }
    }>
      <ChatSidebar
        conversations={conversations}
        activeId={activeId}
        context={context}
        busy={busy}
        onAsk={ask}
        onSelect={setActiveId}
        onNew={startConversation}
        onClearContext={() => setContext(null)}
        onClose={() => setChatOpen(false)}
      />
    </div>
  );

  return (
    <div ref={shellRef} style={{ minHeight: '100%', padding: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <TopBar ref={topBarRef} view={view} onChange={go} catalog={catalog}
              chatOpen={chatOpen} onToggleChat={() => setChatOpen(!chatOpen)} />

      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', minWidth: 0 }}>
        <main style={{ flex: 1, minWidth: 0 }}>
          <h1 className="sr-only">Logistics analytics dashboard</h1>
          {error && (
            <div className="card" style={{ padding: 14, marginBottom: 12, background: 'var(--amber-tint)',
                                           color: 'var(--amber-text)', fontSize: 'var(--text-md)' }}>
              {error}
            </div>
          )}
          {view === 'overview' && (
            <Overview catalog={catalog} onAddToChat={addToChat} />
          )}
          {view === 'forecast' && (
            <Suspense fallback={<p style={{ fontSize: 'var(--text-md)', color: 'var(--text-muted)' }}>Loading the forecast view…</p>}>
              <ForecastView catalog={catalog} />
            </Suspense>
          )}
          {view === 'coverage' && <Coverage />}
        </main>
        {sidebar}
      </div>
    </div>
  );
}
