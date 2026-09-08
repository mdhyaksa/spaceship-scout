/**
 * The same IR compiles to SQLite today and Postgres later. Keeping the
 * differences in one file is what makes tech-stack.md section 11 a swap
 * rather than a rewrite - and the equivalence is verified rather than
 * assumed (see tests/compile.test.ts).
 */
import type { TIME_GRAINS } from '../shared/ir.ts';

export type Grain = (typeof TIME_GRAINS)[number];

export interface Dialect {
  name: 'sqlite' | 'postgres';
  table(base: string, schema?: string): string;
  /** Whole days between two dates. */
  dateDiff(later: string, earlier: string): string;
  /** A sortable string key for the period containing `expr`. */
  truncate(expr: string, grain: Grain): string;
  toReal(expr: string): string;
  placeholder(index: number): string;
}

export const sqlite: Dialect = {
  name: 'sqlite',
  // SQLite has no schemas; the analytics prefix is a Postgres concern.
  table: (base) => base,
  dateDiff: (a, b) => `(julianday(${a}) - julianday(${b}))`,
  truncate: (expr, grain) => {
    switch (grain) {
      case 'day':
        return `date(${expr})`;
      case 'week':
        return `strftime('%Y-W%W', ${expr})`;
      case 'month':
        return `strftime('%Y-%m', ${expr})`;
      case 'quarter':
        return `(strftime('%Y', ${expr}) || '-Q' || ((CAST(strftime('%m', ${expr}) AS INTEGER) + 2) / 3))`;
      case 'year':
        return `strftime('%Y', ${expr})`;
    }
  },
  toReal: (expr) => `CAST(${expr} AS REAL)`,
  placeholder: () => '?',
};

export const postgres: Dialect = {
  name: 'postgres',
  table: (base, schema) => (schema ? `${schema}.${base}` : base),
  dateDiff: (a, b) => `(${a} - ${b})`,
  truncate: (expr, grain) => {
    const fmt: Record<Grain, string> = {
      day: 'YYYY-MM-DD',
      week: 'IYYY-"W"IW',
      month: 'YYYY-MM',
      quarter: 'YYYY-"Q"Q',
      year: 'YYYY',
    };
    return `to_char(date_trunc('${grain}', ${expr}), '${fmt[grain]}')`;
  },
  toReal: (expr) => `(${expr})::numeric`,
  placeholder: (i) => `$${i}`,
};

/** Rewrites the one portable function the semantic layer is allowed to use.
 *  Arguments are bare column names, so a regex is sufficient and the build
 *  step rejects anything more complex. */
export function applyPortableFunctions(expr: string, dialect: Dialect): string {
  return expr.replace(
    /date_diff\(\s*([A-Za-z_][A-Za-z0-9_]*)\s*,\s*([A-Za-z_][A-Za-z0-9_]*)\s*\)/g,
    (_m, a: string, b: string) => dialect.dateDiff(a, b),
  );
}
