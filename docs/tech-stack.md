# Tech Stack — Decision Record

**Version:** 1.0
**Context:** Working prototype of the NL analytics dashboard, 6–10 hours of AI-assisted build, zero infrastructure spend.
**Companions:** `nl-analytics-spec-v0.2.md`, `chart-design-spec-v0.4.md`

---

## 1. Constraints

| Constraint | Consequence |
|---|---|
| 6–10 hours total | Infrastructure setup must be near zero. Feature work already fills the budget (§8) |
| No spend | Free tiers only, and the plan terms must permit commercial use |
| Commercial project | Rules out several otherwise-obvious free tiers |
| 400-row dataset | No database sizing, indexing or query optimisation problem exists |
| Must demo the architecture, not just the output | The three-layer separation (`nl-analytics-spec §1.2`) has to be visible and defensible |

The dataset size is the most under-appreciated constraint. At 400 rows nothing is slow, so every decision below is about setup time, dialect fidelity and demo credibility — never performance.

---

## 2. Decision: host

**Chosen: Cloudflare (Workers + Pages).**

| Option | Free tier | Commercial use | Verdict |
|---|---|---|---|
| Cloudflare Workers + Pages | 100K Worker requests/day, Pages static hosting | Yes | **Chosen** |
| Vercel Hobby | 100 GB transfer, 1M function invocations, 4 CPU-hours | **No** — personal, non-commercial only | Rejected on terms |
| Netlify | 100 GB bandwidth, 125K function calls | Yes | Viable fallback |
| Render free | Web service | Yes | Rejected — spins down when idle, 30–50s cold start mid-demo |
| Fly.io | Small allowance | Yes | Rejected — Docker setup costs time |

Vercel is the reflex choice and it fails on a policy line rather than a technical one. The Hobby plan is explicitly personal and non-commercial; a prototype built for a logistics company is commercial use regardless of whether it earns revenue directly. Render's idle spin-down is disqualifying for a different reason — the first question asked in a live demo would take 40 seconds to answer.

**Platform limits that shape the design.** Workers Free allows 100,000 requests/day, 128 MB memory, a 64 MiB uncompressed bundle, and **10 ms CPU time per request**. The CPU cap is the one that matters. It measures compute, not wall time, so waiting on D1 or on OpenRouter does not count against it. This workload is I/O-dominated and fits comfortably; anything CPU-heavy needs measuring rather than assuming.

### 2.1 Is this a technical win or a terms win?

Mostly a terms win. Stated plainly so nobody mistakes it for a technical verdict.

| | Cloudflare | Vercel |
|---|---|---|
| First-party SQL database | D1, bound directly to the Worker | None — requires Neon, Supabase or similar |
| Runtime | V8 isolates with `nodejs_compat`; some npm packages break | Full Node runtime; more packages work unmodified |
| CPU per request | 10 ms on Free | Far higher |
| Cold start | Isolates, effectively none | Lambda cold start |
| Ecosystem density | Thinner | Much denser — more examples, fewer novel problems in an AI-assisted build |
| Free tier permits commercial use | **Yes** | **No** |

With a $20/month budget, Vercel Pro plus Neon free would be a defensible stack and probably faster to build, mostly because ecosystem density translates directly into fewer dead ends. Cloudflare wins here because it is the only option where "free" and "commercially permitted" are both true.

### 2.2 The one-vendor principle

Keeping the whole prototype inside a single vendor is a deliberate choice, and it does more work than it looks like.

**What it buys:**

- **One signup, one bill, one auth model.** With 6–10 hours on the clock, 30 minutes on a second vendor's onboarding is 5–8% of the budget spent on nothing a reviewer will ever see.
- **No cross-service secrets.** The D1 binding is declared in `wrangler.toml`. There is no connection string to store, rotate, leak, or forget to set in the deploy environment. An entire category of failure disappears.
- **No cross-network hop on the hot path.** Worker to D1 is same-platform. Worker to an external Postgres is a network call with its own timeout, retry and cold-start behaviour to reason about.
- **One status page.** When something breaks at hour eight, "is it us or them" has one place to look rather than three.
- **A cleaner story for the stakeholder.** "One account, `wrangler deploy`, $0" survives a review meeting. "Cloudflare for compute, Neon for data, plus a connection pooler" invites questions the prototype does not need to answer yet.

**What it costs:**

- **Single point of failure.** One vendor down means everything down. Acceptable for a prototype, not for production.
- **Best-of-breed is forfeited.** D1 is a good general-purpose edge database. It is not an analytics database, and at real data volumes that gap matters (§11).
- **Lock-in accumulates quietly** if platform-specific APIs leak into application code.

The mitigation for the third is architectural and belongs in the first commit: **the compiler talks to a `Database` interface with one method — `run(sql, params)`.** D1, Neon, Postgres and `better-sqlite3` all satisfy it. Nothing above that interface knows which engine is underneath. That single abstraction is what makes §11 a swap rather than a rewrite.

**The principle inverts later.** One vendor is a prototype virtue because setup time dominates. In production, data volume and query shape dominate, and you deliberately split — a database specialist for the warehouse, a compute platform for the API — because being right about the warehouse matters more than being convenient about the bill.

---

## 3. Decision: framework

**Chosen: Vite + React + TypeScript, single-page app.**

Next.js would work and `@opennextjs/cloudflare` deploys it, but it buys nothing here. There is no SEO requirement, no server rendering need, and no routing complexity beyond two or three views. Vite gives faster HMR during a time-boxed build and fewer framework-specific failure modes to debug at hour seven.

The SPA is static and served from Pages. All server behaviour lives in a small number of Worker routes.

---

## 4. Decision: where SQL runs

This decision shapes everything else.

### 4.1 The options

| Approach | Setup cost | Guards enforceable | Latency |
|---|---|---|---|
| **A. Client-side WASM DB** (PGlite, DuckDB-WASM) | ~0 | No — advisory only | 0.3 ms |
| **B. Server-side, Cloudflare D1** | ~15 min | Yes | 5–20 ms |
| **C. Server-side, Neon Postgres** | ~30–45 min | Yes | 50–200 ms, plus cold start |
| **D. No SQL — in-memory JS aggregation** | ~0 | N/A | <1 ms |

### 4.2 Why client-side is tempting and still wrong

At 400 rows a browser database is genuinely fast and free. PGlite is ~3.3 MB gzipped, DuckDB-WASM ~2.8 MB, with a 200–400 ms cold start on first load and ~80 ms once cached. None of that is a problem.

The problem is that it quietly guts two things the spec insists on:

- **`nl-analytics-spec §7.2` guards become theatre.** A read-only role, a statement timeout and a table allowlist mean nothing when the engine runs in the user's own tab and the console can execute arbitrary SQL against it. The prototype would demonstrate a security model it does not have.
- **`§1.2` layer separation collapses.** The three-layer story — business logic, AI interpretation, computation — is what a stakeholder is being asked to approve. Running computation inside the UI bundle makes that harder to argue even though the code is genuinely separated.

**Option D is rejected outright.** Hand-rolled JS aggregation would be the fastest thing to build, but the raw-SQL escape hatch (§7 of the analytics spec) needs a real SQL engine to fall back to, and the semantic layer's premise is that each metric declares its own SQL expression. Removing SQL removes the architecture.

### 4.3 Chosen: server-side

Option B. Computation lives in the Worker, the browser is a pure view layer, and the guards are real.

---

## 5. Decision: which database

**Chosen: Cloudflare D1, with Neon as the documented upgrade path.**

| | D1 | Neon |
|---|---|---|
| Engine | SQLite at the edge | Postgres |
| Free tier | 5M row reads/day, 100K row writes/day, 5 GB storage, no card required | 0.5 GB storage |
| Extra vendor | None — same account as Workers | Yes |
| Cold start | None | Autosuspend on idle; first query after a pause is slow |
| Extensions | None loadable — not even FTS5 | Full Postgres extension set |
| Percentile | `CUME_DIST` CTE, verified identical to `PERCENTILE_DISC` (§5.1) | Native `PERCENTILE_DISC` |
| Setup | `wrangler d1 create`, one schema file, one seed | Signup, connection string as secret, schema, seed |

Headroom check: a `GROUP BY` over the fact table reads 400 rows, so the 5M daily read limit allows roughly 12,500 queries per day. A demo uses dozens. Note that from 1 September 2026, D1 queries on the Workers Free plan **fail** once daily limits are exceeded rather than throttling — irrelevant at this volume, but the failure mode is hard rather than graceful.

### 5.1 Percentiles on SQLite

SQLite has no `PERCENTILE_CONT`, and D1 cannot load the sqlite.org percentile extension — it is a managed service with no `load_extension()`, and even FTS5, which ships with SQLite, is unavailable. Extensions are only an option when running your own SQLite binary.

Pure SQL handles it. Percentile metrics compile to a `CUME_DIST()` CTE joined back on the dimension keys (`nl-analytics-spec §6.1`). Verified against this dataset, the CTE returns values identical to Postgres `PERCENTILE_DISC` on every carrier, every region, the global no-dimension case and the two-dimension case, at roughly 1 ms per query.

Two points worth recording.

**The semantic layer declares `percentile_disc`, not `percentile_cont`.** Discrete rather than interpolated, and this is the better definition on its own merits. "The 90th percentile order took 7 days" describes an order that exists; interpolation would report 6.4 days, which no order took. Postgres has `PERCENTILE_DISC` natively, so one metric definition produces identical numbers on both engines.

**Use `CUME_DIST`, never `PERCENT_RANK`.** They look interchangeable and are not. `PERCENT_RANK` is `(rank − 1) / (n − 1)` and overshoots — on this dataset it returns the wrong value for 3 of 9 carriers. `CUME_DIST` is `(rows ≤ current) / n`, which is exactly the definition `PERCENTILE_DISC` uses.

### 5.2 Why not Neon as the default

Neon is the better engine and would be the right call with more hours. Its advantage is exact dialect continuity: the compiler emits one flavour of SQL from prototype through production, and `nl-analytics-spec §6.1` is written in Postgres syntax already.

It loses on two practical points. It is a second vendor to set up inside a 6–10 hour budget, and its free tier autosuspends, so the first question asked in a live demo pays a cold-start penalty. Both are manageable — a warm-up ping handles the second — but neither is free, and D1 costs nothing on either axis.

**Upgrade path:** swap the D1 binding for a Neon client behind the `Database` interface, and let the compiler emit native `PERCENTILE_DISC` instead of the CTE. Numbers are unchanged either way, and that equivalence is verified rather than assumed. Everything else — semantic layer, validator, IR, chart rules — is untouched. That is the payoff of putting business logic in YAML rather than in code.

### 5.3 PGlite as the local development database

Not as the runtime. PGlite is Postgres in WASM, so if the project later moves to Neon, developing against PGlite locally gives the same dialect on the laptop and in production with no Docker and no connection string. Optional for this prototype; worth knowing for whoever picks the project up.

---

## 6. Remaining decisions

### 6.1 Charts — hand-rolled SVG

Not Recharts, not Chart.js, not visx.

`chart-design-spec-v0.4.md` specifies hollow points for low samples, a shaded priority quadrant bounded by computed thresholds, muted fills, per-dimension sufficiency rules, target lines with inline labels, and a stacked composition bar carrying two denominators. Every one of those is a fight with a charting library's theming layer and a few lines of raw SVG.

The charts needed are a stacked bar, a column chart, a histogram with a highlighted tail, and a scatter with quadrant shading. None requires an axis library; a `scaleLinear` helper is about ten lines.

**One exception:** the forecast chart's confidence band. Recharts' `ComposedChart` with an `Area` handles the band-plus-line composition well. Mixing one library in for one chart is fine.

### 6.2 LLM gateway — OpenRouter, one tool call

Per `nl-analytics-spec §5.1`: a single forced tool call, `strict: true`, `provider: { require_parameters: true }`. No agent loop.

The Worker route builds the prompt, calls OpenRouter, validates the returned IR against the schema, and returns it. The OpenRouter call is I/O, so it does not consume the 10 ms CPU budget.

**Security requirement, not a preference.** The API key lives in a Worker secret (`wrangler secret put`) and is read server-side only. It must never be bundled into the client, including via any build-time environment variable that ends up in the SPA. A key exposed on a public deployment gets scraped and drained within hours. This single requirement is why the project needs a host with server functions rather than pure static hosting.

### 6.3 Forecast — hand-rolled, in the Worker

Moving average, linear trend and simple exponential smoothing, with a backtest to select between them. Roughly 40 lines of TypeScript. `statsmodels` would be three lines but costs a Python service and a second deploy.

Holt and seasonality are out of scope — 12 monthly points cannot support seasonal decomposition anyway (`nl-analytics-spec §6.3`).

### 6.4 Query log — D1, same database

`nl-analytics-spec §8.1` wants the log persistent across sessions so the coverage loop can be demonstrated. `localStorage` cannot do that; a reviewer would only ever see their own queries.

D1 is already there. An append-only log table costs one `CREATE TABLE` and one insert per request, well inside the 100K daily write limit.

Skip for the prototype: embeddings, clustering, the gap taxonomy. Ship the log table and a plain `/coverage` page listing raw-SQL and clarify-path questions ordered by frequency. That demonstrates the loop without building the machinery.

---

## 7. Final stack

```
Vite + React + TypeScript      SPA, static assets
  ├─ semantic layer YAML       bundled, imported as a typed object
  ├─ IR types + validator      shared with the Worker
  ├─ chart components          hand-rolled SVG, design spec tokens
  └─ Recharts                  forecast band only

Cloudflare Worker
  ├─ POST /api/plan            question → OpenRouter → validated IR
  ├─ POST /api/query           IR → compiler → Database → result + explain
  ├─ POST /api/forecast        ForecastSpec → backtest → projection
  ├─ POST /api/sql             raw SQL path, guarded, trust: unverified
  └─ GET  /api/coverage        query log rollup

Database interface            run(sql, params) — D1 today, Neon later

Cloudflare D1
  ├─ fct_orders                400 rows, seeded from CSV at deploy
  └─ nl_query_log              append-only

Cloudflare Pages               deploy target
```

One vendor. One account. `wrangler deploy`. Total cost $0.

**Layer mapping**, for the stakeholder conversation in `nl-analytics-spec §1.2`:

| Layer | Where it lives |
|---|---|
| Business logic | Semantic layer YAML, bundled, version-controlled |
| AI interpretation | `/api/plan` Worker route only |
| Computation | Compiler, D1, forecast, chart rules |

The separation is physical, not just conceptual. That is the argument client-side SQL would have cost.

---

## 8. Time budget

| Piece | Hours |
|---|---|
| Semantic layer + validator + compiler | 2–3 |
| Planner route, prompt, few-shot examples | 1–2 |
| Four charts | 2–3 |
| Forecast service | 1 |
| Explain panel + query log + coverage page | 1 |
| Deploy, seed, wiring | 0.5 |

**Ship / drop:**

| Ship | Drop |
|---|---|
| Semantic layer, ~8 metrics, ~5 dimensions | Multiple datasets, joins, fan-out guard (no joins exist) |
| IR, validator, compiler | `chart_hint` override |
| Single-model planner, one tool call | Tier-2 routing, retry-on-validator-error |
| Sufficiency guard, per-dimension thresholds | Flat-distribution χ² test |
| P90 via `CUME_DIST` CTE | Interpolated percentiles |
| Four charts | Everything else in the selection table |
| SES + linear trend + moving average, backtested | Holt, seasonality |
| Explain panel: IR, SQL, filters, anchor | Clarify flow with option patches |
| Query log + coverage list | Embeddings, clustering, gap taxonomy |
| Raw SQL path + trust badge + guards | AST parser — use a strict regex allowlist |

---

## 9. Risks

| Risk | Mitigation |
|---|---|
| Date anchor bug — data ends 2025-12-30, today is 2026 | Hardcode `data_as_of` on day one. Every relative range resolves against it (`nl-analytics-spec §2.2`) |
| SQLite dialect surprises in the compiler | Write the compiler against a local `better-sqlite3` with the same schema before touching D1 |
| Workers Free 10 ms CPU cap | I/O waits do not count, so the current design fits. Measure before adding CPU-heavy work such as SQL parsing or large serialisation |
| OpenRouter latency 2–4s | Build the loading state early, not at the end |
| Free-tier terms and quotas change often | Every number in this document has a short shelf life. Re-check before building, not after |
| Demo question "which carrier is worst?" hits the sufficiency guard | This is the best moment in the demo, not a bug. Rehearse it |

---

## 10. Honest limitations to state during the demo

- The raw-SQL guard uses a regex allowlist rather than a real SQL parser. Production needs the parser (`nl-analytics-spec §7.2`), and its cost against the 10 ms CPU budget should be measured before adding it.
- P90 is a discrete percentile rather than interpolated. Deliberate: it reports a transit time some order actually had, and it is identical on SQLite and Postgres.
- The forecast runs on 12 monthly points. Every projection shows a wide confidence band, and that is the correct output rather than a defect.
- The coverage loop logs and ranks but does not cluster. Clustering is specified and deliberately deferred.

Stating these up front is worth more than hoping nobody asks. Each has a written answer in the specs, which is itself the point being demonstrated.

---

## 11. Production stack, when infra resources exist

Written now because the migration cost depends almost entirely on decisions made at prototype time.

### 11.1 What does not change

| Component | Survives migration? |
|---|---|
| Semantic layer YAML | Unchanged |
| Query IR schema | Unchanged |
| Validator | Unchanged |
| Compiler logic | Unchanged; only the emitted dialect differs |
| Chart selection rules | Unchanged |
| Sufficiency guard, per-dimension thresholds | Unchanged |
| Design tokens and components | Unchanged |
| Golden eval set | Unchanged, and now more valuable |
| Database binding | **Replaced** |
| Percentile emission | **Replaced** — native `PERCENTILE_DISC` instead of the CTE |

Two things make this true rather than aspirational: business logic lives in YAML rather than code (`nl-analytics-spec §1.2`), and everything reaches the database through the one-method `Database` interface (§2.2).

The prototype is therefore not a throwaway. It is the first implementation of an architecture that survives.

### 11.2 The shape of the problem changes first

| | Prototype | Production |
|---|---|---|
| Rows | 400 | Millions per year |
| Source | One CSV | Order systems, carrier APIs, WMS |
| Users | One demo | 30+ clients, each seeing only their own data |
| Freshness | Static | Daily or hourly loads |
| Percentiles across dimensions | Instant on any engine | The query shape that decides the database |

That last row drives the database choice. Percentile-over-partition on tens of millions of rows is exactly where row-oriented storage struggles and columnar storage does not.

### 11.3 Recommended production stack

```
Sources (order system, carrier APIs, WMS)
  └─ Airbyte or Fivetran            ingestion

Warehouse
  ├─ Postgres (Neon / RDS / Cloud SQL)   up to roughly 20–50M rows
  └─ ClickHouse                          beyond that, or when percentile
                                         queries become the hot path

dbt
  └─ fct_orders + dim tables         the semantic layer's base_table is
                                     now a dbt model, not a CSV

API service (TypeScript or Go)
  ├─ semantic layer YAML             unchanged, version-controlled
  ├─ validator + compiler            unchanged
  ├─ planner route                   OpenRouter, one forced tool call
  ├─ forecast service                statsmodels via a Python sidecar,
                                     or keep the TypeScript version
  └─ hosted on Fly.io / Cloud Run / ECS

Caching
  ├─ Redis                           IR cache, keyed as §5.5 of the spec
  └─ warehouse pre-aggregation       for the fixed dashboard tiles

Query log
  └─ Postgres + pgvector             enables §8.3 clustering properly

Frontend
  └─ same React SPA, plus auth

Auth
  └─ Clerk / WorkOS / Auth0

Observability
  └─ OpenTelemetry → Grafana or Datadog, with §8.7 SLIs as dashboards

CI
  └─ golden eval set as a merge gate (§10 of the analytics spec), plus
     the three conformance tests from §1.2
```

### 11.4 Decisions worth arguing about

**Postgres or ClickHouse.** Start with Postgres. A logistics operation doing a few million orders a year sits comfortably inside what Postgres handles with sensible indexes, and staying on one engine keeps the compiler simple. Move to ClickHouse when percentile and distribution queries across high-cardinality dimensions become the slow path — a measurable event, not a guess.

**Adopt Cube or dbt Semantic Layer, or keep the hand-rolled one?** Keep the hand-rolled one. Cube would give caching and pre-aggregation for free, but the IR is not an implementation detail here — it *is* the explainability artifact the user sees (`nl-analytics-spec §4`, §9). Handing that shape to a third-party layer means accepting its query model or fighting it. The hand-rolled layer is a few hundred lines and you own its semantics. Revisit only if pre-aggregation becomes the bottleneck.

**dbt is not optional.** The prototype's `fct_orders` is a CSV. In production it is a model built from several sources, with the status logic and the transit-day derivation living in dbt rather than in metric expressions. The semantic layer then sits on clean models, which is where it belongs.

**Multi-tenancy belongs in the compiler, not the query.** With clients seeing only their own data, the tenant filter must be injected by the compiler and be non-bypassable — including on the raw SQL path, which is the obvious hole. Postgres row-level security is the belt to that braces. Getting this wrong is the failure mode where one client sees another's delay rates.

**Forecasting: revisit the language.** In TypeScript, moving average, linear trend and SES are about 40 lines. Holt-Winters with seasonality, prediction intervals from a fitted model and proper backtesting are not. Once forecasts matter commercially, a small Python service using `statsmodels` earns the second deploy that §6.3 rejects at prototype scale.

### 11.5 When not to migrate

If this stays at a few hundred thousand rows with a handful of internal users, the Cloudflare stack is not a stepping stone — it is the answer. Workers Paid removes the CPU cap, D1 handles that volume without complaint, and the whole thing stays one vendor and one deploy.

Migrate when a specific constraint binds: data volume slowing percentile queries, multi-tenant isolation requirements, or a freshness SLA the CSV-and-deploy loop cannot meet. Not on the general feeling that production deserves more machinery.
