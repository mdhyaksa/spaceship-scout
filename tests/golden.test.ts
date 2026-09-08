import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { layer } from '../semantic/layer.generated.ts';
import { queryIrSchema } from '../shared/ir.ts';
import { validate } from '../worker/validate.ts';
import { openRouterPlanner } from '../worker/planner.ts';
import { execute } from '../worker/execute.ts';
import { fewShots } from '../worker/prompt.ts';
import { db } from './helpers.ts';

interface Case {
  question: string;
  expect: Record<string, unknown>;
}

const golden = JSON.parse(readFileSync('tests/golden.json', 'utf8')) as { cases: Case[] };
const apiKey = process.env['OPENROUTER_API_KEY'];

describe('golden set', () => {
  it('covers the traps this dataset sets', () => {
    // The set is checked for coverage even without a key, so a regression in
    // the set itself is caught in CI rather than at review time.
    const questions = golden.cases.map((c) => c.question.toLowerCase());
    expect(golden.cases.length).toBeGreaterThanOrEqual(20);
    expect(golden.cases.filter((c) => c.expect['intent'] === 'unanswerable').length).toBeGreaterThanOrEqual(4);
    expect(golden.cases.filter((c) => c.expect['intent'] === 'clarify').length).toBeGreaterThanOrEqual(2);
    // The delivered/delayed denominator trap, phrased three different ways.
    expect(questions.filter((q) => /late|delayed/.test(q) && /delivered|completed|shipped|fraction|share|proportion/.test(q).valueOf()).length)
      .toBeGreaterThanOrEqual(3);
    expect(questions.some((q) => q.includes('sku'))).toBe(true);
    expect(questions.some((q) => q.includes('2027'))).toBe(true);
    expect(questions.some((q) => q.includes('revenue'))).toBe(true);
  });

  it('few-shot examples are themselves valid plans', () => {
    // A malformed example teaches the planner to emit malformed plans.
    for (const shot of fewShots()) {
      const parsed = queryIrSchema.safeParse(shot.plan);
      expect(parsed.success, `${shot.question}: ${parsed.success ? '' : JSON.stringify(parsed.error.issues)}`).toBe(true);
      if (parsed.success && !['clarify', 'unanswerable', 'forecast'].includes(parsed.data.intent)) {
        expect(validate(parsed.data, layer), shot.question).toEqual([]);
      }
    }
  });

  it.skipIf(!apiKey)('plans every golden question as expected', async () => {
    const planner = openRouterPlanner(apiKey!, process.env['OPENROUTER_MODEL'] ?? 'anthropic/claude-sonnet-4.5');
    const database = db();
    const failures: string[] = [];

    for (const testCase of golden.cases) {
      const planned = await planner.plan(testCase.question, layer);
      if (!planned.ir) { failures.push(`${testCase.question}: planner failed — ${planned.error}`); continue; }
      const ir = planned.ir;
      const want = testCase.expect;

      // Hallucinated fields must be zero. Any nonzero value blocks release.
      for (const metric of ir.metrics) {
        if (!(metric in layer.metrics)) failures.push(`${testCase.question}: hallucinated metric ${metric}`);
      }
      for (const dimension of ir.dimensions) {
        if (!(dimension in layer.dimensions)) failures.push(`${testCase.question}: hallucinated dimension ${dimension}`);
      }

      if (want['intent'] && want['intent'] !== 'any' && ir.intent !== want['intent']) {
        failures.push(`${testCase.question}: intent ${ir.intent}, wanted ${String(want['intent'])}`);
      }
      if (Array.isArray(want['metrics']) && !(want['metrics'] as string[]).every((m) => ir.metrics.includes(m))) {
        failures.push(`${testCase.question}: metrics ${ir.metrics.join(',')}, wanted ${(want['metrics'] as string[]).join(',')}`);
      }
      if (Array.isArray(want['dimensions']) && !(want['dimensions'] as string[]).every((d) => ir.dimensions.includes(d))) {
        failures.push(`${testCase.question}: dimensions ${ir.dimensions.join(',')}, wanted ${(want['dimensions'] as string[]).join(',')}`);
      }
      if (Array.isArray(want['metrics_must_include_any']) &&
          !(want['metrics_must_include_any'] as string[]).some((m) => ir.metrics.includes(m))) {
        failures.push(`${testCase.question}: none of ${(want['metrics_must_include_any'] as string[]).join(',')} present`);
      }
      if (want['grain'] && ir.time?.grain !== want['grain']) {
        failures.push(`${testCase.question}: grain ${ir.time?.grain}, wanted ${String(want['grain'])}`);
      }
      if (want['validator_error']) {
        const codes = validate(ir, layer).map((e) => e.code);
        if (!codes.includes(want['validator_error'] as never)) {
          failures.push(`${testCase.question}: expected ${String(want['validator_error'])}, got ${codes.join(',') || 'no errors'}`);
        }
      }
      if (want['answer_must_not_assert_winner']) {
        const answer = await execute(ir, layer, database, { requestId: 'golden' });
        if (answer.sufficiency?.ranking_significant !== false) {
          failures.push(`${testCase.question}: asserted a winner the sample cannot support`);
        }
      }
      if (want['flat_distribution_warning']) {
        const answer = await execute(ir, layer, database, { requestId: 'golden' });
        if (!answer.sufficiency?.distribution_test?.flat) {
          failures.push(`${testCase.question}: flat-distribution warning did not fire`);
        }
      }
    }

    expect(failures, `\n${failures.join('\n')}`).toEqual([]);
  }, 180_000);
});
