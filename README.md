# Space Scout — logistics analytics with natural language query

A logistics analytics dashboard that answers questions from data rather than from a model. Charts and KPI cards on one side, a natural-language interface on the other, demand forecasting with an inventory recommendation, and an explainability panel behind every number on both surfaces.

The dataset is 400 mock orders covering calendar year 2025.

**The one thing to know before clicking anything: the data ends 2025-12-30.** Every relative date — "last month", "last 3 months" — resolves against that anchor rather than against today's clock. Anchored to the wall clock, every one of those questions would return zero rows.

---

## Running it locally

Requires Node 20.19+.

```bash
npm install
npm run setup     # creates the local D1 and loads 400 rows — once
```

Then two terminals, because the Worker serves the API and Vite serves the SPA with hot reload:

```bash
npm run dev:api   # terminal 1 — Worker on :8787
npm run dev       # terminal 2 — SPA on :5173, proxies /api to 8787
```

Open **http://localhost:5173**.

### Both ports answer, and they serve different things

`wrangler dev` prints `Ready on http://localhost:8787`, and that URL does load the app — which makes it easy to open the wrong one and wonder why an edit did nothing.

| | `:5173` — `npm run dev` | `:8787` — `npm run dev:api` |
|---|---|---|
| Serves | Your source, live | The built bundle in `dist/` |
| Hot reload | Yes | **No** |
| `/api/*` | Proxied to :8787 | Handled directly |
| Use it for | Developing | Checking the deployed shape |

`wrangler.toml` carries a `[build]` command, so `wrangler dev` compiles `dist/` before it starts — which is why :8787 works on a fresh clone with no build step. The catch is that it keeps serving **that snapshot**. Edit anything under `src/` and :8787 will still show the previous build, silently, until the next `npm run build`.

So: **develop on :5173, and use :8787 deliberately** when you want the one-process production shape — the Worker serving both the API and the static assets, exactly as the deployment does.

> Use `localhost`, not `127.0.0.1`, for the Vite port. Vite binds IPv6 only (`[::1]:5173`), so `127.0.0.1:5173` refuses the connection while `localhost:5173` works. The Worker port answers on both.

### Signing in

A login screen guards the app. Signing in sets an HttpOnly session cookie signed with an HMAC keyed on the password, valid for 12 hours; **Sign out** in the topbar clears it.

Credentials are **not in this repository**. They are shared with the submission, out of band; set `AUTH_USER` and `AUTH_PASSWORD` locally in `.dev.vars` and on the deployment as Worker secrets. The gate **fails closed**: with them unset nothing authenticates, because the opposite default turns one forgotten `wrangler secret put` into a public dashboard.

**What is gated is the API**, which is where the data is. The SPA shell is served to anyone — it is a static bundle carrying no metric definitions, thresholds or glossary, because those stay in the Worker. That is deliberate: it is what lets the login be a page in the app, identical on `:5173`, on `:8787` and in production, rather than the browser's own credential dialog, which cannot be styled, cannot say what it is guarding, and offers no way to sign out.

Rotating the password invalidates every existing session at once, since it is the signing key. There is no server-side session store, so sessions cannot be revoked individually — acceptable for one shared credential, and among the things real per-user auth would change.

**This is a gate, not an identity system.** One shared credential means the app knows someone is allowed in, never who they are — see Limitations.

### Without an API key

The dashboard, forecasts, breakdown scatter and every explainability panel work with no key at all — they are hand-written plans that never touch a model. Only the chat needs one, and it says so plainly rather than failing. See below to add it.

### Scripts

| Script | Does |
|---|---|
| `npm run setup` | Local D1 schema + 400 rows. Run once |
| `npm run dev:api` | Worker on :8787 |
| `npm run dev` | SPA on :5173 |
| `npm test` | 69 tests. Seeds `db/local.sqlite` itself if missing |
| `npm run build` | Semantic layer, typecheck, SPA bundle |
| `npm run db:remote` | Load the 400 rows into the deployed D1 |
| `npm run deploy` | Build then `wrangler deploy` |

### Environment variables

| Name | Where | Purpose |
|---|---|---|
| `OPENROUTER_API_KEY` | Worker secret | Planner access. **Never** a `var`, never bundled into the SPA |
| `OPENROUTER_MODEL` | `wrangler.toml` var | Defaults to `google/gemini-3.8-flash` |
| `AUTH_USER` | Worker secret | Basic-auth user. Never a var |
| `AUTH_PASSWORD` | Worker secret | Basic-auth password. Never a var |

Copy `.dev.vars.example` to `.dev.vars` for local runs. `.dev.vars` is gitignored, and no secret is committed.

Without a key the dashboard, forecasts and explainability all still work — they are hand-written plans that never touch a model. Only the chat needs one, and it says so plainly rather than failing.

### Deploy

One vendor, one account. Steps 1–4 are once per environment; step 5 is every deploy.

```bash
# 1. Authenticate (opens a browser)
npx wrangler login

# 2. Create the database, then paste the printed id into wrangler.toml
#    over REPLACE_AFTER_wrangler_d1_create
npx wrangler d1 create spaceship-intel-db

# 3. Create the schema and load the 400 rows
npm run db:schema:remote
npm run db:remote

# 4. Store the secrets — never vars, never in the repo
npx wrangler secret put OPENROUTER_API_KEY
npx wrangler secret put AUTH_USER
npx wrangler secret put AUTH_PASSWORD

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

**Cloudflare and D1, not Vercel and Postgres.** A terms decision before a technical one: the Vercel Hobby plan is personal and non-commercial, and this is a commercial prototype. Cloudflare's free tier permits it and D1 needs no second vendor, so there is no connection string to store or leak. The cost is SQLite rather than Postgres, paid for by the `Database` interface and a Postgres emitter that a test already exercises. Full reasoning and the production stack: `docs/tech-stack.md`.

**Forecasting is moving average, linear trend and SES — no Holt.** Twelve monthly points cannot support a trend-plus-level decomposition, let alone seasonality; fitting one would produce a confident-looking line through noise. The method is chosen per series by backtest rather than picked in advance — hold out the last `min(horizon, 4)` periods, score MAPE, refit on full history — and **every candidate's score is returned**, because showing the models that lost is what makes the winner credible. Intervals come from backtest residuals, never from the fit: a model scored on data it has already seen produces intervals that are too narrow.

**Four UI decisions that changed the architecture** are recorded as ADRs in `docs/decisions/`: explain panels as floating bubbles rather than inline expansion, dimension values coming from the data where the layer does not declare them, the type scale as tokens rather than root `zoom`, and chat state living in the app shell.

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

### Why Gemini 3.8 Flash

Chosen on [Artificial Analysis](https://artificialanalysis.ai/) for a workload where **latency is the binding constraint and reasoning depth is not**.

| Model | Intelligence | Speed (tok/s) | Cost per task |
|---|---|---|---|
| **Gemini 3.8 Flash** | **41** | **273** | **$1.24** |
| Muse Spark 1.3 | 48 | 222 | $1.60 |
| GPT-5.6 Luna | 38 | 110 | $0.18 |
| Grok 4.6 (high) | 44 | 53 | $1.86 |
| GPT-6 Astra | 53 | 54 | $3.26 |
| Claude Opus 5 | 51 | 51 | $5.86 |
| Claude Fable 5.1 | 53 | 67 | $7.63 |

Flash is **fastest by 23%** over the next model and roughly **five times** the frontier models, at a fifth of their cost. It ranks eighth of ten on intelligence — and that is the trade being made deliberately.

The planner does one thing: read a rendered catalog and emit a schema-constrained object. It does not chain steps, choose among tools, or reason about results — the `intent` enum routes, the validator checks, and every number comes from SQL. There is no task in that loop where an intelligence index of 53 does something a 41 cannot.

What the user *does* feel is the wait. The planner sits between the question and the answer with nothing to show, so its latency is the whole perceived cost of the chat. `Natural_language_query_spec.md` §8.7 sets the SLI at p95 under 2.5s; at 273 tok/s a hundred-token plan is well inside it, where a 51 tok/s model is not.

**Adequate is a claim to be verified, not assumed.** The golden set is the gate: hallucinated field names must be zero, and clarify precision and recall are scored per model. `OPENROUTER_MODEL` is a config var and `Planner` is an interface, so the swap is a redeploy — and conformance test 2 guarantees the answer cannot change as a result, since identical IRs produce identical results whatever wrote them.

**Where the trade would show.** A weaker model should cost accuracy on ambiguous questions, so watch the clarification rate. The SLI watches it from both sides: too high wastes the user's time, and too low means the planner is guessing and returning confident wrong answers, which is the most expensive failure this system has.

### How tools are selected

**The `intent` enum is the routing decision.** The planner always emits a plan; `intent` dispatches it deterministically to the query tool, the forecast tool, a clarification, or a refusal. That is the same two-tool outcome an agent loop would reach, with one fewer model decision and no chance of the model reacting to intermediate results. Routing is a single enum on a schema-constrained object, so a loop buys nothing here.

Confidence below 0.5 routes to `clarify` whatever intent the model chose, because a confident wrong answer is the most expensive failure this system has.

### What the "Verified" pill means

Every chat answer carries a green **Verified** pill. It is not decoration, and it is not a claim that the answer is *correct* — it is a claim about **where the number came from**.

Verified means the whole path was deterministic and inspectable:

1. The model emitted a **query plan**, not an answer — a schema-constrained object naming metrics and dimensions.
2. The plan was **validated** against the semantic layer: every metric and dimension exists, the grain is legal, the date range intersects the data.
3. The compiler turned it into **SQL from the layer's own metric definitions** — so `delay_rate` is delayed over *completed*, because that is what the YAML says, not because the model guessed a denominator.
4. Every figure in the answer text came back from that query. The prose is a template filled from the rows; it cannot state a number the query did not return.

So the pill means: **the model chose the question, the database answered it.** Hover it in the app for the short version, and open *How was this computed?* for the plan, the SQL and the rows behind it.

**What it does not mean.** It does not mean the number is *useful* — a verified answer can still rest on eight deliveries, which is why the sufficiency guard runs separately and may refuse to name a winner in the very same answer. Nor does it mean the model understood you: a plan can be validly compiled and still answer a different question than you asked, which is what the interpretation line and the plan itself are there to let you check.

**Why every answer currently shows it.** The design has a second state, `unverified`, for answers produced by the raw-SQL escape hatch — a model writing SQL directly, guarded but not checked against defined metrics. That path is specified and deliberately not built (see Limitations), so in this release there is nothing that can produce an unverified answer. The field ships anyway, because the alternative is retrofitting a trust distinction into a UI that never had one.

### What the AI never does

It never produces a number, never writes SQL, never defines a metric, and never decides whether a difference is significant. Answer prose is a deterministic template filled from the returned rows.

---

## What the data supports, and what it does not

Three properties drive most of the design. Each invalidates an assumption a generic NL-analytics system would make.

**There is no promised delivery date.** Delay is a status value, not a computed comparison, and the five statuses are mutually exclusive. So `delayed` orders are *not* inside `delivered`: a delay rate computed as `delayed / delivered` inflates the rate by excluding late orders from their own denominator. The correct denominator is completed deliveries — 370, not 304. This is exactly the class of error the semantic layer exists to prevent.

The same distinction renamed a KPI card. It read "Delivered orders" and showed 304, the count of status `delivered` — but delayed and exception orders carry a delivery date too, so they were delivered, just late or messily. The card is **Completed orders, 370**, with the on-time count (304) as its context line: 370 answers "how many arrived", 304 answers "how many arrived on time", and the old card put the second number under the first question.

**Open statuses have no capture timestamp.** The 27 in-transit orders are spread evenly across all twelve months, and 293 orders placed after the oldest one have already delivered. So "how many orders are in transit right now" is unanswerable rather than approximated, and in-transit counts cannot be trended.

**Most breakdowns are noise.** χ² against `delayed`: carrier 0.053, region 0.945, product category 0.949, warehouse 0.983, promo 0.652. Only carrier is even borderline, and its ranking is driven by tiny samples — GLS shows 25% from 8 completed deliveries.

That last one is why the **sufficiency guard** is the part of this system worth looking at. Ask "which carrier has the highest delay rate?" and the answer is not GLS:

> GLS shows the highest delay rate at 25.0%, but that is 2 of 8 — not enough to distinguish it from the 14.9% overall rate. USPS at 23.4% across 47 is the more meaningful signal.

A leader may only be named if it clears three guards: the omnibus χ² rejects flatness, the leader's own sample reaches its dimension's floor, and a two-proportion test separates it from the rest. Requiring the omnibus test first is not optional — the maximum of 47 lanes passes a pairwise test on noise alone, and a lane at 2 of 2 delayed beats the pooled rate at p = 0.03 while telling you nothing.

### Why the transit chart shades a tail

Mean transit is 3.83 days. Reported alone that says deliveries take under four days — true, and useless for the 21 orders that took eight to twelve. Those are the ones that generate complaints, and an average is structurally incapable of showing them: the mean sits inside the body of the distribution and says nothing about its tail.

So the transit-time chart renders the body in grey and the tail in ink, and carries **p95 (8 days)** as a reference line beside the mean. p95 is the number a service target can be set against; the mean is context.

**Why p95 and not p90.** Both are defensible; running both was not. An earlier version shaded the tail at p95 (8 days) while drawing a reference line at p90 (6 days), which asked the reader to hold two answers to one question — *where does the tail start?* Consolidating on one was the decision; p95 won it on three grounds:

- **It is where the distribution actually turns.** p90 is 6 days, which is still inside the body — 6-day deliveries are unremarkable here. The mass thins out at 8.
- **It matches the shading.** `tail_threshold_days` is the p95, so the reference line lands exactly where the colour changes and the chart states one boundary rather than two.
- **It is the more conservative promise.** A service target set at p90 is one 19 orders in 370 miss; at p95 it is one 21 orders miss but which covers 95% of customers. For a target you intend to publish, the higher percentile is the one you can defend.

The cost is a coarser number on this dataset: at 370 completed deliveries, p95 rests on the top 19 observations, so it moves more per order than p90 would. On a larger dataset that concern disappears; on this one it is stated rather than hidden.

Two caveats. The threshold is **data-derived, not contractual**: this dataset carries no promised delivery date, so eight days is where this distribution's tail begins, not a breach of anything. On real data that parameter should become the SLA and stop tracking the p95. And the shading is `>= 8`, so the eight-day bucket reads as tail rather than body.

This reasoning lives here rather than on the dashboard. The chart states its figures and lets the colour do the arguing.

### Why the breakdown is a scatter

The obvious control is a bar chart of on-time rate by carrier, sorted worst first. It was rejected because it answers the wrong question: a sorted bar chart is a leaderboard, and on this data the leaderboard is noise. GLS tops it at 25% delay from **eight** deliveries.

A bar chart has one positional channel, so it can show the rate but not the sample behind it — and the sample is the thing that decides whether the rate means anything. The scatter has two:

| Metric | Channel | Why |
|---|---|---|
| Share of volume | x position | Position is the most accurately read channel, and volume is what makes a rate worth acting on |
| On-time rate | y position | The decision metric, read against the target line |
| Avg transit days | Fill darkness | Diagnostic. "Slower than others" is all it needs to say |
| p95 transit | Tooltip | A lookup value, not a comparison |

That geometry turns the honest answer into a *place on the chart*. A group that is both high-volume and below target sits bottom-right, which is why that quadrant is shaded and labelled — it is the only region where a difference is both real enough and large enough to act on. A bar chart cannot express "bad but too small to matter"; the scatter puts it in the far left where it belongs.

**Size is deliberately not an encoding.** Points are a fixed radius. Size reads as importance, and volume already holds that meaning on the x axis; two channels claiming the same intuition is worse than leaving one unused.

### Why dense dimensions hide their small groups

Carrier, region, warehouse and category have five to nine groups and plot every one, hollow ones included — a hollow point keeps its true position, so a promising small carrier is still visible as promising.

Lane (47) and client (30) are different. Measured, 47 lane marks produced **25 overlapping pairs**, with 37 of them below the sample floor of 10, all crammed into a 0.5–3.8% share band. Above 15 groups the chart now draws only the groups clearing their floor, says how many were withheld, and offers a toggle.

The trade is real: **it hides data by default**, which is a thing to be uncomfortable about. It was chosen because the sufficiency guard already concludes those 37 rates are not reportable, and a chart that plots them anyway contradicts its own caption. The toggle and the caption are what keep it honest — nothing is unreachable, and the count of what is hidden is on screen. It never hides everything: if no group clears the floor there is nothing left to draw, so all of them show with the warning instead.

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
- **No raw-SQL fallback.** A question the layer cannot express clarifies rather than falling through to generated SQL. The guards and trust marking for that path are specified but not built — which is why every answer in this release is Verified.
- **No pinning a chat answer to the dashboard.** The design has it (`docs/SPEC.md` §7.1) and the mechanism is cheap, since a pinned tile would store the plan rather than the result and re-execute like any other tile. It is not built: without per-user identity a pin is per-browser, and a dashboard section that only its author can see is closer to a scratchpad than a dashboard. Tile → chat still works: any card or chart can hand its plan to the chat as context.
- **P95 is discrete, not interpolated** — it reports a transit time some order actually had, and is identical on SQLite and Postgres.
- **Dashboard tiles are not logged.** They are fixed plans rather than questions; logging them would bury the fall-throughs the coverage page exists to surface.
- **Sample sizes are thin almost everywhere.** 5 of 9 carriers, 25 of 30 clients and 37 of 47 lanes fall below their floor. The UI states the coverage rather than quietly muting them.
- **A shared password, not user accounts.** HTTP Basic auth gates the deployment, so the dashboard is not public — but one credential is shared by everyone, so the app never learns *who* is asking. There is still no identity to hang a conversation on, and three consequences follow:
  - **Chat history is per browser, not per user.** Conversations and pinned tiles live in `localStorage` (`spaceship.conversations.v1`, `spaceship.pinned.v1`). They do not follow you to another device or another browser, are not visible to anyone else, and vanish when site data is cleared.
  - **The query log records no `user_id`.** `Natural_language_query_spec.md` §8.1 designs the column; the shipped table omits it, because there is nothing truthful to write in it.
  - **That weakens the coverage loop more than it first appears.** §8.5 ranks gaps by `distinct_users × log(question_count)`, so that a question asked once each by twelve people outranks one asked twelve times by a single power user. Without identity the coverage page can only rank by raw frequency, which is exactly the ranking that flatters one persistent user. Adding auth is therefore a prerequisite for Future Improvement 1, not an orthogonal feature.

  Real authentication replaces the gate rather than building on it, and the compiler would need a non-bypassable tenant filter alongside it (`docs/tech-stack.md` §11.4). Nothing here pretends to be multi-tenant today.

  Basic auth also has the properties Basic auth has: credentials go on every request, so it relies entirely on TLS, and there is no session, no logout beyond closing the browser, and no rate limiting on attempts.

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

69 tests, no API key required. The ones worth knowing about:

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
| `docs/decisions/` | ADRs — the reasoning behind decisions that would be expensive to reverse |
