import type { Layer } from '../shared/layer-types.ts';

/**
 * Parameters computed from other parameters.
 *
 * Kept in one function so the build step and anything that loads the YAML
 * directly cannot disagree: exception_counts_as_late is the single source of
 * truth, and delayed_statuses is the list the compiler substitutes into
 * metric filters as {{delayed_statuses}}.
 */
export function deriveParameters(layer: Layer): Layer {
  const parameters = layer.parameters as unknown as Record<string, unknown>;
  parameters['delayed_statuses'] = layer.parameters.exception_counts_as_late
    ? ['delayed', 'exception']
    : ['delayed'];
  return layer;
}
