import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';
import { emptyIR } from '../shared/ir.ts';
import { compile } from '../worker/compile.ts';
import { execute } from '../worker/execute.ts';
import { db } from './helpers.ts';
import { deriveParameters } from '../semantic/derive.ts';
import type { Layer } from '../shared/layer-types.ts';

/**
 * The three checks from Natural_language_query_spec.md section 1.2, which make
 * the layer separation verifiable rather than aspirational.
 *
 * The governing invariant: the AI layer reads business logic at runtime but
 * never contains it, and the computation layer executes business logic but
 * never defines it.
 */
describe('layer separation', () => {
  const database = db();

  it('1. flipping a business rule changes results with no code change', async () => {
    // exception_counts_as_late is the one genuinely contested definition here.
    // Flipping it in the YAML must move every delay figure, without a prompt
    // edit and without touching a line of application code. The test parses
    // the YAML itself, so it is checking the source of truth rather than a
    // generated artefact.
    const source = readFileSync('semantic/layer.yaml', 'utf8');
    const ir = emptyIR({ metrics: ['delayed_count', 'delay_rate'] });

    const asShipped = deriveParameters(parse(source) as Layer);
    const flipped = deriveParameters(
      parse(source.replace('exception_counts_as_late: false', 'exception_counts_as_late: true')) as Layer,
    );
    expect(asShipped.parameters.exception_counts_as_late).toBe(false);

    const beforeQuery = compile(ir, asShipped);
    const afterQuery = compile(ir, flipped);
    const before = await database.run(beforeQuery.sql, beforeQuery.params);
    const after = await database.run(afterQuery.sql, afterQuery.params);

    expect(Number(before[0]!['delayed_count'])).toBe(55);
    expect(Number(after[0]!['delayed_count'])).toBe(66); // 55 delayed + 11 exceptions
    expect(Number(after[0]!['delay_rate'])).toBeGreaterThan(Number(before[0]!['delay_rate']));
    expect(Number(after[0]!['delay_rate'])).toBeCloseTo(66 / 370, 12);
  });

  it('2. the same plan always produces the same result', async () => {
    // Two identical IRs must produce identical results whatever produced them,
    // which is what lets a model be swapped without changing an answer.
    const { layer } = await import('../semantic/layer.generated.ts');
    const ir = emptyIR({ metrics: ['delay_rate'], dimensions: ['carrier'], sort: [{ by: 'delay_rate', dir: 'desc' }] });
    const a = await execute(ir, layer, database, { requestId: 'a' });
    const b = await execute(structuredClone(ir), layer, database, { requestId: 'b' });
    expect(JSON.stringify(b.data)).toBe(JSON.stringify(a.data));
    expect(b.text).toBe(a.text);
    expect(b.explain!.sql).toBe(a.explain!.sql);
  });

  it('3. a stored plan executes with no model available', async () => {
    // The cheapest of the three and the one most likely to catch a regression:
    // any leak of business logic into a prompt breaks it immediately. Nothing
    // in this path can reach a model - there is no API key in the test env.
    const { layer } = await import('../semantic/layer.generated.ts');
    const stored = emptyIR({
      metrics: ['on_time_rate'], dimensions: ['region'],
      interpretation: 'On-time rate by region.',
    });
    const answer = await execute(stored, layer, database, { requestId: 'stored' });
    expect(answer.status).toBe('ok');
    expect(answer.data!.row_count).toBe(5);
    expect(answer.explain!.metrics[0]!.definition).toContain('divided by');
    expect(answer.sufficiency!.distribution_test).not.toBeNull();
  });

});
