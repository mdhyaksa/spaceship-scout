import type { Answer, CoverageRow, LayerCatalog } from '../../shared/types.ts';
import type { Filter, QueryIR } from '../../shared/ir.ts';

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as T & { error?: string };
  if (!res.ok && json && typeof json === 'object' && 'status' in (json as object)) return json;
  if (!res.ok) throw new Error(json?.error ?? `Request failed (${res.status})`);
  return json;
}

export const api = {
  layer: async (): Promise<LayerCatalog> => {
    const res = await fetch('/api/layer');
    if (!res.ok) throw new Error('Could not load the semantic layer catalog.');
    return res.json() as Promise<LayerCatalog>;
  },
  tiles: (body: { filters: Filter[]; period?: string; refresh?: string | null; breakdownDimension?: string; tiles?: string[] }) =>
    post<Record<string, Answer>>('/api/tiles', body),
  query: (question: string, context?: QueryIR | null) =>
    post<Answer>('/api/query', { question, context: context ?? null }),
  forecast: (body: Record<string, unknown>) => post<Answer>('/api/forecast', body),
  coverage: async (): Promise<{ rows: CoverageRow[]; totals: { path: string; n: number }[] }> => {
    const res = await fetch('/api/coverage');
    if (!res.ok) throw new Error('Could not load coverage.');
    return res.json();
  },
};
