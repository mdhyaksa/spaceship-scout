import type { Layer } from '../shared/layer-types.ts';
import { isGroupable, minGroupSize } from '../shared/layer-types.ts';
import type { LayerCatalog } from '../shared/types.ts';
import { dataAsOf } from './time.ts';

/**
 * What the SPA needs to render labels, filter chips and formats.
 *
 * The layer itself stays server-side. The browser bundle contains no metric
 * definitions, no thresholds and no glossary, which is what makes the
 * three-layer separation physical rather than conceptual.
 */
export function buildCatalog(layer: Layer): LayerCatalog {
  const ds = layer.datasets['orders']!;
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
      ...(d.values ? { values: d.values } : {}),
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
