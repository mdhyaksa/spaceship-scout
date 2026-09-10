# Manifest — logistics analytics with natural language query

A logistics analytics dashboard that answers questions from data rather than from a model. Charts and KPI cards on one side, a natural-language interface on the other, demand forecasting with an inventory recommendation, and an explainability panel behind every number on both surfaces.

The dataset is 400 mock orders covering calendar year 2025.

**The one thing to know before clicking anything: the data ends 2025-12-30.** Every relative date — "last month", "last 3 months" — resolves against that anchor rather than against today's clock. Anchored to the wall clock, every one of those questions would return zero rows.

---

## Setup

Requires Node 20.19+.

```bash
npm install
npm run db:local        # CSV -> db/local.sqlite, for dev and tests
npm test                # 64 tests, no API key needed
```

Run it locally — two processes, because the Worker serves the API and Vite serves the SPA with hot reload:

```bash
npx wrangler d1 execute logistics --local --file=db/schema.sql
npm run db:preview                       # seeds the local D1
npx wrangler dev --local --port 8787     # terminal 1
npm run dev                              # terminal 2, proxies /api to 8787
```

Then open http://localhost:5173.

To exercise the deployed shape instead — one process, the Worker serving both the API and the built SPA:

```bash
npm run build
npx wrangler dev --local --port 8787     # http://127.0.0.1:8787
```

### Environment variables

| Name | Where | Purpose |
|---|---|---|
| `OPENROUTER_API_KEY` | Worker secret | Planner access. **Never** a `var`, never bundled into the SPA |
| `OPENROUTER_MODEL` | `wrangler.toml` var | Defaults to `anthropic/claude-sonnet-4.5` |

Copy `.dev.vars.example` to `.dev.vars` for local runs. `.dev.vars` is gitignored, and no secret is committed.

Without a key the dashboard, forecasts and explainability all still work — they are hand-written plans that never touch a model. Only the chat needs one, and it says so plainly rather than failing.

### Deploy

One vendor, one account. Steps 1–4 are once per environment; step 5 is every deploy.

```bash
# 1. Authenticate (opens a browser)
npx wrangler login

# 2. Create the database, then paste the printed id into wrangler.toml
#    over REPLACE_AFTER_wrangler_d1_create
npx wrangler d1 create logistics

# 3. Create the schema and load the 400 rows
npx wrangler d1 execute logistics --remote --file=db/schema.sql
npm run db:remote

# 4. Store the planner key as a secret — never a var, never in the repo
npx wrangler secret put OPENROUTER_API_KEY

# 5. Build and deploy
npm run deploy
```

`npm run deploy` builds the semantic layer, typechecks, builds the SPA and runs `wrangler deploy`. The Worker serves `/api/*` and hands every other path to the static asset router, so one deployment covers both.

Verify the result:

```bash
curl https://<your-worker>.workers.dev/api/layer
curl -X POST https://<your-worker>.workers.dev/api/tiles \
  -H 'content-type: application/json' -d '{"filters":[],"period":"all"}'
```

Two things that are easy to get wrong, both found by trying them:

- **`wrangler d1 execute --file` cannot read a pipe.** `--file=/dev/stdin` fails with `EAGAIN: resource temporarily unavailable`, which is why `npm run db:sql` writes `db/seed.sql` first. That file is gitignored — it is derived from the CSV.
- **`not_found_handling` does not apply on its own when `main` is set.** Unmatched paths fall through to the Worker, so `worker/index.ts` hands non-API requests back to `env.ASSETS`. Without that, a deep link returns 404 instead of the SPA.

---

## Architecture

```
Question ──► Planner (LLM, one forced tool call) ──► Query IR ──► Validator ──► Compiler ──► D1
                                                        │                          │
Dashboard tile (hand-written IR) ───────────────────────┘                          ├──► Chart selector (rules)
                                                                                   ├──► Sufficiency guard (stats)
                                                                                   └──► Forecast service (compute)
```

The model turns a question into a **structured query spec (IR)**. Everything downstream is deterministic: validation, SQL compilation, chart selection, statistics, forecasting. The IR doubles as the query plan shown to the user, which is why explainability falls out of the architecture instead of being bolted on.

### The three layers

| Layer | Contains | Never contains |
|---|---|---|
| **Business logic** | `semantic/layer.yaml` — metrics, dimensions, glossary, thresholds, the time anchor | Prompts, SQL, application code |
| **AI interpretation** | Question → IR. `worker/planner.ts`, `worker/prompt.ts` | Metric definitions, thresholds, date arithmetic, SQL |
| **Computation** | Validator, compiler, executor, chart rules, forecast, sufficiency guard | Model calls, business definitions |

The separation is physical, not just conceptual: the semantic layer lives in the Worker, and the SPA fetches only the labels it needs from `/api/layer`. No metric definition, threshold or glossary term reaches the browser.

Three tests in `tests/conformance.test.ts` make that verifiable rather than aspirational:

1. **Flip a business rule.** Changing `exception_counts_as_late` from `false` to `true` in the YAML moves delayed orders from 55 to 66 and delay rate from 14.9% to 17.8% — with no prompt edited and no application code touched. The test parses the YAML itself, so it checks the source of truth rather than a generated artefact.
2. **The same plan always gives the same result**, whatever produced it. That is what lets a model be swapped without changing an answer.
3. **A stored plan executes with no model available.** The full answer returns, minus the prose.

### Key design decisions

**Dashboard tiles are IRs.** A KPI card and a chat answer for the same question go through the same validator, compiler, sufficiency guard and explain builder. There is no hand-written tile SQL anywhere, which is what stops a card and the chat disagreeing about the same number.

**Three compiler rules carry most of the correctness.**
1. A metric's own filter compiles *inside* the aggregate as `FILTER (WHERE …)`, never to a `WHERE` clause. `delayed_count` and `completed_count` appear in the same query constantly, and a `WHERE` would corrupt the sibling.
2. Ratios are computed at the final grain, never as an average of per-row ratios.
3. Every ratio drags its denominator into the result set whether or not the caller asked for it — no rate is displayed without its `n`.

**Percentiles use a `CUME_DIST` CTE**, which is exactly the definition `PERCENTILE_DISC` uses. `PERCENT_RANK` looks interchangeable and is not: measured on this dataset it disagrees for 4 of the 9 carriers.

**One `Database` interface with one method.** D1 today, `better-sqlite3` in tests, Neon or Postgres later. `worker/dialect.ts` holds the SQL differences and a test compiles the same plan through both emitters.

**Charts are hand-rolled SVG.** Hollow points below a sample floor, a shaded quadrant bounded by computed thresholds, per-bar tail highlighting, inline reference labels — each is a fight with a charting library's theming layer and a few lines of raw SVG. Recharts appears once, for the forecast band, and is lazy-loaded so the overview does not pay for it.

### Data flow

1. The question, plus the rendered catalog and glossary, goes to the planner as **one forced tool call**. The tool's JSON Schema *is* the IR schema.
2. The returned plan is parsed against the schema, then validated semantically — schema conformance is not semantic validity, and a structurally perfect IR can still name a metric that does not exist.
3. The compiler emits SQL. Query filter values are always bound parameters; metric filters come from the version-controlled layer and are inlined.
4. D1 runs it. The sufficiency guard then examines the *result* and decides what the answer is allowed to claim.
5. Chart selection is a deterministic function of result shape. No second model call.
6. The answer text is a template filled from the returned rows, written after execution. It never states a figure the query did not return.

---

## AI approach

### How questions are interpreted

One call, one tool, forced. `tool_choice` pins the model to `submit_query_plan`, `strict: true` constrains decoding to the schema, and `provider.require_parameters` stops OpenRouter routing to a provider that ignores `strict` — without it you get a shape violation from a model you believed was constrained.

The prompt carries the rules, the catalog rendered from the semantic layer, the glossary, the time-resolution table with the current anchor, and 14 few-shot examples — two of which exercise the delivered/delayed denominator trap. The catalog and glossary are injected at runtime from the versioned layer, never hand-edited into a prompt string, and `layer_version` is logged on every request as the audit trail.

### How tools are selected

**The `intent` enum is the routing decision.** The planner always emits a plan; `intent` dispatches it deterministically to the query tool, the forecast tool, a clarification, or a refusal. That is the same two-tool outcome an agent loop would reach, with one fewer model decision and no chance of the model reacting to intermediate results. Routing is a single enum on a schema-constrained object, so a loop buys nothing here.

Confidence below 0.5 routes to `clarify` whatever intent the model chose, because a confident wrong answer is the most expensive failure this system has.

### What the AI never does

It never produces a number, never writes SQL, never defines a metric, and never decides whether a difference is significant. Answer prose is a deterministic template filled from the returned rows.

---

## What the data supports, and what it does not

Three properties drive most of the design. Each invalidates an assumption a generic NL-analytics system would make.

**There is no promised delivery date.** Delay is a status value, not a computed comparison, and the five statuses are mutually exclusive. So `delayed` orders are *not* inside `delivered`: a delay rate computed as `delayed / delivered` inflates the rate by excluding late orders from their own denominator. The correct denominator is completed deliveries — 370, not 304. This is exactly the class of error the semantic layer exists to prevent.

**Open statuses have no capture timestamp.** The 27 in-transit orders are spread evenly across all twelve months, and 293 orders placed after the oldest one have already delivered. So "how many orders are in transit right now" is unanswerable rather than approximated, and in-transit counts cannot be trended.

**Most breakdowns are noise.** χ² against `delayed`: carrier 0.053, region 0.945, product category 0.949, warehouse 0.983, promo 0.652. Only carrier is even borderline, and its ranking is driven by tiny samples — GLS shows 25% from 8 completed deliveries.

That last one is why the **sufficiency guard** is the part of this system worth looking at. Ask "which carrier has the highest delay rate?" and the answer is not GLS:

> GLS shows the highest delay rate at 25.0%, but that is 2 of 8 — not enough to distinguish it from the 14.9% overall rate. USPS at 23.4% across 47 is the more meaningful signal.

A leader may only be named if it clears three guards: the omnibus χ² rejects flatness, the leader's own sample reaches its dimension's floor, and a two-proportion test separates it from the rest. Requiring the omnibus test first is not optional — the maximum of 47 lanes passes a pairwise test on noise alone, and a lane at 2 of 2 delayed beats the pooled rate at p = 0.03 while telling you nothing.

---

## Assumptions

- Relative dates resolve against `data_as_of = 2025-12-30`, not the clock. Configurable to wall-clock time for a live feed.
- `exception` does not count as late by default. Contested, exposed as a parameter, and every answer using `delay_rate` states which convention applied.
- "Revenue" means gross of promotional discount. Net is available and the panel says which was used.
- Monthly volume declines from 75 in January to 24 in December. That is an artefact of how the mock data was generated, so trend models project downward. It is not presented as a business finding.
- Region is a single dimension: all 47 lanes are intra-region in this data, so origin and destination region are the same value.
- Two open brand items inherited from the existing product: the button green (123.5°) and the logo mark (150°) differ visibly, and Track & Trace uses uppercase KPI labels where this spec is sentence case.

## Limitations

- **No SKU-level forecasting.** 355 SKUs across 400 orders, 1.13 each, maximum 3. The service refuses with the arithmetic and offers the parent category one click away, rather than fitting a line through nothing.
- **Every forecast is low-confidence.** All series have 12 monthly points, below the 24-observation threshold. The interval is the answer; the line is indicative.
- **No cost, margin or freight columns**, no customer master data. Those questions are refused, not estimated.
- **No raw-SQL fallback.** A question the layer cannot express clarifies rather than falling through to generated SQL. The guards and trust marking for that path are specified but not built.
- **P90 is discrete, not interpolated** — it reports a transit time some order actually had, and is identical on SQLite and Postgres.
- **Dashboard tiles are not logged.** They are fixed plans rather than questions; logging them would bury the fall-throughs the coverage page exists to surface.
- **Sample sizes are thin almost everywhere.** 5 of 9 carriers, 25 of 30 clients and 37 of 47 lanes fall below their floor. The UI states the coverage rather than quietly muting them.

## Future improvements

In rough order of value:

1. **Close the coverage loop.** The query log ships; the clustering, gap taxonomy and promotion workflow that turn it into a roadmap do not. Embedding fall-through questions, clustering them, and proposing the YAML that would close each gap is the highest-leverage thing left (`Natural_language_query_spec.md` §8).
2. **The raw-SQL escape hatch**, with a real SQL parser rather than a regex allowlist, plus the unverified-trust surface around it.
3. **Tier-2 model routing** with validator errors fed back into the retry.
4. **Expand the golden set** to 60–100 pairs and gate model swaps on it.
5. **Real data**: dbt models instead of a CSV, multi-tenancy injected by the compiler and non-bypassable, and ClickHouse when percentile queries across high-cardinality dimensions become the slow path. `docs/tech-stack.md` §11 sets out the migration; the semantic layer, IR, validator, chart rules and golden set all survive it.

---

## Testing

```bash
npm test
```

64 tests, no API key required. The ones worth knowing about:

- **`tests/parity.test.ts`** derives every figure twice — once from the CSV in plain TypeScript, once by compiling an IR to SQL and running it — with no shared code between the two. It covers all five breakdown dimensions and the percentile CTE per group. A dropped `FILTER` clause or a ratio built on the wrong denominator fails a test rather than quietly reporting a plausible wrong number.
- **`tests/conformance.test.ts`** is the layer separation, checked rather than claimed.
- **`tests/golden.test.ts`** asserts on behaviour, not values: "refuses to name a winner", never "returns GLS". Tuning a test to a mock dataset breaks it the day real data arrives. It runs the planner when `OPENROUTER_API_KEY` is set and skips cleanly otherwise, while still checking the set's coverage and that every few-shot example is itself a valid plan.
- **`scripts/verify_data_facts.py`** re-derives every figure quoted in `docs/SPEC.md` §3 straight from the CSV, so the numbers in the documentation stay checkable rather than asserted.

## Documentation

| Document | What it covers |
|---|---|
| `docs/SPEC.md` | Product scope, the built/deferred split, assumptions and limitations |
| `docs/Natural_language_query_spec.md` | Semantic layer, IR, planner contract, compiler, sufficiency guard, coverage loop |
| `docs/DESIGN.md` | Colour roles, chart furniture, the breakdown scatter, data-quality states |
| `docs/tech-stack.md` | Why Cloudflare and D1, what it costs, and the production stack |
