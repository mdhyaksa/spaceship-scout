/**
 * IR -> SQL. Deterministic, no model involved.
 *
 * Three rules carry most of the correctness:
 *
 *  1. A metric's own filter compiles to FILTER (WHERE ...) INSIDE the
 *     aggregate, never to a WHERE clause. delayed_count and completed_count
 *     appear in the same query constantly, and a WHERE would corrupt the
 *     sibling. This is the single most important rule in the compiler.
 *  2. Ratio metrics are computed at the final grain as numerator / denominator,
 *     never as an average of per-row ratios.
 *  3. Every ratio drags its denominator into the result set whether or not the
 *     caller asked for it, because no rate may be displayed without its n.
 *
 * Query filter values are always bound parameters. Metric filters come from
 * the version-controlled semantic layer and are inlined.
 */
import type { Layer, Metric } from '../shared/layer-types.ts';
import type { QueryIR } from '../shared/ir.ts';
import { LIMIT_DEFAULT } from './validate.ts';
import { applyPortableFunctions, sqlite, type Dialect, type Grain } from './dialect.ts';
import { resolveTime, type ResolvedRange } from './time.ts';

export interface Column {
  key: string;
  label: string;
  type: 'categorical' | 'ordinal' | 'time' | 'integer' | 'percent' | 'days_1dp' | 'currency_usd';
}

export interface CompiledQuery {
  sql: string;
  params: string[];
  columns: Column[];
  /** Metrics actually selected, including denominators pulled in by rule 3. */
  selectedMetrics: string[];
  /** For a ratio metric, the column holding its n. */
  denominatorOf: Record<string, string>;
  resolvedRange: ResolvedRange | null;
}

const PERIOD = 'period';

export function compile(ir: QueryIR, layer: Layer, dialect: Dialect = sqlite): CompiledQuery {
  const ds = layer.datasets['orders']!;
  const table = dialect.table(ds.base_table, ds.postgres_schema);
  const expr = (e: string) => applyPortableFunctions(e, dialect);

  // ---- WHERE, shared by the main query and every percentile CTE ----------
  const whereParts: string[] = [];
  const whereParams: string[] = [];
  let resolvedRange: ResolvedRange | null = null;

  for (const f of ir.filters) {
    const dim = layer.dimensions[f.field];
    const timeDim = layer.time_dimensions[f.field];
    const col = dim ? expr(dim.expr) : timeDim ? timeDim.expr : null;
    if (!col) continue;
    switch (f.op) {
      case 'is_null':
        whereParts.push(`${col} IS NULL`);
        break;
      case 'is_not_null':
        whereParts.push(`${col} IS NOT NULL`);
        break;
      case 'in':
      case 'not_in': {
        const holes = f.value.map(() => '?').join(', ');
        whereParts.push(`${col} ${f.op === 'in' ? 'IN' : 'NOT IN'} (${holes})`);
        whereParams.push(...f.value);
        break;
      }
      case 'between':
        whereParts.push(`${col} BETWEEN ? AND ?`);
        whereParams.push(f.value[0]!, f.value[1]!);
        break;
      default: {
        const ops = { eq: '=', neq: '<>', gt: '>', gte: '>=', lt: '<', lte: '<=' } as const;
        whereParts.push(`${col} ${ops[f.op as keyof typeof ops]} ?`);
        whereParams.push(f.value[0]!);
      }
    }
  }

  if (ir.time) {
    const timeDim = layer.time_dimensions[ir.time.field];
    if (timeDim) {
      resolvedRange = resolveTime(ir.time, layer);
      whereParts.push(`${timeDim.expr} BETWEEN ? AND ?`);
      whereParams.push(resolvedRange.start, resolvedRange.end);
      // Grouping or filtering by delivery_date silently drops the 30 orders
      // that have none. The warning is raised in the explain block; the SQL
      // simply reflects it.
      if (timeDim.nullable) whereParts.push(`${timeDim.expr} IS NOT NULL`);
    }
  }

  const whereSql = whereParts.length ? `WHERE ${whereParts.join('\n    AND ')}` : '';

  // ---- Group keys --------------------------------------------------------
  const grain = ir.time?.grain ?? null;
  const groupKeys: { alias: string; sql: string }[] = ir.dimensions.map((name) => ({
    alias: name,
    sql: expr(layer.dimensions[name]!.expr),
  }));
  if (grain && ir.time) {
    const timeDim = layer.time_dimensions[ir.time.field]!;
    groupKeys.push({ alias: PERIOD, sql: dialect.truncate(timeDim.expr, grain as Grain) });
  }

  // ---- Metric expansion (rule 3) ----------------------------------------
  const selected: string[] = [];
  const denominatorOf: Record<string, string> = {};
  for (const name of ir.metrics) {
    if (!selected.includes(name)) selected.push(name);
    const metric = layer.metrics[name];
    if (metric?.agg === 'ratio') {
      denominatorOf[name] = metric.denominator;
      if (!selected.includes(metric.denominator)) selected.push(metric.denominator);
    }
  }

  const scalarMetrics = selected.filter((m) => layer.metrics[m]!.agg !== 'percentile_disc');
  const percentileMetrics = selected.filter((m) => layer.metrics[m]!.agg === 'percentile_disc');

  /** One aggregate expression, with its own filter inside FILTER (WHERE ...). */
  function aggregateSql(name: string): string {
    const metric = layer.metrics[name]! as Metric;
    if (metric.agg === 'ratio') {
      const num = aggregateSql(metric.numerator);
      const den = aggregateSql(metric.denominator);
      return `${dialect.toReal(num)} / NULLIF(${den}, 0)`;
    }
    if (metric.agg === 'percentile_disc') {
      throw new Error('percentile metrics compile through their own CTE');
    }
    const fn = metric.agg === 'count_distinct' ? 'COUNT(DISTINCT %s)' : `${metric.agg.toUpperCase()}(%s)`;
    const body = fn.replace('%s', expr(metric.expr));
    return metric.filter ? `${body} FILTER (WHERE ${expr(metric.filter)})` : body;
  }

  // ---- Percentile CTEs ---------------------------------------------------
  // SQLite has no PERCENTILE_DISC. CUME_DIST is (rows <= current) / n, which is
  // exactly the definition PERCENTILE_DISC uses. PERCENT_RANK is not - it is
  // (rank - 1) / (n - 1) and overshoots on 4 of 9 carriers in this dataset.
  const ctes: string[] = [];
  const cteParams: string[] = [];
  for (const name of percentileMetrics) {
    const metric = layer.metrics[name]!;
    if (metric.agg !== 'percentile_disc') continue;
    const keySelect = groupKeys.map((k) => `${k.sql} AS ${k.alias}`).join(',\n           ');
    const keyNames = groupKeys.map((k) => k.alias).join(', ');
    // Partition by the aliases, not the source expressions: the window runs
    // over src_<metric>, which projects only the aliases. A dimension whose
    // alias happens to equal its column (carrier, region) would work either
    // way, which is exactly why this has to be right for the ones that do not
    // (lane is origin_city || ' -> ' || destination_city).
    const partition = groupKeys.length ? `PARTITION BY ${groupKeys.map((k) => k.alias).join(', ')} ` : '';
    const metricWhere = [whereSql.replace(/^WHERE /, ''), metric.filter ? expr(metric.filter) : '']
      .filter(Boolean)
      .join('\n         AND ');

    ctes.push(
      `src_${name} AS (\n` +
        `    SELECT ${keySelect}${groupKeys.length ? ',\n           ' : ''}${expr(metric.expr)} AS v\n` +
        `    FROM ${table}\n` +
        (metricWhere ? `    WHERE ${metricWhere}\n` : '') +
        `  ),\n` +
        `  cd_${name} AS (\n` +
        `    SELECT ${keyNames}${keyNames ? ', ' : ''}v,\n` +
        `           CUME_DIST() OVER (${partition}ORDER BY v) AS cd\n` +
        `    FROM src_${name}\n` +
        `  ),\n` +
        `  ${name} AS (\n` +
        `    SELECT ${keyNames}${keyNames ? ', ' : ''}MIN(v) AS ${name}\n` +
        `    FROM cd_${name}\n` +
        `    WHERE cd >= ${metric.percentile}\n` +
        (keyNames ? `    GROUP BY ${keyNames}\n` : '') +
        `  )`,
    );
    cteParams.push(...whereParams);
  }

  // ---- Main aggregate ----------------------------------------------------
  const selectParts = [
    ...groupKeys.map((k) => `${k.sql} AS ${k.alias}`),
    ...scalarMetrics.map((m) => `${aggregateSql(m)} AS ${m}`),
  ];

  const groupBy = groupKeys.length ? `\n  GROUP BY ${groupKeys.map((k) => k.sql).join(', ')}` : '';

  let mainSql =
    `SELECT\n    ${selectParts.join(',\n    ')}\n  FROM ${table}` +
    (whereSql ? `\n  ${whereSql}` : '') +
    groupBy;

  const params = [...cteParams, ...whereParams];

  // ---- Stitch percentile results back on --------------------------------
  let sql: string;
  if (percentileMetrics.length === 0) {
    sql = mainSql;
  } else {
    const joins = percentileMetrics
      .map((name) =>
        groupKeys.length
          ? `LEFT JOIN ${name} ON ${groupKeys.map((k) => `base.${k.alias} IS ${name}.${k.alias}`).join(' AND ')}`
          : `CROSS JOIN ${name}`,
      )
      .join('\n  ');
    const cols = [
      ...groupKeys.map((k) => `base.${k.alias}`),
      ...scalarMetrics.map((m) => `base.${m}`),
      ...percentileMetrics.map((m) => `${m}.${m}`),
    ];
    sql =
      `WITH ${ctes.join(',\n  ')}\n` +
      `SELECT ${cols.join(', ')}\n` +
      `FROM (\n  ${mainSql.split('\n').join('\n  ')}\n) AS base\n  ${joins}`;
  }

  // ---- ORDER BY / LIMIT --------------------------------------------------
  const orderable = new Set([...selected, ...ir.dimensions, PERIOD]);
  const sorts = ir.sort.filter((s) => orderable.has(s.by));
  if (sorts.length) {
    sql += `\nORDER BY ${sorts.map((s) => `${s.by} ${s.dir.toUpperCase()}`).join(', ')}`;
  } else if (grain) {
    sql += `\nORDER BY ${PERIOD} ASC`;
  }
  sql += `\nLIMIT ${ir.limit ?? LIMIT_DEFAULT}`;

  // ---- Column metadata ---------------------------------------------------
  const columns: Column[] = [
    ...ir.dimensions.map((name) => ({
      key: name,
      label: layer.dimensions[name]!.label,
      type: (layer.dimensions[name]!.type === 'ordinal' ? 'ordinal' : 'categorical') as
        | 'categorical'
        | 'ordinal',
    })),
    ...(grain ? [{ key: PERIOD, label: 'Period', type: 'time' as const }] : []),
    ...selected.map((name) => ({
      key: name,
      label: layer.metrics[name]!.label,
      type: layer.metrics[name]!.format,
    })),
  ];

  return { sql, params, columns, selectedMetrics: selected, denominatorOf, resolvedRange };
}
