/**
 * The planner is a single forced tool call, not an agent loop.
 *
 * Routing is one enum on the IR, so a multi-turn loop where the model picks
 * among tools and reacts to intermediate results buys nothing here and costs
 * the one thing that varies most between models: the number of decisions per
 * turn. The model emits a plan; `intent` dispatches it.
 *
 * Kept behind an interface. The lock-in worth avoiding is prompt-and-catalog
 * lock-in, not SDK lock-in.
 */
import type { Layer } from '../shared/layer-types.ts';
import { irJsonSchema, queryIrSchema, type QueryIR } from '../shared/ir.ts';
import { fewShots, systemPrompt } from './prompt.ts';

export interface PlannerResult {
  ir: QueryIR | null;
  raw: unknown;
  modelId: string;
  latencyMs: number;
  error: string | null;
}

export interface Planner {
  plan(question: string, layer: Layer): Promise<PlannerResult>;
}

const TOOL_NAME = 'submit_query_plan';

export function openRouterPlanner(apiKey: string, model: string): Planner {
  return {
    async plan(question, layer) {
      const started = Date.now();
      const messages: { role: string; content: string }[] = [
        { role: 'system', content: systemPrompt(layer) },
      ];
      // Few-shots as a compact transcript rather than as tool-call pairs: it
      // costs fewer tokens and the model is already schema-constrained.
      messages.push({
        role: 'system',
        content:
          'EXAMPLES — question, then the plan you would submit:\n' +
          fewShots().map((s) => `Q: ${s.question}\nPLAN: ${JSON.stringify(s.plan)}`).join('\n\n'),
      });
      messages.push({ role: 'user', content: question });

      let raw: unknown = null;
      try {
        const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
            'X-Title': 'SpaceShip Logistics Analytics',
          },
          body: JSON.stringify({
            model,
            messages,
            tools: [{
              type: 'function',
              function: {
                name: TOOL_NAME,
                description: 'Submit the structured query plan for this question.',
                parameters: irJsonSchema(),
                strict: true,
              },
            }],
            // The planner never decides *whether* to answer. It always emits a
            // plan, and `intent` carries the routing.
            tool_choice: { type: 'function', function: { name: TOOL_NAME } },
            // Without this a request can be served by a provider that ignores
            // `strict`, and a shape violation arrives from a model you believed
            // was constrained.
            provider: { require_parameters: true },
            temperature: 0,
          }),
        });

        if (!response.ok) {
          const body = await response.text();
          return { ir: null, raw: body, modelId: model, latencyMs: Date.now() - started, error: `OpenRouter ${response.status}: ${body.slice(0, 300)}` };
        }

        const json = (await response.json()) as {
          choices?: { message?: { tool_calls?: { function?: { arguments?: string } }[] } }[];
        };
        const args = json.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
        if (!args) {
          return { ir: null, raw: json, modelId: model, latencyMs: Date.now() - started, error: 'Model returned no tool call.' };
        }
        raw = JSON.parse(args);
      } catch (e) {
        return { ir: null, raw, modelId: model, latencyMs: Date.now() - started, error: (e as Error).message };
      }

      // Schema conformance is not semantic validity: a structurally perfect IR
      // can still name a metric that does not exist, so the validator runs
      // afterwards regardless of `strict`.
      const parsed = queryIrSchema.safeParse(raw);
      if (!parsed.success) {
        return { ir: null, raw, modelId: model, latencyMs: Date.now() - started, error: `Plan did not match the schema: ${parsed.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; ')}` };
      }

      const ir = parsed.data;
      // Confidence below the threshold routes to clarify whatever the model
      // chose, because a low-confidence guess is the expensive failure.
      if (ir.confidence < 0.5 && ir.intent !== 'unanswerable') {
        return {
          ir: { ...ir, intent: 'clarify', clarify_question: ir.clarify_question ?? 'Could you say which measure and which breakdown you have in mind?' },
          raw, modelId: model, latencyMs: Date.now() - started, error: null,
        };
      }
      return { ir, raw, modelId: model, latencyMs: Date.now() - started, error: null };
    },
  };
}
