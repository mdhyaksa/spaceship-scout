/**
 * layer.yaml -> layer.generated.ts
 *
 * A build step rather than a bundler plugin, so the Vite build and the
 * wrangler build consume the layer identically with no per-pipeline config.
 * YAML stays the source of truth; the generated file is committed so a fresh
 * clone type-checks before anything is installed.
 *
 *   npm run build:layer
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parse } from 'yaml';
import type { Layer, Metric } from '../shared/layer-types.ts';
import { deriveParameters } from './derive.ts';

const here = dirname(fileURLToPath(import.meta.url));
const source = join(here, 'layer.yaml');
const target = join(here, 'layer.generated.ts');

const layer = parse(readFileSync(source, 'utf8')) as Layer;

// Structural checks. Cheap, and they turn a typo in the YAML into a build
// failure rather than a runtime "unknown metric" at demo time.
deriveParameters(layer);
const derived = layer.parameters as unknown as Record<string, unknown>;

const errors: string[] = [];

// Any {{placeholder}} in a metric filter must resolve to a declared parameter.
for (const [name, metric] of Object.entries(layer.metrics)) {
  const filter = 'filter' in metric ? metric.filter : undefined;
  for (const match of (filter ?? '').matchAll(/\{\{(\w+)\}\}/g)) {
    if (!(match[1]! in derived)) {
      errors.push(`metric ${name}: filter references unknown parameter {{${match[1]}}}`);
    }
  }
}

for (const [name, metric] of Object.entries(layer.metrics) as [string, Metric][]) {
  if (!metric.label) errors.push(`metric ${name}: missing label`);
  if (!metric.format) errors.push(`metric ${name}: missing format`);
  if (metric.agg === 'ratio') {
    for (const side of ['numerator', 'denominator'] as const) {
      const ref = metric[side];
      if (!(ref in layer.metrics)) {
        errors.push(`metric ${name}: ${side} "${ref}" is not a declared metric`);
      }
    }
  } else if (!metric.expr) {
    errors.push(`metric ${name}: missing expr`);
  }
  if (metric.agg === 'percentile_disc') {
    const p = metric.percentile;
    if (!(p > 0 && p < 1)) errors.push(`metric ${name}: percentile must be between 0 and 1`);
  }
}

for (const [name, dim] of Object.entries(layer.dimensions)) {
  if (!dim.expr) errors.push(`dimension ${name}: missing expr`);
  if (dim.parent && !(dim.parent in layer.dimensions)) {
    errors.push(`dimension ${name}: parent "${dim.parent}" is not a declared dimension`);
  }
}

for (const entry of layer.glossary) {
  const [kind, name] = entry.maps_to.split('.');
  const pool = kind === 'metric' ? layer.metrics : kind === 'dimension' ? layer.dimensions : null;
  if (!pool || !name || !(name in pool)) {
    errors.push(`glossary "${entry.terms[0]}": maps_to "${entry.maps_to}" does not resolve`);
  }
}

const quadrant = layer.parameters.priority_quadrant.rate_threshold;
if (!quadrant.startsWith('metric.') || !(quadrant.slice(7) in layer.metrics)) {
  errors.push(`priority_quadrant.rate_threshold "${quadrant}" does not resolve to a metric`);
}

if (errors.length) {
  console.error('Semantic layer is invalid:\n' + errors.map((e) => `  - ${e}`).join('\n'));
  process.exit(1);
}

const banner = `// GENERATED FILE — do not edit.
// Source: semantic/layer.yaml   Run: npm run build:layer
// Business logic belongs in the YAML, never here.
`;

writeFileSync(
  target,
  `${banner}import type { Layer } from '../shared/layer-types.ts';\n\n` +
    `export const layer: Layer = ${JSON.stringify(layer, null, 2)} as Layer;\n\n` +
    `export default layer;\n`,
);

const metricCount = Object.keys(layer.metrics).length;
const dimCount = Object.keys(layer.dimensions).length;
console.log(
  `layer ${layer.version}: ${metricCount} metrics, ${dimCount} dimensions, ` +
    `anchor ${layer.time_anchor.value} -> semantic/layer.generated.ts`,
);
