import { useEffect, useRef, useState } from 'react';
import type { ChatTurn, Conversation, TileContext } from '../lib/chat.ts';
import { titleFor } from '../lib/chat.ts';
import { ExplainPanel } from './ExplainPanel.tsx';
import { ChevronIcon, WarnIcon } from './Icons.tsx';
import { InfoTooltip } from './InfoTooltip.tsx';

// Starter questions the layer can answer. Deliberately no refusal case: the
// unanswerable path is worth demonstrating, but not as the first thing a new
// user clicks. It stays reachable by typing, is a few-shot example in the
// planner prompt, and is covered by the golden set.
const SUGGESTIONS = [
  'Which carrier has the highest delay rate?',
  'Show delayed orders by week for the last 3 months',
  'How many orders were delivered late last month?',
  'Delay rate by region',
];

/**
 * The chat used to sit at the bottom of a long scrolling dashboard, so asking
 * about a tile meant scrolling past every chart and back. As a sidebar it sits
 * beside the thing being asked about.
 *
 * It splits the row rather than covering it: main content flexes narrower and
 * the charts, which measure their own container, re-lay out at the new width.
 */
export function ChatSidebar({
  conversations, activeId, context, busy,
  onAsk, onSelect, onNew, onDelete, onClearContext, onClose,
}: {
  conversations: Conversation[];
  activeId: string | null;
  context: TileContext | null;
  busy: boolean;
  onAsk: (question: string) => void;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
  onClearContext: () => void;
  onClose: () => void;
}) {
  const [listOpen, setListOpen] = useState(false);
  const [question, setQuestion] = useState('');
  const endRef = useRef<HTMLDivElement>(null);
  const active = conversations.find((c) => c.id === activeId) ?? null;

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [active?.turns.length, busy]);

  const submit = (text: string) => {
    if (!text.trim() || busy) return;
    setQuestion('');
    onAsk(text.trim());
  };

  return (
    <aside className="card" aria-label="Ask"
           style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, overflow: 'hidden' }}>
      <header style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '11px 14px',
                       borderBottom: '0.5px solid var(--border)' }}>
        <h2 style={{ fontSize: 'var(--text-md)', fontWeight: 500 }}>Ask</h2>
        {/* Starting a conversation is a primary action, so it sits in the
            header rather than at the bottom of a collapsed list nobody opens
            unless they already have several. */}
        <button onClick={onNew} className="focusable"
                style={{ fontSize: 'var(--text-sm)', padding: '5px 13px', cursor: 'pointer',
                         borderRadius: 'var(--radius-pill)', border: '0.5px solid var(--border-strong)',
                         background: 'var(--surface-card)', color: 'var(--text-secondary)',
                         whiteSpace: 'nowrap' }}>
          New Chat
        </button>
        <button onClick={onClose} aria-label="Close chat" className="focusable"
                style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer',
                         color: 'var(--text-muted)', fontSize: 'var(--text-md)', padding: 3 }}>✕</button>
      </header>

      {/* Conversation list, collapsed to the active title so the thread keeps
          the height. */}
      <div style={{ borderBottom: '0.5px solid var(--border)', padding: '7px 10px' }}>
        <button onClick={() => setListOpen(!listOpen)} className="focusable"
                aria-expanded={listOpen}
                style={{ display: 'flex', alignItems: 'center', gap: 7, width: '100%', background: 'none',
                         border: 'none', cursor: 'pointer', padding: '4px 4px', textAlign: 'left',
                         fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>
          <ChevronIcon open={listOpen} />
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {active ? titleFor(active) : 'No conversations'}
          </span>
          <span style={{ marginLeft: 'auto', fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }} className="tnum">
            {conversations.length}
          </span>
        </button>

        {listOpen && (
          <div style={{ display: 'grid', gap: 1, marginTop: 5, maxHeight: 190, overflowY: 'auto' }}>
            {conversations.map((c) => (
              // Two controls in one row, so the row cannot be a button — a
              // button inside a button is invalid and the delete target would
              // not be independently reachable by keyboard.
              <div key={c.id}
                   style={{ display: 'flex', alignItems: 'center', borderRadius: 7,
                            background: c.id === activeId ? 'var(--surface-inset)' : 'transparent' }}>
                <button onClick={() => { onSelect(c.id); setListOpen(false); }} className="focusable"
                        style={{ flex: 1, minWidth: 0, textAlign: 'left', padding: '6px 9px',
                                 borderRadius: 7, border: 'none', cursor: 'pointer', background: 'none',
                                 color: c.id === activeId ? 'var(--text-primary)' : 'var(--text-secondary)',
                                 fontSize: 'var(--text-sm)', overflow: 'hidden', textOverflow: 'ellipsis',
                                 whiteSpace: 'nowrap' }}>
                  {titleFor(c)}
                </button>
                <button onClick={() => onDelete(c.id)} className="focusable"
                        aria-label={`Delete conversation: ${titleFor(c)}`}
                        title="Delete conversation"
                        style={{ flex: 'none', background: 'none', border: 'none', cursor: 'pointer',
                                 padding: '5px 9px', borderRadius: 7, color: 'var(--text-muted)',
                                 fontSize: 'var(--text-sm)', lineHeight: 1 }}>
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {context && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 'var(--text-sm)',
                      background: 'var(--surface-inset)', padding: '7px 14px' }}>
          <span style={{ color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            Context: {context.label}
          </span>
          <button onClick={onClearContext} className="focusable"
                  style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer',
                           color: 'var(--text-muted)', fontSize: 'var(--text-sm)' }}>Remove</button>
        </div>
      )}

      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '12px 14px', display: 'grid', gap: 14, alignContent: 'start' }}>
        {(!active || active.turns.length === 0) && (
          <div style={{ display: 'grid', gap: 6 }}>
            <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)' }}>Try one of these:</p>
            {SUGGESTIONS.map((s) => (
              <button key={s} onClick={() => submit(s)} className="focusable"
                      style={{ fontSize: 'var(--text-sm)', padding: '7px 11px', borderRadius: 9, textAlign: 'left',
                               border: '0.5px solid var(--border-strong)', background: 'var(--surface-card)',
                               color: 'var(--text-secondary)', cursor: 'pointer' }}>
                {s}
              </button>
            ))}
          </div>
        )}

        {active?.turns.map((turn, i) => <Turn key={i} turn={turn} />)}
        <div ref={endRef} />
      </div>

      <form onSubmit={(e) => { e.preventDefault(); submit(question); }}
            style={{ display: 'flex', gap: 7, padding: '11px 14px', borderTop: '0.5px solid var(--border)' }}>
        <input value={question} onChange={(e) => setQuestion(e.target.value)}
               placeholder={busy ? 'Planning…' : 'Ask about this data'}
               disabled={busy} className="focusable"
               style={{ flex: 1, minWidth: 0, fontSize: 'var(--text-md)', padding: '9px 12px',
                        borderRadius: 'var(--radius-pill)', border: '0.5px solid var(--border-strong)',
                        background: 'var(--surface-card)' }} />
        <button type="submit" disabled={busy || !question.trim()} className="focusable"
                style={{ fontSize: 'var(--text-md)', padding: '9px 16px', borderRadius: 'var(--radius-pill)', border: 'none',
                         background: busy || !question.trim() ? 'var(--surface-inset)' : 'var(--brand-soft)',
                         color: 'var(--text-primary)', cursor: busy ? 'wait' : 'pointer' }}>
          Ask
        </button>
      </form>
    </aside>
  );
}

function Turn({ turn }: { turn: ChatTurn }) {
  const answer = turn.answer;
  return (
    <div style={{ minWidth: 0 }}>
      <p style={{ fontSize: 'var(--text-md)', fontWeight: 500, marginBottom: 7 }}>{turn.question}</p>

      {turn.pending && <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)' }}>Planning the query…</p>}
      {turn.error && <Notice tone="problem">{turn.error}</Notice>}
      {answer?.status === 'clarify' && <Notice tone="open">{answer.message}</Notice>}
      {(answer?.status === 'unanswerable' || answer?.status === 'invalid') && <Notice tone="problem">{answer.message}</Notice>}

      {answer?.status === 'ok' && (
        <div style={{ background: 'var(--surface-inset)', borderRadius: 9, padding: '11px 13px', minWidth: 0 }}>
          <p style={{ fontSize: 'var(--text-md)', lineHeight: 1.55 }}>{answer.text}</p>
          <div style={{ display: 'flex', gap: 6, marginTop: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <InfoTooltip label="Verified" width={300}
                         text="Every figure here came from SQL the compiler built out of the semantic layer's metric definitions, validated before it ran. The model chose which metrics to ask for; it never produced a number. Open 'How was this computed?' for the plan, the SQL and the rows.">
              <span className="pill" style={{ background: 'var(--green-tint)', color: 'var(--green-text)', cursor: 'help' }}>
                Verified
              </span>
            </InfoTooltip>
          </div>
          {answer.sufficiency?.coverage_caption && (
            <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)', marginTop: 7 }}>
              {answer.sufficiency.coverage_caption}
            </p>
          )}
          <details style={{ marginTop: 9 }}>
            <summary style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', cursor: 'pointer' }}>
              How was this computed?
            </summary>
            <div style={{ marginTop: 9 }}><ExplainPanel answer={answer} /></div>
          </details>
        </div>
      )}
    </div>
  );
}

function Notice({ tone, children }: { tone: 'problem' | 'open'; children: React.ReactNode }) {
  const bg = tone === 'problem' ? 'var(--amber-tint)' : 'var(--teal-tint)';
  const fg = tone === 'problem' ? 'var(--amber-text)' : 'var(--teal-text)';
  return (
    <div style={{ display: 'flex', gap: 8, fontSize: 'var(--text-sm)', background: bg, color: fg,
                  padding: '9px 11px', borderRadius: 9 }}>
      <span style={{ flex: 'none', marginTop: 2 }}><WarnIcon /></span>
      <span style={{ minWidth: 0 }}>{children}</span>
    </div>
  );
}
