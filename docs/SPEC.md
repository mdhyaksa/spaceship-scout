# Logistics Analytics Dashboard — Specification

**Version:** 1.0
**Companions:** `docs/DESIGN.md` (chart visual system) · `docs/Natural_language_query_spec.md` (NL analytics architecture) · `docs/wireframes/full_dashboard_wireframe_v4_with_breakdown_scatter.html`

---

## 1. Overview

A logistics analytics dashboard that serves conventional chart-based analytics alongside natural language query.

It covers the three levels of intelligence the brief asks for:

| Level | Surface |
|---|---|
| Descriptive | Dashboard — KPI cards and charts (§6) |
| Diagnostic | Natural language query answered from data (§7) |
| Predictive / prescriptive | Demand forecast plus an inventory recommendation (§8) |

Every number on every surface is computed. The AI layer interprets the question and routes it; it never produces a figure.

---

## 2. Data source

Mock data in `../mock_logistics_data.csv` (repo root), loaded into **PostgreSQL** as `analytics.fct_orders`.

Postgres is not optional. The compiler in `docs/Natural_language_query_spec.md` §6.1 emits `FILTER (WHERE …)`, `NULLIF`, `::numeric`, `||` string concatenation and date subtraction — all Postgres. Local Postgres for development, managed Postgres for the deployed instance; same schema either way.

**The application has no write path.** Access is through a read-only role with a 15 s statement timeout. Data is loaded once by a seeding script that runs outside the application.

---

## 3. Data facts and the time anchor

Measured from `mock_logistics_data.csv`, not copied from any spec. `scripts/verify_data_facts.py` re-derives every figure below.

| Fact | Value |
|---|---|
| Rows / columns / grain | 400 / 17 / one row per `order_id` |
| Coverage | `order_date` 2025-01-01 → 2025-12-30 · `delivery_date` 2025-01-02 → 2025-12-31 |
| Status counts | delivered 304 · delayed 55 · exception 11 · in_transit 27 · canceled 3 |
| Completed deliveries | 370 (delivered + delayed + exception) |
| Headline KPIs | on-time 82.2% · delay rate 14.9% · avg transit 3.83 d |
| Transit distribution | p50 4 d · p90 6 d · p95 8 d · max 12 d · 21 orders at 8 d or more |
| Missing `delivery_date` | 30 rows (27 in transit, 3 canceled) |
| Cardinality | 9 carriers · 9 origin cities · 9 warehouses (1:1 with origin) · 5 regions · 47 destination cities · 47 lanes · 8 categories · 30 clients · 355 SKUs |
| Lane identity | 0 of 47 destinations are served by more than one origin, so a lane and a destination city are the same partition |
| Region | all 47 lanes are intra-region (EU→EU, UK→UK, US-C/E/W→same). Origin region and destination region are the same value |
| Revenue | `order_value_usd = quantity × unit_price_usd` for all 400 rows · 22 promo orders at 5–34% · gross 13,695.87, net 13,568.01 |
| Monthly orders | 75, 36, 46, 25, 29, 21, 42, 34, 18, 26, 24, 24 — 12 points, no zero months at total or region level |
| Category zero months | BRUSH 2 · MARKER 1 · PAINT 1 — max 2 of 12 (17%) |
| Sample coverage | carrier 4/9 reach 30 · client 5/30 reach 20 · lane 10/47 reach 10 (max 14, median 8) · warehouse 9/9 and category 8/8 reach 30 |
| Delay signal | χ² against `delayed`: carrier 0.053, region 0.945, category 0.949, warehouse 0.983, promo 0.652. Only carrier is even borderline |

### 3.1 The time anchor

**The data ends 2025-12-30. Today does not.** Every relative range resolves against a configured `data_as_of` anchor, never `now()`:

```
data_as_of = 2025-12-30        # max(order_date), refreshed on load
"last month"    → 2025-11-01 … 2025-11-30
"last 3 months" → 2025-10-01 … 2025-12-31
"this month"    → 2025-12-01 … 2025-12-30, partial_period: true
```

Anchored against the wall clock, every one of those returns zero rows. The anchor and the resolved absolute range appear in the dashboard header and in the explainability panel of every answer, so nobody mistakes this for a live feed. Switching to wall-clock time is a one-line config change (`time_anchor.mode: now`) for when this runs against a real source.

December 2025 is itself a partial month — it ends on the 30th — so the partial-period treatment fires more often than expected.

---

## 4. Core capabilities

1. **Dashboard** — cards and charts, cached, filterable (§6)
2. **Natural language query** — from scratch or quoting a dashboard tile (§7)
3. **Forecasting** — demand forecast plus inventory recommendation (§8)
4. **Explainability** — every answer and every tile shows how it was computed (§9)

---

## 5. Design

Visual system in `docs/DESIGN.md`. Query architecture, semantic layer and planner in `docs/Natural_language_query_spec.md`. Wireframe at `docs/wireframes/full_dashboard_wireframe_v4_with_breakdown_scatter.html`.

---

## 6. Dashboard

### 6.1 Cards

Each card is **bound to a semantic-layer metric id**, not to hand-written tile SQL. This is the rule that stops the dashboard and the chat answer disagreeing about the same number — both compile through the same layer.

| Card | Metric id | Value (all data) | Note shown on the card |
|---|---|---|---|
| Total Orders | `order_count` | 400 | — |
| Delivered Orders | `on_time_count` | 304 | — |
| Delayed Orders | `delayed_count` | 55 | Share is of 370 completed deliveries, not of 304 delivered |
| On-time Delivery Rate | `on_time_rate` | 82.2% | — |
| Average Delivery Time | `avg_transit_days` | 3.83 d | Excludes 30 orders with no delivery date (27 in transit, 3 canceled) |

`delayed` and `delivered` are mutually exclusive statuses. A delay rate computed as `delayed / delivered` is wrong — it excludes late orders from their own denominator. The layer declares `delay_rate` as a ratio metric so the denominator is never constructed ad hoc.

### 6.2 Charts

Cached, each with a refresh control (refresh icon).

1. **Order volume over time** — `order_count`, month grain.
2. **Order performance** — delayed vs on-time over time.
3. **Status composition** — all five statuses, count and percentage of total.
   **Caveat required.** `in_transit_count` and `canceled_count` are declared `point_in_time: false`. The 27 in-transit orders are spread evenly across all twelve months and carry no capture timestamp, so this tile is an **untimed total only**: it must not be trended or grouped by a time grain, and it must display the caveat whenever a date filter is active.
4. **Delivery-days distribution** — order count by transit days.
   The tail is the story. Mean transit is 3.83 d, p90 is 6 d, and the slowest order took 12 d — the mean hides exactly the orders that generate complaints, so **p90 is the number to manage against, not the average**. The chart carries both as reference lines and renders the tail beyond `tail_threshold_days` (8 d, the p95, 21 orders) in `ink` per `docs/DESIGN.md` §5.
5. **On-time delivery rate by carrier.**
6. **Breakdown scatter** — see §6.3.

### 6.3 Breakdown scatter

Specified in `docs/DESIGN.md` §6.1. It replaces the separate carrier and lane scorecards with one component and a switchable dimension.

| Metric | Channel |
|---|---|
| Share of volume | x position |
| On-time rate | y position, read against the target line |
| Avg transit days | point fill darkness, graphite ramp |
| P90 transit | tooltip only |

Switchable dimensions: **carrier · region · warehouse · product category · lane · client**. The priority quadrant — high volume, below target — is shaded bottom-right, with both bounds computed from the active filters rather than hardcoded.

### 6.4 Filters and comparison dimensions

These are two different sets and the spec keeps them apart. A field being filterable does not make it a valid grain.

| Filterable | Groupable (comparison dimension) |
|---|---|
| date range | — |
| carrier | carrier |
| region | region |
| warehouse | warehouse |
| product_category | product_category |
| lane | lane |
| client_id | client_id |
| is_promo | is_promo |
| order_status | — |
| origin_city | — (1:1 with warehouse) |
| destination_city | — (identical partition to lane) |
| sku | **never** |

- **`sku` is filterable but never groupable.** 355 SKUs across 400 orders, 1.13 each, max 3. The validator rejects it as a grain (`unbounded_scan`) and the forecast service refuses it outright (§8.1).
- **`destination_city` is filterable but not separately groupable.** Every destination is served by exactly one origin, so grouping by it produces the same 47 groups as `lane`. Shipping both would put two chips in the UI that draw the same chart. It and `origin_city` are declared `groupable: false` in the layer, and the validator enforces it (`not_groupable`).
- **`region` is one dimension, covering origin and destination.** All 47 lanes are intra-region, so there is no origin/destination distinction to make on this data.
- **`origin_city` is 1:1 with `warehouse`.** Group by warehouse; filter by either.

### 6.5 Sample-size coverage

Most breakdowns on this dataset are thin, and hiding that is worse than showing it. Every breakdown states how many groups clear its floor:

> Lane breakdown · 10 of 47 lanes meet the minimum sample of 10. The rest are shown hollow and are indicative only.

Groups below the floor are rendered per `docs/DESIGN.md` §8.1 (muted fill, `n` shown, excluded from any "highest"/"lowest" claim) and, in the scatter, as hollow points per §6.1.

### 6.6 Cache and refresh

Every card and chart is cached.

```
tile cache key = metric_id + dimension + filter_set + data_as_of + layer_version
```

Invalidated by a data reload (`data_as_of` moves) or a semantic-layer commit (`layer_version` moves). The refresh button busts **that tile's key only**, not the whole dashboard.

This is a different cache from the NL planner's IR cache (`docs/Natural_language_query_spec.md` §5.5), which keys on the normalized question and stores the query plan rather than the result.

---

## 7. Natural language query

Architecture, semantic layer, planner contract, validator, compiler and chart selection: `docs/Natural_language_query_spec.md`.

### 7.1 Chat context and pinning

Two directions, and they are not symmetrical.

**Tile → chat.** Every card and chart has an "Add to chat" control that attaches that tile's query plan (IR) as context to the active chat window, so a follow-up question inherits the tile's filters and metrics instead of restating them.

**Chat → dashboard.** Every verified answer has a "Pin to dashboard" control. Pinning saves **the IR, not the result**: a pinned tile re-executes on load, so it stays current and inherits the same cache key and refresh behaviour as a built-in tile.

Pinning is gated on `trust: "verified"`. With the raw-SQL escape hatch deferred (§10), every answer in v1 is verified, so the gate is specified and forward-compatible but never blocks. `docs/DESIGN.md` §8.3 defines the unverified treatment for when that path lands.

---

## 8. Forecasting

Pipeline in `docs/Natural_language_query_spec.md` §6.3. Rendering in `docs/DESIGN.md` §7. Every forecast returns four things:

1. **Forecast values** with 80% and 95% intervals
2. **Visualisation** — history solid, forecast dashed, interval bands, boundary rule at the last actual period
3. **Inventory recommendation** — reorder point and order-up-to level from the forecast, lead time and service level; a suggested quantity only when current on-hand is supplied
4. **Methodology explanation** — the chosen method, its backtest error, and the candidates that lost

### 8.1 SKU forecasts are refused, with a fallback

A SKU-level demand forecast is the obvious thing to ask this system, and this dataset cannot answer it: **355 SKUs across 400 orders — 1.13 orders per SKU, maximum 3.** There is no series to fit.

The contract, stated here because a reviewer will type this question:

- A SKU-scoped forecast returns `insufficient_history`
- The response shows the arithmetic (355 SKUs / 400 orders, max 3 orders for any one SKU) rather than a bare refusal
- It **automatically offers the parent category series** as the fallback, one click away

Refusing is the correct answer. Fitting a line through 1.13 points and rendering it confidently is the failure this whole architecture exists to prevent.

### 8.2 Viable grains

| Grain | Series | Points per series | Verdict |
|---|---|---|---|
| Total | 1 | 12 | Usable |
| Region | 5 | 12 | Usable, noisy |
| Product category | 8 | 12 | Usable; BRUSH has 2 zero months, MARKER and PAINT 1 each |
| SKU | 355 | ~1 | Impossible — refused (§8.1) |

### 8.3 Method selection stays backtest-driven

Hold out the last `min(horizon, 4)` periods, fit `moving_average`, `linear_trend`, `ses` and `holt` on the remainder, score by MAPE (MAE when an actual is zero), pick the winner, refit on full history. Ties within 2% go to the simpler model. **All candidate scores are returned** — showing the models that lost is what makes the winner credible.

### 8.4 Honest uncertainty

Every series on this dataset has 12 monthly points, which is below the 24-observation threshold, so the **low-confidence banner fires on every forecast**. A 4-month horizon sits exactly at the 2× history guard. Intervals come from backtest residuals widened by `sqrt(h)` and are never clamped to look confident — a wide band is the correct output here, not a rendering defect.

Monthly volume runs 75 in January down to 24 in December. That decline is an artefact of how the mock data was generated, so trend models will project downward. It is recorded as an assumption (§13), never presented as a business finding.

---

## 9. Explainability

Every answer **and every dashboard tile** exposes how it was computed. The response envelope is in `docs/Natural_language_query_spec.md` §9; this section fixes what must be present on both surfaces.

| Required | Where it comes from |
|---|---|
| Filters used | The IR's filters, plus the resolved absolute date range and the `data_as_of` anchor (§3.1) |
| Metrics and dimensions | Semantic-layer labels, definitions and `notes` — e.g. the delayed/completed denominator, gross vs net revenue |
| Query plan | The IR itself, rendered as the structured interpretation |
| Access to underlying data | The result rows as a table, plus the compiled SQL |

Two things extend beyond the brief's minimum, because they are what make the panel worth opening:

- **Warnings are part of the answer, not a footnote.** Sufficiency results (`docs/Natural_language_query_spec.md` §9.1) — small groups, an unreliable ranking, a flat distribution — constrain what the answer text is allowed to claim, and they render on dashboard tiles exactly as they do on chat answers.
- **KPI cards get the same treatment as charts.** A card is a one-cell query; it shows its metric definition, its filters and its rows on demand.

---

## 10. Scope — built and deferred

The brief budgets 6–10 hours and says plainly: do not over-engineer. The companion specs describe considerably more than that, most of it mapping to the bonus list. It is labelled rather than half-built.

**Built:**

- Semantic layer, validator, compiler (`Natural_language_query_spec.md` §3–5.4, §6.1)
- Chart selector including the breakdown scatter (§6.2, `DESIGN.md` §6.1)
- Dashboard: 5 cards, 5 charts, the scatter, filters, tile cache and refresh
- Planner: single tier, forced tool call, IR cache (§5.1, §5.2, §5.5)
- Explainability panel and the sufficiency guard (§9, §9.1)
- Forecast service: guards, backtest method selection, intervals, inventory (§6.3)
- Pinning in both directions (§7.1)
- Query log table, write path only (§8.1)
- Golden set, trimmed to roughly 20 pairs covering the traps in §10

**Deferred — documented in README Future Improvements, not started:**

- Tier-2 model routing (§5.3)
- Raw-SQL escape hatch and the unverified-trust surface (§7)
- SQL feature extraction, question clustering, gap taxonomy, coverage report, promotion workflow, SLIs (§8.2–8.8)
- The three conformance tests (§1.2) — stated as design, not wired into CI
- The full 60–100 pair golden set

---

## 11. README plan

The README follows the brief's structure heading for heading:

- **Setup** — local run steps, database seeding, environment variables
- **Architecture** — system overview, key design decisions, data flow diagram
- **AI Approach**
  - *How questions are interpreted* — question → IR through a schema-constrained tool call; everything downstream is deterministic
  - *How tools are selected* — the planner emits one forced tool call carrying an `intent` enum; that enum **is** the routing decision, dispatched deterministically to the query tool or the forecast tool. One model decision instead of an agent loop, with the same two-tool outcome and no chance of the model reacting to intermediate results
- **Assumptions** — §13 below
- **Limitations** — §13 below
- **Future Improvements** — the deferred list from §10
- **Submission** — repository link, deployed URL, credentials if any

---

## 12. Deployment and security

- Deployed to a publicly accessible URL, fully usable with no local setup
- If authentication is added, test credentials ship with the submission
- **No secrets in the repository.** Database URL and model API key come from environment variables; `.env.example` lists the names with empty values
- The application connects as a read-only role (§2)

---

## 13. Assumptions and limitations

Stated here so the README derives from the spec rather than being written twice.

**Assumptions**

- Relative dates resolve against `data_as_of = 2025-12-30`, not the wall clock (§3.1)
- `exception` does not count as late by default; the convention is configurable and every answer using `delay_rate` states which applied
- "Revenue" means gross of promotional discount; net is available and the panel says which was used
- The Jan→Dec volume decline is a generator artefact, not a business trend (§8.4)
- Brand items inherited from the existing product and left unresolved: the button green (123.5°) and logo mark (150°) differ visibly; Track & Trace uses uppercase KPI labels where this spec is sentence case (`DESIGN.md` §3.3, §9)

**Limitations**

- **No promised delivery date exists.** Lateness is a recorded status, not a computed comparison, so "which orders are late right now" is unanswerable rather than approximated
- **`in_transit` is temporally incoherent.** The 27 open orders span all twelve months with no capture timestamp; in-transit and canceled counts cannot be trended or presented as a live backlog
- **No SKU-level forecasting** (§8.1)
- **No cost, margin or freight-rate columns** — those questions are refused, not estimated
- **No customer master data** — only `client_id`
- **Most breakdowns are not statistically distinguishable.** Only carrier is even borderline (χ² p = 0.053); region, category, warehouse and promo all land above 0.65. The sufficiency guard enforces this rather than letting a leaderboard imply signal that is not there
