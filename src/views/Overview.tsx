import { useCallback, useEffect, useRef, useState } from 'react';
import type { Answer, LayerCatalog } from '../../shared/types.ts';
import type { Filter, QueryIR } from '../../shared/ir.ts';
import { api } from '../lib/api.ts';
import { CARDS, CHARTS, BREAKDOWN_DIMENSIONS } from '../lib/tiles.ts';
import { FilterBar } from '../components/FilterBar.tsx';
import { KpiCard } from '../components/KpiCard.tsx';
import { TileFrame } from '../components/TileFrame.tsx';
import { CompositionBar, Empty } from '../charts/CompositionBar.tsx';
import { ColumnChart } from '../charts/ColumnChart.tsx';
import { Histogram } from '../charts/Histogram.tsx';
import { BreakdownScatter, type ScatterPoint } from '../charts/BreakdownScatter.tsx';

export function Overview({
  catalog, onAddToChat,
}: {
  catalog: LayerCatalog | null;
  onAddToChat: (label: string, ir: QueryIR) => void;
}) {
  const [filters, setFilters] = useState<Filter[]>([]);
  const [period, setPeriod] = useState('all');
  const [dimension, setDimension] = useState<string>('carrier');
  const [tiles, setTiles] = useState<Record<string, Answer>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAllGroups, setShowAllGroups] = useState(false);

  // Switching the breakdown dimension quickly fires overlapping requests, and
  // without sequencing an earlier response can land after a later one — the
  // tiles would then hold rows for a dimension other than the one the switcher
  // shows, and the scatter would label its points from a different query than
  // it drew them from. Only the newest request may write.
  const latestRequest = useRef(0);

  const load = useCallback(async (refresh?: string) => {
    const request = ++latestRequest.current;
    setError(null);
    try {
      const next = await api.tiles({ filters, period, refresh: refresh ?? null, breakdownDimension: dimension });
      if (request !== latestRequest.current) return;
      setTiles(next);
    } catch (e) {
      if (request !== latestRequest.current) return;
      setError((e as Error).message);
    } finally {
      if (request === latestRequest.current) setLoading(false);
    }
  }, [filters, period, dimension]);

  useEffect(() => { void load(); }, [load]);


  const breakdown = tiles['chart_breakdown'];
  const breakdownRows = breakdown?.data?.rows ?? [];

  // Read the dimension from the answer, not from local state.
  //
  // Clicking the switcher changes `dimension` immediately, while the rows for
  // it are still in flight — so for one render the old rows were being keyed
  // by the new dimension name, every key came out empty, and React could not
  // tell 30 <g key=""> elements apart. Marks accumulated instead of being
  // replaced: 205 circles for 30 clients, with labels from whichever dimension
  // had been selected before.
  //
  // The plan that produced these rows names its own dimension, so rows and
  // keys cannot disagree.
  const renderedDimension = breakdown?.explain?.ir.dimensions[0] ?? dimension;
  const totalVolume = breakdownRows.reduce((s, r) => s + Number(r['order_count'] ?? 0), 0);
  const scatterPoints: ScatterPoint[] = breakdownRows
    .map((r) => ({
      key: String(r[renderedDimension] ?? ''),
      share: totalVolume ? Number(r['order_count'] ?? 0) / totalVolume : 0,
      rate: Number(r['on_time_rate'] ?? 0),
      transit: Number(r['avg_transit_days'] ?? 0),
      p95: Number(r['p95_transit_days'] ?? 0),
      n: Number(r['completed_count'] ?? 0),
    }))
    // A group with no key cannot be labelled, identified in a tooltip, or
    // given a stable React key. Belt to the braces above.
    .filter((p) => p.key !== '');
  const overallOnTime = Number(tiles['card_on_time_rate']?.data?.rows[0]?.['on_time_rate'] ?? 0);
  const dimensionMeta = catalog?.dimensions.find((d) => d.name === renderedDimension);

  // Above this many groups, a scatter of every group stops being a chart.
  // Carrier, region, warehouse and category all sit under it and are unchanged.
  const DENSE_ABOVE = 15;
  const floor = dimensionMeta?.min_group_size ?? null;
  const belowFloor = floor === null ? [] : scatterPoints.filter((p) => p.n < floor);
  const clearing = scatterPoints.length - belowFloor.length;

  // Hide the groups whose rates are sampling noise, rather than drawing 47
  // marks in a 3-point-wide band where 37 overlap each other. The sufficiency
  // guard already concludes those rates are not reportable; until now the
  // chart plotted them anyway and contradicted its own caption.
  //
  // Never hide everything: if no group clears the floor there is nothing left
  // to draw, and the honest output is all of them plus the warning.
  const dense = scatterPoints.length > DENSE_ABOVE && belowFloor.length > 0 && clearing > 0;
  const hiding = dense && !showAllGroups;
  const visiblePoints = hiding ? scatterPoints.filter((p) => floor === null || p.n >= floor) : scatterPoints;

  return (
    <div>
      <FilterBar catalog={catalog} filters={filters} period={period}
                 onChange={(next) => { setFilters(next.filters); setPeriod(next.period); }} />

      {error && (
        <div className="card" style={{ padding: 14, marginBottom: 12, color: 'var(--amber-text)', background: 'var(--amber-tint)' }}>
          {error}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(178px, 1fr))', gap: 11, marginBottom: 12 }}>
        {CARDS.map((card) => (
          <KpiCard key={card.id} title={card.title} answer={tiles[card.id] ?? null}
                   metric={card.metric} contextMetric={card.contextMetric} note={card.note}
                   catalog={catalog}
                   onRefresh={() => void load(card.id)}
                   onAddToChat={() => tiles[card.id]?.explain && onAddToChat(card.title, tiles[card.id]!.explain!.ir)} />
        ))}
      </div>

      <div style={{ marginBottom: 12 }}>
        <Tile id="chart_composition" tiles={tiles} load={load} addToChat={onAddToChat}>
          {(a) => <CompositionBar rows={a.data?.rows ?? []} />}
        </Tile>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 12, marginBottom: 12 }}>
        <Tile id="chart_volume" tiles={tiles} load={load} addToChat={onAddToChat}>
          {(a) => <ColumnChart rows={a.data?.rows ?? []} valueKey="order_count" format="integer"
                               partialLast={a.explain?.time?.partial_period} />}
        </Tile>
        <Tile id="chart_transit" tiles={tiles} load={load} addToChat={onAddToChat}>
          {(a) => <Histogram rows={a.data?.rows ?? []} tailThreshold={catalog?.parameters.tail_threshold_days ?? 8} />}
        </Tile>
      </div>

      <div style={{ marginBottom: 12 }}>
        <TileFrame
          title="Breakdown"
          subtitle={CHARTS.find((c) => c.id === 'chart_breakdown')?.subtitle}
          answer={breakdown ?? null}
          note={breakdown?.sufficiency?.coverage_caption ?? undefined}
          onRefresh={() => void load('chart_breakdown')}
          onAddToChat={() => breakdown?.explain && onAddToChat(`Breakdown by ${dimension}`, breakdown.explain.ir)}
          actions={
            <div style={{ display: 'flex', gap: 2, marginRight: 6, flexWrap: 'wrap' }}>
              {BREAKDOWN_DIMENSIONS.map((d) => (
                <button key={d} onClick={() => setDimension(d)} className="focusable"
                        style={{ fontSize: 'var(--text-sm)', padding: '4px 10px', borderRadius: 'var(--radius-pill)', cursor: 'pointer',
                                 border: '0.5px solid ' + (dimension === d ? 'var(--border-strong)' : 'transparent'),
                                 background: dimension === d ? 'var(--surface-inset)' : 'transparent',
                                 color: dimension === d ? 'var(--text-primary)' : 'var(--text-muted)' }}>
                  {catalog?.dimensions.find((x) => x.name === d)?.label ?? d}
                </button>
              ))}
            </div>
          }>
          <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)', marginBottom: 8 }}>
            Darker points are slower.{' '}
            {hiding
              ? `Showing the ${clearing} ${dimensionMeta?.label.toLowerCase() ?? renderedDimension} groups with at least ${floor} completed deliveries.`
              : `Hollow points fall below the minimum sample${floor ? ` of ${floor}` : ''}.`}
          </p>
          {dense && (
            <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)', marginBottom: 8,
                        display: 'flex', gap: 10, alignItems: 'baseline', flexWrap: 'wrap' }}>
              <span>
                {hiding
                  ? `${belowFloor.length} of ${scatterPoints.length} hidden — their rates rest on fewer than ${floor} deliveries each.`
                  : `${belowFloor.length} of ${scatterPoints.length} shown hollow are below the minimum sample and overlap heavily.`}
              </span>
              <button onClick={() => setShowAllGroups(!showAllGroups)} className="focusable"
                      style={{ background: 'none', border: '0.5px solid var(--border-strong)',
                               borderRadius: 'var(--radius-pill)', padding: '3px 11px', cursor: 'pointer',
                               fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                {hiding ? `Show all ${scatterPoints.length}` : `Show only the ${clearing} reportable`}
              </button>
            </p>
          )}
          {breakdown ? (
            <BreakdownScatter points={visiblePoints} target={overallOnTime}
                              volumeThresholdPct={catalog?.parameters.volume_threshold_pct[renderedDimension]
                                ?? catalog?.parameters.volume_threshold_pct['default'] ?? 10}
                              minGroupSize={dimensionMeta?.min_group_size ?? null}
                              dimensionLabel={dimensionMeta?.label ?? renderedDimension} />
          ) : <Empty message={loading ? 'Loading…' : 'No data'} />}
        </TileFrame>
      </div>

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
