import type { Layer } from '../shared/layer-types.ts';
import { isGroupable, minGroupSize } from '../shared/layer-types.ts';
import type { LayerCatalog } from '../shared/types.ts';
import type { Database } from './db.ts';
import { dataAsOf } from './time.ts';

/** Above this a dropdown is the wrong control anyway; the chat is. */
const DISTINCT_VALUE_CAP = 60;

/**
 * Values for dimensions the layer does not enumerate.
 *
 * Where the layer declares `values`, that declaration wins and this does not
 * run. That split is deliberate rather than incidental: the validator only
 * rejects an out-of-set filter value `if (dim.values)`, and the planner prompt
 * lists the same declaration — so a declared dimension must be offered exactly
 * what it declares, or the UI would offer a value the validator then refuses.
 * An undeclared dimension is not value-checked at all, so live values are safe
 * there and never go stale.
 */
async function distinctValues(layer: Layer, db: Database): Promise<Record<string, string[]>> {
  const out: Record<string, string[]> = {};
  const table = layer.datasets['orders']!.base_table;

  for (const [name, dim] of Object.entries(layer.dimensions)) {
    if (dim.values || dim.high_cardinality) continue;
    const column = dim.expr;
    // Only plain column references. A computed dimension such as lane is not
    // worth a scan for a dropdown nobody should be using at 47 entries.
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(column)) continue;
    try {
      const rows = await db.run<{ v: string | number | null }>(
        `SELECT DISTINCT ${column} AS v FROM ${table} WHERE ${column} IS NOT NULL ORDER BY v LIMIT ${DISTINCT_VALUE_CAP + 1}`,
      );
      if (rows.length > DISTINCT_VALUE_CAP) continue;
      out[name] = rows.map((r) => String(r.v));
    } catch {
      // A dropdown is not worth failing the catalog over.
    }
  }
  return out;
}

/**
 * What the SPA needs to render labels, filter chips and formats.
 *
 * The layer itself stays server-side. The browser bundle contains no metric
 * definitions, no thresholds and no glossary, which is what makes the
 * three-layer separation physical rather than conceptual.
 */
export async function buildCatalog(layer: Layer, db: Database): Promise<LayerCatalog> {
  const ds = layer.datasets['orders']!;
  const live = await distinctValues(layer, db);
  return {
    version: layer.version,
    data_as_of: dataAsOf(layer),
    timezone: layer.time_anchor.timezone,
    row_count: ds.row_count,
    coverage: {
      order_date: ds.coverage['order_date']!,
      delivery_date: ds.coverage['delivery_date']!,
    },
    metrics: Object.entries(layer.metrics).map(([name, m]) => ({
      name, label: m.label, format: m.format,
      ...(m.notes ? { notes: m.notes.trim() } : {}),
      ...(m.point_in_time === false ? { point_in_time: false } : {}),
    })),
    dimensions: Object.entries(layer.dimensions).map(([name, d]) => ({
      name, label: d.label, type: d.type, groupable: isGroupable(d),
      ...(d.values ?? live[name] ? { values: d.values ?? live[name] } : {}),
      ...(d.approx_cardinality ? { approx_cardinality: d.approx_cardinality } : {}),
      min_group_size: minGroupSize(layer, name),
      ...(d.notes ? { notes: d.notes.trim() } : {}),
    })),
    time_dimensions: Object.entries(layer.time_dimensions).map(([name, t]) => ({
      name, label: t.label,
      ...(t.nullable ? { nullable: true } : {}),
      ...(t.notes ? { notes: t.notes.trim() } : {}),
    })),
    parameters: {
      tail_threshold_days: layer.parameters.tail_threshold_days,
      exception_counts_as_late: layer.parameters.exception_counts_as_late,
      flat_distribution_p: layer.parameters.flat_distribution_p,
      volume_threshold_pct: layer.parameters.priority_quadrant.volume_threshold_pct,
    },
  };
}
