import { useCallback, useEffect, useState } from 'react';
import type { Answer, LayerCatalog } from '../../shared/types.ts';
import type { Filter, QueryIR } from '../../shared/ir.ts';
import { api } from '../lib/api.ts';
import { CARDS, CHARTS, BREAKDOWN_DIMENSIONS } from '../lib/tiles.ts';
import { FilterBar } from '../components/FilterBar.tsx';
import { KpiCard } from '../components/KpiCard.tsx';
import { TileFrame } from '../components/TileFrame.tsx';
import { ChatDrawer, type ChatTurn } from '../components/ChatDrawer.tsx';
import { CompositionBar, Empty } from '../charts/CompositionBar.tsx';
import { ColumnChart } from '../charts/ColumnChart.tsx';
import { Histogram } from '../charts/Histogram.tsx';
import { BreakdownScatter, type ScatterPoint } from '../charts/BreakdownScatter.tsx';

interface Pinned { id: string; title: string; ir: QueryIR }

const PIN_KEY = 'spaceship.pinned.v1';

function loadPins(): Pinned[] {
  try { return JSON.parse(localStorage.getItem(PIN_KEY) ?? '[]') as Pinned[]; } catch { return []; }
}

export function Overview({ catalog }: { catalog: LayerCatalog | null }) {
  const [filters, setFilters] = useState<Filter[]>([]);
  const [period, setPeriod] = useState('all');
  const [dimension, setDimension] = useState<string>('carrier');
  const [tiles, setTiles] = useState<Record<string, Answer>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [context, setContext] = useState<{ label: string; ir: QueryIR } | null>(null);
  const [pins, setPins] = useState<Pinned[]>(loadPins);
  const [pinAnswers, setPinAnswers] = useState<Record<string, Answer>>({});

  const load = useCallback(async (refresh?: string) => {
    setError(null);
    try {
      const next = await api.tiles({ filters, period, refresh: refresh ?? null, breakdownDimension: dimension });
      setTiles(next);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [filters, period, dimension]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    localStorage.setItem(PIN_KEY, JSON.stringify(pins));
    void Promise.all(pins.map(async (p) => [p.id, await api.run(p.ir)] as const))
      .then((entries) => setPinAnswers(Object.fromEntries(entries)))
      .catch(() => undefined);
  }, [pins]);

  const addToChat = (label: string, ir: QueryIR) => setContext({ label, ir });

  const pinTurn = (turn: ChatTurn) => {
    if (!turn.answer?.explain) return;
    const ir = turn.answer.explain.ir;
    setPins((p) => [...p, { id: `pin_${Date.now()}`, title: turn.question, ir }]);
  };

  const breakdown = tiles['chart_breakdown'];
  const scatterPoints: ScatterPoint[] = (breakdown?.data?.rows ?? []).map((r) => ({
    key: String(r[dimension] ?? ''),
    share: 0,
    rate: Number(r['on_time_rate'] ?? 0),
    transit: Number(r['avg_transit_days'] ?? 0),
    p90: Number(r['p90_transit_days'] ?? 0),
    n: Number(r['completed_count'] ?? 0),
  }));
  const totalVolume = (breakdown?.data?.rows ?? []).reduce((s, r) => s + Number(r['order_count'] ?? 0), 0);
  (breakdown?.data?.rows ?? []).forEach((r, i) => {
    if (scatterPoints[i]) scatterPoints[i]!.share = totalVolume ? Number(r['order_count'] ?? 0) / totalVolume : 0;
  });
  const overallOnTime = Number(tiles['card_on_time_rate']?.data?.rows[0]?.['on_time_rate'] ?? 0);
  const dimensionMeta = catalog?.dimensions.find((d) => d.name === dimension);

  return (
    <div>
      <FilterBar catalog={catalog} filters={filters} period={period}
                 onChange={(next) => { setFilters(next.filters); setPeriod(next.period); }} />

      {error && (
        <div className="card" style={{ padding: 12, marginBottom: 10, color: 'var(--amber-text)', background: 'var(--amber-tint)' }}>
          {error}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(148px, 1fr))', gap: 9, marginBottom: 10 }}>
        {CARDS.map((card) => (
          <KpiCard key={card.id} title={card.title} answer={tiles[card.id] ?? null}
                   metric={card.metric} contextMetric={card.contextMetric} note={card.note}
                   catalog={catalog}
                   onRefresh={() => void load(card.id)}
                   onAddToChat={() => tiles[card.id]?.explain && addToChat(card.title, tiles[card.id]!.explain!.ir)} />
        ))}
      </div>

      <div style={{ marginBottom: 10 }}>
        <Tile id="chart_composition" tiles={tiles} load={load} addToChat={addToChat}>
          {(a) => <CompositionBar rows={a.data?.rows ?? []} />}
        </Tile>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 10, marginBottom: 10 }}>
        <Tile id="chart_volume" tiles={tiles} load={load} addToChat={addToChat}>
          {(a) => <ColumnChart rows={a.data?.rows ?? []} valueKey="order_count" format="integer"
                               partialLast={a.explain?.time?.partial_period} />}
        </Tile>
        <Tile id="chart_transit" tiles={tiles} load={load} addToChat={addToChat}>
          {(a) => <Histogram rows={a.data?.rows ?? []} tailThreshold={catalog?.parameters.tail_threshold_days ?? 8} />}
        </Tile>
      </div>

      <div style={{ marginBottom: 10 }}>
        <TileFrame
          title="Breakdown"
          subtitle={CHARTS.find((c) => c.id === 'chart_breakdown')?.subtitle}
          answer={breakdown ?? null}
          note={breakdown?.sufficiency?.coverage_caption ?? undefined}
          onRefresh={() => void load('chart_breakdown')}
          onAddToChat={() => breakdown?.explain && addToChat(`Breakdown by ${dimension}`, breakdown.explain.ir)}
          actions={
            <div style={{ display: 'flex', gap: 2, marginRight: 4 }}>
              {BREAKDOWN_DIMENSIONS.map((d) => (
                <button key={d} onClick={() => setDimension(d)} className="focusable"
                        style={{ fontSize: 11, padding: '3px 8px', borderRadius: 'var(--radius-pill)', cursor: 'pointer',
                                 border: '0.5px solid ' + (dimension === d ? 'var(--border-strong)' : 'transparent'),
                                 background: dimension === d ? 'var(--surface-inset)' : 'transparent',
                                 color: dimension === d ? 'var(--text-primary)' : 'var(--text-muted)' }}>
                  {catalog?.dimensions.find((x) => x.name === d)?.label ?? d}
                </button>
              ))}
            </div>
          }>
          <p style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 6 }}>
            Darker points are slower. Hollow points fall below the minimum sample
            {dimensionMeta?.min_group_size ? ` of ${dimensionMeta.min_group_size}` : ''}.
          </p>
          {breakdown ? (
            <BreakdownScatter points={scatterPoints} target={overallOnTime}
                              volumeThresholdPct={catalog?.parameters.volume_threshold_pct[dimension]
                                ?? catalog?.parameters.volume_threshold_pct['default'] ?? 10}
                              minGroupSize={dimensionMeta?.min_group_size ?? null}
                              dimensionLabel={dimensionMeta?.label ?? dimension} />
          ) : <Empty message={loading ? 'Loading…' : 'No data'} />}
        </TileFrame>
      </div>

      {pins.length > 0 && (
        <div style={{ display: 'grid', gap: 10, marginBottom: 10 }}>
          <h2 style={{ fontSize: 11, color: 'var(--text-muted)' }}>Pinned from chat</h2>
          {pins.map((pin) => (
            <TileFrame key={pin.id} title={pin.title} answer={pinAnswers[pin.id] ?? null}
                       pinned onPin={() => setPins((p) => p.filter((x) => x.id !== pin.id))}
                       onRefresh={() => void api.run(pin.ir, true).then((a) => setPinAnswers((s) => ({ ...s, [pin.id]: a })))}>
              <p style={{ fontSize: 12 }}>{pinAnswers[pin.id]?.text ?? 'Re-running the saved plan…'}</p>
            </TileFrame>
          ))}
        </div>
      )}

      <ChatDrawer catalog={catalog} context={context} onClearContext={() => setContext(null)} onPin={pinTurn} />
    </div>
  );
}

function Tile({
  id, tiles, load, addToChat, children,
}: {
  id: string;
  tiles: Record<string, Answer>;
  load: (refresh?: string) => void;
  addToChat: (label: string, ir: QueryIR) => void;
  children: (answer: Answer) => React.ReactNode;
}) {
  const meta = CHARTS.find((c) => c.id === id)!;
  const answer = tiles[id];
  return (
    <TileFrame title={meta.title} subtitle={meta.subtitle} answer={answer ?? null} note={meta.note}
               onRefresh={() => load(id)}
               onAddToChat={() => answer?.explain && addToChat(meta.title, answer.explain.ir)}>
      {answer ? children(answer) : <Empty message="Loading…" />}
    </TileFrame>
  );
}
