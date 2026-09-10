import type { Answer } from '../../shared/types.ts';
import type { QueryIR } from '../../shared/ir.ts';

export interface ChatTurn {
  question: string;
  answer: Answer | null;
  error?: string;
  pending?: boolean;
}

export interface Conversation {
  id: string;
  title: string;
  turns: ChatTurn[];
  createdAt: number;
}

export interface TileContext {
  label: string;
  ir: QueryIR;
}

export const CHAT_KEY = 'spaceship.conversations.v1';
export const PIN_KEY = 'spaceship.pinned.v1';

export function newConversation(): Conversation {
  return { id: `c_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`, title: 'New question', turns: [], createdAt: Date.now() };
}

/** The first question becomes the title. Nothing to name before that. */
export function titleFor(conversation: Conversation): string {
  const first = conversation.turns[0]?.question;
  if (!first) return 'New question';
  return first.length > 42 ? `${first.slice(0, 42)}…` : first;
}

export function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function save(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage can be full or blocked. Losing history is not worth an error.
  }
}
