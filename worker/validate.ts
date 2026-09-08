/**
 * Schema conformance is not semantic validity. A structurally perfect IR can
 * still name a metric that does not exist, group by a dimension that is not a
 * valid grain, or ask for a window outside the data. These checks run on every
 * plan regardless of how it was produced, including hand-written dashboard
 * tiles - the tiles go through the same door as the chat.
 */
import type { Layer } from '../shared/layer-types.ts';
import { isGroupable } from '../shared/layer-types.ts';
import type { QueryIR } from '../shared/ir.ts';
import { intersectsCoverage, resolveTime } from './time.ts';

export type ErrorCode =
  | 'unknown_field'
  | 'too_many_fields'
  | 'invalid_operator'
  | 'invalid_value'
  | 'unbounded_scan'
  | 'not_groupable'
  | 'not_trendable'
  | 'missing_grain'
  | 'out_of_coverage'
  | 'limit_exceeded'
  | 'no_metrics';

export interface ValidationError {
  code: ErrorCode;
  field?: string;
  message: string;
}

export const LIMIT_DEFAULT = 100;
export const LIMIT_CAP = 5000;

const NULL_OPS = new Set(['is_null', 'is_not_null']);
const NUMERIC_OPS = new Set(['gt', 'gte', 'lt', 'lte', 'between']);
const SET_OPS = new Set(['in', 'not_in']);

export function validate(ir: QueryIR, layer: Layer): ValidationError[] {
  const errors: ValidationError[] = [];
  const err = (code: ErrorCode, message: string, field?: string) =>
    errors.push({ code, message, ...(field ? { field } : {}) });

  // clarify and unanswerable carry no query to validate.
  if (ir.intent === 'clarify' || ir.intent === 'unanswerable') return errors;

  if (ir.intent === 'forecast') return validateForecast(ir, layer);

  if (ir.metrics.length === 0) {
    err('no_metrics', 'A query must request at least one metric.');
  }
  if (ir.metrics.length > 4) {
    err('too_many_fields', `${ir.metrics.length} metrics requested; the limit is 4.`);
  }
  if (ir.dimensions.length > 2) {
    err(
      'too_many_fields',
      `${ir.dimensions.length} dimensions requested; the limit is 2. Three or more is nearly always a misparse.`,
    );
  }

  for (const name of ir.metrics) {
    if (!(name in layer.metrics)) {
      err('unknown_field', `"${name}" is not a defined metric.`, name);
    }
  }

  for (const name of ir.dimensions) {
    const dim = layer.dimensions[name];
    if (!dim) {
      err('unknown_field', `"${name}" is not a defined dimension.`, name);
      continue;
    }
    if (!isGroupable(dim)) {
      const reason =
        name === 'sku'
          ? 'SKU averages 1.13 orders on this dataset, so it is never a reporting grain.'
          : (dim.notes?.split('\n')[0] ?? 'This dimension is filterable only.');
      err('not_groupable', `Cannot break results out by ${dim.label}. ${reason}`, name);
    }
    if (layer.parameters.min_group_size[name] === null) {
      err('unbounded_scan', `${dim.label} has no valid minimum sample size on this dataset.`, name);
    }
  }

  // A metric that counts an open status has no capture timestamp, so it is a
  // count of a label rather than a live backlog. It cannot be trended.
  if (ir.time?.grain) {
    for (const name of ir.metrics) {
      const metric = layer.metrics[name];
      if (metric && metric.point_in_time === false) {
        err(
          'not_trendable',
          `${metric.label} cannot be broken out by time: it counts an open status with no capture timestamp.`,
          name,
        );
      }
    }
  }

  errors.push(...validateFilters(ir, layer));

  if (ir.time) {
    const field = ir.time.field;
    if (!(field in layer.time_dimensions)) {
      err('unknown_field', `"${field}" is not a time dimension.`, field);
    } else {
      const resolved = resolveTime(ir.time, layer);
      if (!intersectsCoverage(resolved, layer, field)) {
        const [from, to] = layer.time_dimensions[field]!.coverage;
        err(
          'out_of_coverage',
          `That period is outside the data, which covers ${from} to ${to}.`,
          field,
        );
      }
    }
  }

  if (ir.limit !== null && ir.limit > LIMIT_CAP) {
    err('limit_exceeded', `Limit ${ir.limit} exceeds the cap of ${LIMIT_CAP}.`);
  }

  const sortable = new Set([...ir.metrics, ...ir.dimensions, 'period']);
  for (const s of ir.sort) {
    if (!sortable.has(s.by)) {
      err('unknown_field', `Cannot sort by "${s.by}" - it is not in the result.`, s.by);
    }
  }

  return errors;
}

function validateFilters(ir: QueryIR, layer: Layer): ValidationError[] {
  const errors: ValidationError[] = [];
  const filters = ir.intent === 'forecast' ? (ir.forecast?.series_filters ?? []) : ir.filters;

  for (const f of filters) {
    const dim = layer.dimensions[f.field];
    const time = layer.time_dimensions[f.field];
    if (!dim && !time) {
      errors.push({
        code: 'unknown_field',
        field: f.field,
        message: `"${f.field}" is not a filterable field.`,
      });
      continue;
    }

    if (NULL_OPS.has(f.op)) continue;

    if (f.value.length === 0) {
      errors.push({
        code: 'invalid_value',
        field: f.field,
        message: `Filter on ${f.field} has no value.`,
      });
      continue;
    }
    if (f.op === 'between' && f.value.length !== 2) {
      errors.push({
        code: 'invalid_value',
        field: f.field,
        message: `"between" on ${f.field} needs exactly two values.`,
      });
    }
    if (!SET_OPS.has(f.op) && f.op !== 'between' && f.value.length !== 1) {
      errors.push({
        code: 'invalid_operator',
        field: f.field,
        message: `"${f.op}" on ${f.field} takes a single value.`,
      });
    }

    if (dim) {
      if (NUMERIC_OPS.has(f.op) && dim.type === 'categorical') {
        errors.push({
          code: 'invalid_operator',
          field: f.field,
          message: `"${f.op}" is not valid on the categorical dimension ${dim.label}.`,
        });
      }
      if (dim.values) {
        for (const v of f.value) {
          if (!dim.values.includes(v)) {
            errors.push({
              code: 'invalid_value',
              field: f.field,
              message: `"${v}" is not a value of ${dim.label}. Valid values: ${dim.values.join(', ')}.`,
            });
          }
        }
      }
    }
  }
  return errors;
}

function validateForecast(ir: QueryIR, layer: Layer): ValidationError[] {
  const errors: ValidationError[] = [];
  const spec = ir.forecast;
  if (!spec) {
    return [{ code: 'no_metrics', message: 'A forecast plan must carry a forecast block.' }];
  }
  if (!(spec.target_metric in layer.metrics)) {
    errors.push({
      code: 'unknown_field',
      field: spec.target_metric,
      message: `"${spec.target_metric}" is not a defined metric.`,
    });
  }
  // SKU is refused by the forecast service itself, with the arithmetic and a
  // category fallback, rather than as a flat validation error.
  errors.push(...validateFilters(ir, layer));
  return errors;
}
