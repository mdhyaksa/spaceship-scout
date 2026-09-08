import { useState } from 'react';
import type { Answer, LayerCatalog } from '../../shared/types.ts';
import type { QueryIR } from '../../shared/ir.ts';
import { api } from '../lib/api.ts';
import { ExplainPanel } from './ExplainPanel.tsx';
import { ChevronIcon, WarnIcon } from './Icons.tsx';

export interface ChatTurn {
  question: string;
  answer: Answer | null;
  error?: string;
  pending?: boolean;
}

const SUGGESTIONS = [
  'Which carrier has the highest delay rate?',
  'Show delayed orders by week for the last 3 months',
  'How many orders were delivered late last month?',
  'Delay rate by region',
  'How many orders are in transit right now?',
];

export function ChatDrawer({
  catalog, context, onClearContext, onPin,
}: {
  catalog: LayerCatalog | null;
  context: { label: string; ir: QueryIR } | null;
  onClearContext: () => void;
  onPin: (turn: ChatTurn) => void;
}) {
  const [open, setOpen] = useState(true);
  const [question, setQuestion] = useState('');
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [busy, setBusy] = useState(false);

  async function ask(text: string) {
    const q = text.trim();
    if (!q || busy) return;
    setQuestion('');
    setBusy(true);
    setTurns((t) => [...t, { question: q, answer: null, pending: true }]);
    try {
      const answer = await api.query(q, context?.ir ?? null);
      setTurns((t) => t.map((turn, i) => (i === t.length - 1 ? { question: q, answer } : turn)));
    } catch (e) {
      setTurns((t) => t.map((turn, i) => (i === t.length - 1 ? { question: q, answer: null, error: (e as Error).message } : turn)));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card" style={{ padding: '10px 12px' }}>
      <header style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <h3 style={{ fontSize: 12, fontWeight: 500 }}>Ask</h3>
        {catalog && (
          <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>
            answered from {catalog.row_count} orders, never from the model's memory
          </span>
        )}
        <button onClick={() => setOpen(!open)} className="focusable"
                style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 2 }}
                aria-label={open ? 'Collapse' : 'Expand'}>
          <ChevronIcon open={open} />
        </button>
      </header>

      {open && (
        <>
          {context && (
            <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 8, fontSize: 11,
                          background: 'var(--surface-inset)', padding: '5px 9px', borderRadius: 6 }}>
              <span style={{ color: 'var(--text-secondary)' }}>Context: {context.label}</span>
              <button onClick={onClearContext} className="focusable"
                      style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 11 }}>
                Remove
              </button>
            </div>
          )}

          <div style={{ marginTop: 10, display: 'grid', gap: 12, maxHeight: 460, overflowY: 'auto' }}>
            {turns.length === 0 && (
              <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                {SUGGESTIONS.map((s) => (
                  <button key={s} onClick={() => ask(s)} className="focusable"
                          style={{ fontSize: 11, padding: '4px 10px', borderRadius: 'var(--radius-pill)',
                                   border: '0.5px solid var(--border-strong)', background: 'var(--surface-card)',
                                   color: 'var(--text-secondary)', cursor: 'pointer' }}>
                    {s}
                  </button>
                ))}
              </div>
            )}

            {turns.map((turn, i) => <Turn key={i} turn={turn} onPin={() => onPin(turn)} />)}
          </div>

          <form onSubmit={(e) => { e.preventDefault(); ask(question); }}
                style={{ marginTop: 10, display: 'flex', gap: 6 }}>
            <input value={question} onChange={(e) => setQuestion(e.target.value)}
                   placeholder={busy ? 'Planning…' : 'Ask a question about this data'}
                   disabled={busy} className="focusable"
                   style={{ flex: 1, fontSize: 12, padding: '7px 10px', borderRadius: 'var(--radius-pill)',
                            border: '0.5px solid var(--border-strong)', background: 'var(--surface-card)' }} />
            <button type="submit" disabled={busy || !question.trim()} className="focusable"
                    style={{ fontSize: 12, padding: '7px 14px', borderRadius: 'var(--radius-pill)', border: 'none',
                             background: busy || !question.trim() ? 'var(--surface-inset)' : 'var(--brand-soft)',
                             color: 'var(--text-primary)', cursor: busy ? 'wait' : 'pointer' }}>
              Ask
            </button>
          </form>
        </>
      )}
    </section>
  );
}

function Turn({ turn, onPin }: { turn: ChatTurn; onPin: () => void }) {
  const answer = turn.answer;
  return (
    <div>
      <p style={{ fontSize: 12, fontWeight: 500, marginBottom: 6 }}>{turn.question}</p>

      {turn.pending && <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>Planning the query…</p>}
      {turn.error && <Notice tone="problem">{turn.error}</Notice>}

      {answer?.status === 'clarify' && <Notice tone="open">{answer.message}</Notice>}
      {answer?.status === 'unanswerable' && <Notice tone="problem">{answer.message}</Notice>}
      {answer?.status === 'invalid' && <Notice tone="problem">{answer.message}</Notice>}

      {answer?.status === 'ok' && (
        <div style={{ background: 'var(--surface-inset)', borderRadius: 8, padding: '9px 11px' }}>
          <p style={{ fontSize: 12, lineHeight: 1.5 }}>{answer.text}</p>
          <div style={{ display: 'flex', gap: 5, marginTop: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <span className="pill" style={{ background: 'var(--green-tint)', color: 'var(--green-text)' }}>Verified</span>
            {answer.sufficiency?.coverage_caption && (
              <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{answer.sufficiency.coverage_caption}</span>
            )}
            <button onClick={onPin} className="focusable"
                    style={{ marginLeft: 'auto', fontSize: 11, background: 'none', border: '0.5px solid var(--border-strong)',
                             borderRadius: 'var(--radius-pill)', padding: '3px 10px', cursor: 'pointer', color: 'var(--text-secondary)' }}>
              Pin to dashboard
            </button>
          </div>
          <ExplainPanel answer={answer} />
        </div>
      )}
    </div>
  );
}

function Notice({ tone, children }: { tone: 'problem' | 'open'; children: React.ReactNode }) {
  const bg = tone === 'problem' ? 'var(--amber-tint)' : 'var(--teal-tint)';
  const fg = tone === 'problem' ? 'var(--amber-text)' : 'var(--teal-text)';
  return (
    <div style={{ display: 'flex', gap: 7, fontSize: 12, background: bg, color: fg, padding: '8px 10px', borderRadius: 8 }}>
      <span style={{ flex: 'none', marginTop: 1 }}><WarnIcon /></span>
      <span>{children}</span>
    </div>
  );
}
