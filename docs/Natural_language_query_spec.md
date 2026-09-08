# Natural Language Analytics — Technical Specification

**Version:** 0.2
**Dataset:** `mock_logistics_data.csv` — 400 rows, 17 columns, order grain, calendar year 2025
**Changes from 0.1:** semantic layer derived from the actual dataset; planner uses tool calling; raw-SQL usage promoted to a first-class observability surface feeding semantic layer growth.

---

## 1. Design principle

The model turns a question into a **structured query spec (IR)**. Everything downstream is deterministic: validation, SQL compilation, chart selection, forecasting. The IR doubles as the query plan shown to the user, which is what makes explainability fall out of the architecture instead of being bolted on.

```
Question ──► Planner (LLM, tool call) ──► Query IR ──► Validator ──► Compiler ──► Warehouse
                                                                          │
                                                                          ├──► Chart selector (rules)
                                                                          └──► Forecast service (compute)
```

Two escape valves, both second-class and both logged:

- **Raw SQL** for questions the layer can't express. Marked untrusted, and every use is a coverage signal (§8).
- **Clarification** when the planner can't resolve an ambiguity.

### 1.1 Architecture guidelines — conformance

Stakeholder guidelines and where this design meets them.

| Guideline | Where it is met |
|---|---|
| Avoid executing raw AI-generated SQL without validation | §7.2. Raw SQL is off the default path entirely — it triggers only after the planner fails at both tiers *and* the user explicitly opts in. When it runs: AST-parsed by a real SQL parser, single `SELECT` only, table allowlist, forced `LIMIT`, `EXPLAIN` cost ceiling, read-only role, statement timeout |
| Prefer structured query generation | §4–5. The IR is the primary and default path. The planner emits a schema-constrained object through a forced tool call and never writes SQL on the verified path |
| Separate AI interpretation, data computation, business logic | §1.2 below |

### 1.2 The three layers

| Layer | Contains | Never contains |
|---|---|---|
| **Business logic** | Semantic layer YAML, glossary, `unanswerable` patterns, parameters, time anchor | Prompts, SQL, application code |
| **AI interpretation** | Question → IR; answer prose from a result set | Metric definitions, thresholds, date arithmetic, SQL |
| **Computation** | Validator, compiler, executor, chart rules, forecast service, sufficiency guard | Model calls, business definitions |

The governing invariant: **the AI layer reads business logic at runtime but never contains it; the computation layer executes business logic but never defines it.** Changing what "delayed" means is a one-file edit in the business layer — no prompt change, no code deploy.

**Conformance tests.** Three checks that make the separation verifiable rather than aspirational, and that belong in CI:

1. Flip `exception_counts_as_late`. Results change, no prompt edited, no code deployed. → business logic is separated
2. Swap the planner model. Two identical IRs must produce byte-identical results regardless of which model produced them. → interpretation is separated
3. Take a stored IR, disable the model entirely, execute. The full answer returns, minus the prose. → computation is separated

### 1.3 Boundary crossings

Three places the separation is deliberately imperfect. Named here rather than left for a reviewer to find.

**Answer prose is model-written.** Constrained to figures present in the result set and further constrained by the sufficiency guard (§9.1), but it is the AI layer touching user-facing output. Mitigation where this is unacceptable: a deterministic template with the model as an optional rewriter, switchable per deployment. The template must exist either way, because the model rewrites *it* rather than the raw numbers.

**The glossary travels into the prompt.** Unavoidable — the planner cannot map "courier" to `carrier` without being told. Acceptable only under one condition: the glossary is a versioned artifact injected at runtime and never hand-edited inside a prompt string. `glossary_version` is logged on every request as the audit trail.

**Raw SQL bypasses the business layer entirely.** This is the deliberate violation, and the trust marking (§7.3) is its accounting. Be direct about what §7.2 validation covers: it is syntactic and safety validation, not correctness validation. A parsed, permitted, cheap query can still compute the wrong number, and no automated check will catch that. This is precisely why unverified answers cannot be pinned to a dashboard or used as forecast input, and why every use is logged as a coverage gap to be closed (§8).

---

## 2. What the dataset actually supports

Three properties of this data drive most of the design. Each one invalidates an assumption a generic NL-analytics system would make, so they come before the layer itself.

### 2.1 There is no promised delivery date

Delay is a **status value**, not a computed comparison. `status` takes five mutually exclusive values:

| status | rows | has `delivery_date` | mean transit days |
|---|---|---|---|
| `delivered` | 304 | yes | 3.3 |
| `delayed` | 55 | yes | 6.1 |
| `exception` | 11 | yes | 8.5 |
| `in_transit` | 27 | no | — |
| `canceled` | 3 | no | — |

The consequence: **`delayed` orders are not inside `delivered`.** A delay rate computed as `delayed / delivered` is wrong — it inflates the rate by excluding late orders from their own denominator. The correct denominator is completed deliveries: `delivered + delayed + exception`.

This is exactly the class of error the semantic layer exists to prevent, so `delay_rate` is declared as a ratio metric and the model is never in a position to construct the denominator itself.

There is also no way to answer "which orders are late *right now*" — an `in_transit` order carries no promised date, so lateness is unknowable until it resolves. The planner must refuse this rather than approximate it.

### 2.2 The data ends 2025-12-30; today is 2026-09-07

Every relative range anchored to `now()` returns zero rows. Relative ranges therefore resolve against a configured **`data_as_of`** anchor, not the wall clock:

```yaml
time_anchor:
  mode: max_data_date        # max_data_date | now
  field: order_date
  value: 2025-12-30          # refreshed on each load

snapshot_now: null           # when open statuses were captured — NOT derivable here
```

"Last 3 months" means Oct–Dec 2025. The explainability panel states the anchor and the resolved absolute range on every answer so nobody mistakes it for live data. Switch to `mode: now` when this runs against a real feed.

These are two different clocks and the distinction matters. `data_as_of` is the latest data present, and it is derivable. `snapshot_now` is the moment open statuses were captured, and **this dataset has no coherent value for it** (§2.5). Never derive one from the other.

### 2.3 Forecasting is viable at category level, not SKU level

355 distinct SKUs across 400 orders — a mean of 1.13 orders per SKU, maximum 3. Per-SKU forecasting is arithmetically impossible on this data. Monthly order counts by category run 0–18 with several zero months, so category-level forecasts have 12 points and high variance.

| Grain | Series available | Points per series | Verdict |
|---|---|---|---|
| Total | 1 | 12 | Usable |
| Region | 5 | 12 | Usable, noisy |
| Category | 8 | 12 | Usable, several zero months |
| SKU | 355 | ~1 | Impossible |

The forecast service enforces this rather than returning a confident-looking line through noise (§6.3).

### 2.4 Shape

Single denormalized table, order grain, one row per `order_id`. **No joins are required**, which means the fan-out double-counting risk from v0.1 is currently zero. The join declaration syntax is retained for when this becomes a real warehouse, but don't build the fan-out guard yet — it has nothing to guard against.

Hierarchies present, all strict:

- `warehouse` → `origin_city` is 1:1 (9 each)
- `destination_city` → `origin_city` is many:1; every destination is served from exactly one origin, so a lane and a destination city are the same thing
- `region` groups origin cities: EU (Amsterdam, Berlin), UK (London), US-C (Chicago, Dallas), US-E (Atlanta, Newark), US-W (Los Angeles, San Francisco)

**`region` is an origin region, not a destination region.** Name it accordingly in the layer or users will misread every regional breakdown.

### 2.5 Known defects in the mock data

This is generated data and parts of it are not internally consistent. Build against it, but do not calibrate thresholds to it and do not treat any finding in it as a business fact.

**`in_transit` is temporally incoherent.** The 27 in-transit orders are distributed evenly across all twelve months. The oldest was placed 2025-01-03, and 293 orders placed after it have already delivered. No snapshot date makes this valid — status was assigned independently of the dates. Consequences:

- `snapshot_now` stays null; there is nothing to infer
- `in_transit_count` and `canceled_count` are declared `point_in_time: false` and cannot be trended, grouped by a time grain, or presented as a live operational figure
- Any question of the form "how many are in transit right now" returns `unanswerable`

**Terminal statuses are coherent.** Mean transit days are 3.25 (`delivered`), 6.11 (`delayed`), 8.45 (`exception`) — the generator keyed these off duration, so `delay_rate` carries real signal.

**Dimensional breakdowns of delay are mostly noise.** χ² against `delayed`: carrier 0.053, origin region 0.945, product category 0.949, warehouse 0.983, promo 0.887. Only carrier is even borderline, and its ranking is driven by tiny samples — GLS shows 25% from 8 completed deliveries, DPD shows 0% from 18.

The product-level response to this is §9.1, a sufficiency guard. It is not a caveat about the mock data; small groups will exist in production too, and "which carrier is worst" is the most likely question this system will ever be asked.

---

## 3. Semantic layer

Version-controlled YAML. The only place business logic lives.

### 3.1 Dataset

```yaml
datasets:
  orders:
    label: Orders
    description: One row per customer order, from placement to final status.
    base_table: analytics.fct_orders
    primary_key: order_id
    grain: order
    joins: []            # single denormalized table; none required
    row_count: 400
    coverage:
      order_date: [2025-01-01, 2025-12-30]
      delivery_date: [2025-01-02, 2025-12-31]
```

### 3.2 Parameters

```yaml
parameters:
  completed_statuses: ['delivered', 'delayed', 'exception']
  open_statuses: ['in_transit']
  exception_counts_as_late: false

  min_group_size:
    default: 30
    carrier: 30
    origin_region: 30
    client_id: 20
    lane: 10
    destination_city: 10
    sku: null            # never a valid reporting grain on this dataset

  priority_quadrant:
    rate_threshold: metric.on_time_rate   # the overall rate, computed not fixed
    volume_threshold_pct:
      default: 10
      carrier: 10
      origin_region: 15
      lane: 3
      client_id: 5
```

`min_group_size` is **per dimension**, not global. A single number cannot work here: 30 is right for carrier, but no lane reaches 30 on this dataset (mean 8.5 completed deliveries per lane), so a global 30 would mute every lane and make the breakdown useless. Where a dimension's threshold is below the default, the UI states it — "minimum sample for lane is 10; no lane reaches 30, so rates are indicative" — rather than quietly lowering the bar.

`priority_quadrant` defines the shaded region in the breakdown scatter (`chart-design-spec-v0.4.md` §6.1). The rate threshold is the computed overall rate for whatever filters are active, never a hardcoded number. The volume threshold varies by dimension because 10% of volume is a large carrier and an impossible lane.

`exception_counts_as_late` is the one genuinely contested definition here. Exceptions average 8.5 transit days against 3.3 for clean deliveries, so operationally they are late — but they may be late for reasons outside the carrier's control (customs, refusal, damage). Default `false`, exposed as config, and every answer using `delay_rate` states which convention applied.

### 3.3 Metrics

```yaml
metrics:

  # --- Volume ---
  order_count:
    label: Orders
    agg: count_distinct
    expr: fct_orders.order_id
    format: integer

  completed_count:
    label: Completed deliveries
    agg: count_distinct
    expr: fct_orders.order_id
    filter: fct_orders.status IN ('delivered','delayed','exception')
    format: integer
    notes: Orders that reached a final delivery outcome. Excludes in-transit and canceled.

  on_time_count:
    label: On-time deliveries
    agg: count_distinct
    expr: fct_orders.order_id
    filter: fct_orders.status = 'delivered'
    format: integer

  delayed_count:
    label: Delayed orders
    agg: count_distinct
    expr: fct_orders.order_id
    filter: fct_orders.status = 'delayed'
    format: integer
    notes: >
      Status-flagged as delayed. This dataset has no promised delivery date,
      so lateness is a recorded outcome rather than a computed one.

  exception_count:
    label: Exceptions
    agg: count_distinct
    expr: fct_orders.order_id
    filter: fct_orders.status = 'exception'
    format: integer

  in_transit_count:
    label: In transit
    agg: count_distinct
    expr: fct_orders.order_id
    filter: fct_orders.status = 'in_transit'
    format: integer
    point_in_time: false
    notes: >
      Open status with no capture timestamp. In this dataset in-transit orders
      span the full year, so this is a count of a label, not a live backlog.
      Cannot be trended or grouped by a time grain.

  canceled_count:
    label: Canceled orders
    agg: count_distinct
    expr: fct_orders.order_id
    filter: fct_orders.status = 'canceled'
    format: integer
    point_in_time: false

  # --- Service quality ---
  delay_rate:
    label: Delay rate
    agg: ratio
    numerator: delayed_count
    denominator: completed_count
    format: percent
    null_policy: null_when_denominator_zero
    notes: >
      Delayed orders as a share of completed deliveries. Delayed and delivered
      are mutually exclusive statuses, so the denominator is all completed
      orders, not just on-time ones.

  on_time_rate:
    label: On-time rate
    agg: ratio
    numerator: on_time_count
    denominator: completed_count
    format: percent

  exception_rate:
    label: Exception rate
    agg: ratio
    numerator: exception_count
    denominator: completed_count
    format: percent

  cancellation_rate:
    label: Cancellation rate
    agg: ratio
    numerator: canceled_count
    denominator: order_count
    format: percent
    notes: >
      Denominator is all orders, not completed deliveries — a canceled order
      never reaches completion, so it cannot be a share of completions.

  # --- Speed ---
  avg_transit_days:
    label: Average transit days
    agg: avg
    expr: (fct_orders.delivery_date - fct_orders.order_date)
    filter: fct_orders.delivery_date IS NOT NULL
    format: days_1dp
    notes: Order date to delivery date. Only completed orders contribute.

  p90_transit_days:
    label: 90th percentile transit days
    agg: percentile
    percentile: 0.90
    expr: (fct_orders.delivery_date - fct_orders.order_date)
    filter: fct_orders.delivery_date IS NOT NULL
    format: days_1dp

  max_transit_days:
    label: Slowest delivery
    agg: max
    expr: (fct_orders.delivery_date - fct_orders.order_date)
    filter: fct_orders.delivery_date IS NOT NULL
    format: days_1dp

  # --- Commercial ---
  gross_revenue:
    label: Gross revenue
    agg: sum
    expr: fct_orders.order_value_usd
    format: currency_usd
    notes: >
      order_value_usd equals quantity x unit_price_usd. It does NOT have the
      promo discount applied. Use net_revenue for post-discount figures.

  net_revenue:
    label: Net revenue
    agg: sum
    expr: fct_orders.order_value_usd * (1 - fct_orders.promo_discount_pct / 100.0)
    format: currency_usd

  promo_discount_value:
    label: Discount given
    agg: sum
    expr: fct_orders.order_value_usd * (fct_orders.promo_discount_pct / 100.0)
    format: currency_usd

  units_ordered:
    label: Units
    agg: sum
    expr: fct_orders.quantity
    format: integer

  avg_order_value:
    label: Average order value
    agg: ratio
    numerator: gross_revenue
    denominator: order_count
    format: currency_usd

  promo_order_count:
    label: Promo orders
    agg: count_distinct
    expr: fct_orders.order_id
    filter: fct_orders.is_promo = 1
    format: integer

  promo_share:
    label: Promo share of orders
    agg: ratio
    numerator: promo_order_count
    denominator: order_count
    format: percent
```

Gross versus net revenue is a live trap in this data: `order_value_usd` equals `quantity × unit_price_usd` exactly, gross of the discount, and 22 orders carry discounts of 5–34%. A user asking for "revenue" gets gross by glossary default, and the explainability panel says so.

### 3.4 Dimensions

```yaml
dimensions:
  carrier:
    label: Carrier
    expr: fct_orders.carrier
    type: categorical
    values: [DHL, DPD, FedEx, GLS, LaserShip, OnTrac, Royal Mail, UPS, USPS]

  origin_region:
    label: Origin region
    expr: fct_orders.region
    type: categorical
    values: [EU, UK, US-C, US-E, US-W]
    notes: Region of the originating warehouse, not the destination.

  origin_city:
    label: Origin city
    expr: fct_orders.origin_city
    type: categorical
    approx_cardinality: 9
    parent: origin_region

  destination_city:
    label: Destination city
    expr: fct_orders.destination_city
    type: categorical
    approx_cardinality: 47
    notes: Each destination is served by exactly one origin, so this is equivalent to a lane.

  warehouse:
    label: Warehouse
    expr: fct_orders.warehouse
    type: categorical
    approx_cardinality: 9
    parent: origin_city
    notes: One warehouse per origin city in this dataset.

  lane:
    label: Lane
    expr: fct_orders.origin_city || ' → ' || fct_orders.destination_city
    type: categorical
    approx_cardinality: 47

  order_status:
    label: Status
    expr: fct_orders.status
    type: categorical
    values: [delivered, delayed, in_transit, exception, canceled]

  product_category:
    label: Product category
    expr: fct_orders.product_category
    type: categorical
    values: [BOOK, BRUSH, CRAYON, MARKER, PAINT, PAPER, PENCIL, STICKER]

  sku:
    label: SKU
    expr: fct_orders.sku
    type: categorical
    approx_cardinality: 355
    high_cardinality: true
    parent: product_category
    notes: 1.13 orders per SKU on average. Not usable as a trend or forecast grain.

  client_id:
    label: Client
    expr: fct_orders.client_id
    type: categorical
    approx_cardinality: 30

  is_promo:
    label: Promotional order
    expr: fct_orders.is_promo
    type: boolean
    value_labels: { 0: 'Standard', 1: 'Promotional' }
```

### 3.5 Time dimensions

```yaml
time_dimensions:
  order_date:
    label: Order date
    expr: fct_orders.order_date
    default: true
    coverage: [2025-01-01, 2025-12-30]

  delivery_date:
    label: Delivery date
    expr: fct_orders.delivery_date
    coverage: [2025-01-02, 2025-12-31]
    nullable: true
    notes: >
      Null for in-transit and canceled orders. Filtering or grouping by this
      field silently excludes 30 of 400 orders. Surfaced as a warning whenever used.
```

The `notes` on `delivery_date` aren't decoration — they render in the explainability panel whenever that field is selected. "Delayed orders last month" grouped by delivery date quietly drops every unresolved order, and the user should be told.

### 3.6 Glossary

```yaml
glossary:
  - terms: [late, delayed, overdue, missed SLA, behind schedule]
    maps_to: metric.delayed_count
  - terms: [on time, OTIF, punctual]
    maps_to: metric.on_time_rate
  - terms: [shipper, courier, 3PL, transporter, delivery company]
    maps_to: dimension.carrier
  - terms: [lane, route, corridor]
    maps_to: dimension.lane
  - terms: [DC, FC, fulfilment centre, depot]
    maps_to: dimension.warehouse
  - terms: [revenue, sales, turnover, GMV]
    maps_to: metric.gross_revenue
    note: Gross of promotional discount. Use net_revenue when the user says "net" or "after discount".
  - terms: [region, territory, market]
    maps_to: dimension.origin_region
    note: Origin region. If the user clearly means destination, clarify rather than guess.
  - terms: [problem orders, issues, failures]
    maps_to: metric.exception_count
    note: Ambiguous. Prefer clarify between exceptions, delays, and cancellations.

unanswerable:
  - pattern: currently late / late right now / running behind
    reason: >
      No promised delivery date exists. Lateness is only known once an order
      reaches a final status. Offer historical delay rate instead.
  - pattern: cost, margin, profit, shipping spend, freight rate
    reason: No cost columns in this dataset.
  - pattern: customer name, address, contact details
    reason: Only client_id is present; no customer master data.
  - pattern: destination region, delivery region
    reason: >
      region is the origin region. Destination has city granularity only,
      with no region rollup available.
```

The `unanswerable` block does real work. Without it the planner will cheerfully map "which orders are running late" onto `delayed_count`, answering a different question with a plausible number.

---

## 4. Query IR

### 4.1 Schema

```json
{
  "version": "1.0",
  "intent": "aggregate | scalar | forecast | clarify | unanswerable",
  "dataset": "orders",
  "metrics": ["delay_rate", "completed_count"],
  "dimensions": ["carrier"],
  "time": {
    "field": "order_date",
    "grain": "month",
    "range": { "kind": "relative", "n": 3, "unit": "month", "complete_periods": true }
  },
  "filters": [
    { "field": "origin_region", "op": "in", "value": ["US-E", "US-W"] }
  ],
  "sort": [{ "by": "delay_rate", "dir": "desc" }],
  "limit": 20,
  "chart_hint": null,
  "confidence": 0.86,
  "interpretation": "Monthly delay rate by carrier over the last 3 months of data, US East and West origins only."
}
```

### 4.2 Field rules

| Field | Rules |
|---|---|
| `metrics` | 1–4, all must exist in the layer |
| `dimensions` | 0–2. Three or more is nearly always a misparse — reject and clarify |
| `time.grain` | `day \| week \| month \| quarter \| year`. Sub-day is meaningless here; dates carry no time component |
| `time.range.kind` | `relative`, `absolute`, `all_time` |
| `filters[].op` | `eq, neq, in, not_in, gt, gte, lt, lte, between, is_null, is_not_null` |
| `limit` | Default 100, cap 5000 (whole dataset is 400 rows, so this never binds today) |
| `confidence` | Below 0.5 routes to `clarify` |

### 4.3 Relative time resolution

Anchored to `data_as_of` (§2.2), not `now()`.

| Phrase | Resolution against anchor 2025-12-30 |
|---|---|
| "last month" | 2025-11-01 → 2025-11-30 |
| "last 3 months" | 2025-10-01 → 2025-12-31 |
| "past 30 days" | 2025-12-01 → 2025-12-30 |
| "this month" | 2025-12-01 → 2025-12-30, `partial_period: true` |
| "last year" / "2025" | 2025-01-01 → 2025-12-31 |

`complete_periods: true` (the default for "last N months") excludes the current partial period. Any range including a partial period sets `partial_period: true` and the UI marks the incomplete bar. December 2025 is itself partial — it ends on the 30th — so this fires more often here than you'd expect.

All resolution happens in the configured tenant timezone, stated in the explainability panel.

---

## 5. Planner

### 5.1 Tool calling

The planner is a **single tool call**, not an agent loop. OpenRouter normalises the tool-calling interface across models and providers, so the envelope is portable. What isn't portable is the number of decisions per turn — a multi-turn loop where the model picks among several tools and reacts to intermediate results is where behavioural differences between models show up, and it buys nothing here because routing is a single enum on the IR.

```
tools:        [ submit_query_plan ]      # one tool, JSON Schema = the IR
tool_choice:  { type: "function", function: { name: "submit_query_plan" } }
strict:       true
provider:     { require_parameters: true }
```

Three settings worth being deliberate about:

- **`tool_choice` forced** to the one tool. The planner never decides *whether* to answer — it always emits a plan, and `intent` carries the routing.
- **`strict: true`** for schema-conformant decoding where the provider supports it.
- **`provider.require_parameters: true`** so OpenRouter only routes to providers that honour the parameters you sent. Without it a request can be served by a provider that ignores `strict`, and you get a shape violation from a model you believed was constrained.

Schema conformance is not semantic validity. A structurally perfect IR can still name a metric that doesn't exist, so §5.4 validation runs regardless of `strict`.

### 5.2 Prompt payload

1. Rules — emit only via the tool, never invent a metric or dimension name, prefer `clarify` over guessing
2. Rendered catalog: metric names, labels and `notes`; dimension names with `values` for low-cardinality ones
3. Glossary, including the `unanswerable` block
4. Time resolution table from §4.3, with the current `data_as_of`
5. 10–14 few-shot examples: scalar, time series, ranking, filtered comparison, forecast, ambiguous → clarify, out-of-scope → unanswerable, and at least two exercising the delivered/delayed denominator trap

### 5.3 Model routing

```
Tier 1: fast model  →  validate  →  ok? done
                          │ fail
                          ▼
Tier 2: stronger model, validator errors appended to the prompt
                          │ fail
                          ▼
                    intent = clarify
```

One retry per tier, then stop. Keep a `Planner` interface with an OpenRouter implementation behind it — the lock-in worth avoiding is prompt-and-catalog lock-in, not SDK lock-in.

### 5.4 Validator

| Check | Error code |
|---|---|
| Metric / dimension exists | `unknown_field` |
| Dimensions ≤ 2, metrics ≤ 4 | `too_many_fields` |
| Filter op legal for field type | `invalid_operator` |
| Filter value in declared `values` | `invalid_value` |
| `sku` used as a grain without a filter | `unbounded_scan` |
| Time grain present when the result is a trend | `missing_grain` |
| Requested range intersects dataset coverage | `out_of_coverage` |
| Limit within cap | `limit_exceeded` |

`out_of_coverage` deserves its own user-facing message. "That period is outside the data, which covers Jan–Dec 2025" beats an empty chart every time.

### 5.5 Caching

Key on `normalized_question + layer_version + glossary_version + data_as_of`. Cache the IR, not the result. TTL 30 days, invalidated by any layer commit.

---

## 6. Compilation, charts, forecasting

### 6.1 Compiler

1. No joins on this dataset; emit against `fct_orders` directly.
2. Metric-level `filter` clauses compile to `FILTER (WHERE ...)` inside the aggregate — **never** to a `WHERE` clause. `delayed_count` and `completed_count` routinely appear in the same query, and a `WHERE` would corrupt the sibling. This is the single most important compiler rule.
3. Ratio metrics emit `numerator / NULLIF(denominator, 0)` at the final grain, never an average of per-row ratios.
4. Query-level filters → `WHERE`. `GROUP BY` all dimensions plus the truncated time expression. Then `ORDER BY`, then `LIMIT`.
5. Execute as a read-only role, 15s statement timeout, request ID in a SQL comment.

Illustrative output for "delay rate by carrier":

```sql
SELECT
  carrier,
  COUNT(DISTINCT order_id) FILTER (WHERE status = 'delayed')                          AS delayed_count,
  COUNT(DISTINCT order_id) FILTER (WHERE status IN ('delivered','delayed','exception')) AS completed_count,
  COUNT(DISTINCT order_id) FILTER (WHERE status = 'delayed')::numeric
    / NULLIF(COUNT(DISTINCT order_id) FILTER (WHERE status IN ('delivered','delayed','exception')), 0)
                                                                                       AS delay_rate
FROM analytics.fct_orders
GROUP BY carrier
ORDER BY delay_rate DESC
LIMIT 20;
```

### 6.2 Chart selection

Deterministic rules over result shape. No model call.

| Shape | Chart |
|---|---|
| 1 metric, 0 dims, no time | Big number |
| 1 metric, 0 dims, time grain | Line |
| 1 metric, 1 dim, no time, ≤ 12 categories | Horizontal bar, sorted desc |
| 1 metric, 1 dim, no time, > 12 categories | Top 10 + "other", link to table |
| 1 metric, 1 dim, time grain, dim ≤ 5 values | Multi-series line |
| 1 metric, 1 dim, time grain, dim > 5 values | Top 5 by total, rest collapsed |
| 2 metrics, time grain | Dual axis only if units differ |
| 2 metrics, 1 dim, no time | Scatter |
| Forecast | Line: history solid, forecast dashed, shaded interval |
| Anything else | Table |

Counts start at zero. Percent metrics get a 0–100% axis unless the spread is under 20 points. Bars go horizontal when any label exceeds 12 characters — which, with labels like "San Francisco, CA → Sacramento, CA", is most lane charts.

### 6.3 Forecast service

Dispatched on `intent: "forecast"`. Parameter extraction is the model's only role.

```json
{
  "intent": "forecast",
  "target_metric": "units_ordered",
  "series_filters": [{ "field": "product_category", "op": "eq", "value": "CRAYON" }],
  "time": { "field": "order_date", "grain": "month" },
  "horizon": { "n": 4, "unit": "month" },
  "history_window": { "n": 12, "unit": "month" },
  "method": "auto",
  "inventory": { "lead_time_days": 21, "service_level": 0.95, "current_on_hand": null }
}
```

**Pipeline.** Fetch history through the normal compiled path — no separate query builder. Zero-fill missing periods; a month with no orders is real demand information. Then run the guards, select a method by backtest, refit, project, compute inventory.

**Guards, tuned to this dataset:**

| Condition | Behaviour |
|---|---|
| `sku` in `series_filters` | Refuse. Mean 1.13 orders per SKU — return `insufficient_history` and offer the parent category series |
| History periods < 8 | Refuse with the actual count |
| History periods < 2 × horizon | Cap the horizon and say so |
| More than 30% zero periods | Proceed but downgrade to `moving_average`, widen intervals, set `sparse_series: true` |
| Total observations < 24 | Attach a low-confidence banner |

With 12 monthly points, a 4-month horizon sits exactly at the 2× guard. The service should return that forecast, and it should look visibly uncertain — wide bands are the honest output here, not a defect. BRUSH and MARKER both have zero months in 2025, so the sparse-series path will fire in normal use.

**Method selection.** Hold out the last `min(horizon, 4)` periods, fit `moving_average`, `linear_trend`, `ses` and `holt` on the remainder, score by MAPE (MAE when any actual is zero), pick the winner, refit on full history. Ties within 2% go to the simpler model. Return all candidate scores — showing the models that lost is what makes the winner credible.

**Intervals.** Residual standard deviation from the backtest, widened by `sqrt(h)` at step h. Report 80% and 95%. Never narrower than backtest error.

**Inventory.**

```
σ_LT          = σ_period × sqrt(lead_time_days / days_per_period)
z             = inverse normal CDF(service_level)
safety_stock  = z × σ_LT
demand_LT     = forecast summed over the lead-time window
reorder_point = demand_LT + safety_stock
order_up_to   = demand over (lead_time + review_period) + safety_stock
suggested_qty = max(0, order_up_to − current_on_hand)     # only when on_hand supplied
```

When `current_on_hand` is null, return the reorder point and order-up-to level, and state that a quantity requires current stock. Do not guess it.

**Explanation.** Generated from a template filled with the chosen method, its backtest error, the losing candidates and the history window. The model may rewrite that template into prose; it never sees the raw series and never produces a number.

---

## 7. Raw SQL escape hatch

For questions the layer can't express. Explicitly second-class.

### 7.1 Trigger

Only after the planner has failed at both tiers, and only on an explicit user action ("try anyway"). Never automatic, never first.

### 7.2 Guards

- Read-only role, 15s timeout, same as the verified path
- Parse with a real SQL parser, not a regex. Reject anything that isn't a single `SELECT`: no DDL, DML, multiple statements, writing CTEs, `COPY`
- Table allowlist: analytics schema only
- Forced `LIMIT 1000` if absent
- `EXPLAIN` cost ceiling
- Per-user rate limit, lower than the verified path

### 7.3 Trust marking

Every response carries `trust: "verified" | "unverified"`. Unverified responses must:

- Show a persistent banner: "Generated by writing SQL directly. Not checked against defined metrics — verify before acting on it."
- Show the SQL expanded by default, not behind a disclosure
- **Not be pinnable** to a dashboard
- **Not be usable** as forecast input
- Not be cached beyond the session

The pinning restriction is what stops unverified answers laundering into trusted artifacts once someone saves them.

---

## 8. Coverage observability

Raw SQL usage is not an error log. It is the product's roadmap, and it is instrumented as a first-class telemetry surface.

The loop: a question that repeatedly falls through to raw SQL is a **missing semantic layer object**. Capture it, cluster it, rank it, promote it, and verify the promotion actually closed the gap.

### 8.1 Query log

Every request writes one row, regardless of path.

```sql
CREATE TABLE nl_query_log (
  request_id            TEXT PRIMARY KEY,
  occurred_at           TIMESTAMPTZ NOT NULL,
  user_id               TEXT NOT NULL,
  team                  TEXT,

  question_raw          TEXT NOT NULL,
  question_normalized   TEXT NOT NULL,
  question_embedding    VECTOR(1024),

  path                  TEXT NOT NULL,   -- ir | raw_sql | clarify | unanswerable | planner_failed
  trust                 TEXT NOT NULL,   -- verified | unverified | none
  intent                TEXT,

  ir                    JSONB,
  generated_sql         TEXT,
  sql_features          JSONB,           -- see 8.2

  validator_errors      JSONB,
  clarify_reason        TEXT,

  model_tier            SMALLINT,
  model_id              TEXT,
  planner_latency_ms    INT,
  query_latency_ms      INT,
  row_count             INT,
  returned_empty        BOOLEAN,

  layer_version         TEXT NOT NULL,
  glossary_version      TEXT NOT NULL,
  data_as_of            DATE NOT NULL,

  user_feedback         SMALLINT,        -- -1 | 0 | +1
  feedback_note         TEXT,
  followed_by_rephrase  BOOLEAN          -- same user, similar question, within 5 min
);

CREATE INDEX ON nl_query_log (path, occurred_at);
CREATE INDEX ON nl_query_log USING ivfflat (question_embedding vector_cosine_ops);
```

Two fields earn their place beyond the obvious. `returned_empty` catches verified queries that ran perfectly and answered nothing — usually a coverage or date-range problem, invisible if you only watch error rates, and near-certain on this dataset given the 2025/2026 gap. `followed_by_rephrase` is the strongest implicit dissatisfaction signal you'll get, because almost nobody clicks thumbs-down; they just ask again differently.

### 8.2 SQL feature extraction

Reading questions tells you what people wanted. Parsing the generated SQL tells you **what the layer was missing**, mechanically. On every raw-SQL response, parse the AST and record:

```json
{
  "tables": ["analytics.fct_orders"],
  "columns_referenced": ["promo_discount_pct", "unit_price_usd", "quantity", "client_id"],
  "aggregates": [
    { "fn": "sum", "arg": "quantity * unit_price_usd * promo_discount_pct / 100" }
  ],
  "group_by": ["client_id"],
  "filters": [{ "column": "order_date", "op": "between" }],
  "window_functions": [],
  "unmapped_columns": [],
  "unmapped_expressions": ["quantity * unit_price_usd * promo_discount_pct / 100"]
}
```

`unmapped_expressions` is the payoff: an aggregate expression that recurs across raw-SQL queries and matches no declared metric **is** the missing metric, already written in SQL. The gap report can propose the YAML rather than merely flag that a gap exists.

A `group_by` column that isn't a declared dimension is a missing dimension. A `window_functions` entry means the IR needs an operation it doesn't have — a different and larger class of gap.

### 8.3 Clustering

Weekly job over the last 90 days of `path IN ('raw_sql','clarify','planner_failed')`, plus any row with `returned_empty` or negative feedback.

1. Embed `question_normalized`
2. Agglomerative clustering, cosine distance, threshold ~0.15, minimum cluster size 3
3. Per cluster compute: question count, distinct users, distinct teams, mean feedback, rephrase share, and the union of `unmapped_columns` / `unmapped_expressions`
4. Label with the medoid question plus a one-line model-written summary — this is presentation, not decision-making, so a cheap model is fine

### 8.4 Gap taxonomy

Each cluster is classified from its SQL features, mechanically, before a human looks at it.

| Class | Signal | Fix |
|---|---|---|
| `missing_metric` | `unmapped_expressions` non-empty, aggregates present | Add a metric |
| `missing_dimension` | `group_by` references an unmapped column | Add a dimension |
| `missing_time_grain` | Date truncation to a grain outside the IR enum | Extend the grain enum |
| `missing_operation` | Window functions, self-joins, cohort logic | IR feature work — larger |
| `glossary_gap` | Path was `clarify`; all SQL features map to existing objects | Add glossary terms |
| `source_gap` | References columns that don't exist in the source at all | Upstream data change |
| `out_of_scope` | Matches an `unanswerable` pattern | No action; the refusal was correct |
| `one_off` | Cluster size < 3, single user | No action; leave logged |

`glossary_gap` is the cheapest and most common fix, and the one you'd miss entirely if you only monitored raw SQL — those questions were expressible all along, the planner just didn't know the vocabulary.

### 8.5 Coverage report

Weekly, ranked by `distinct_users × log(question_count)` so a question asked once each by twelve people outranks one asked twelve times by a single power user.

```
COVERAGE GAP REPORT — week of 2026-08-31          layer v2026.08.19a

1. glossary_gap · 23 questions · 9 users · avg feedback −0.4
   "How much did we give away in promo discounts by client?"
   Unmapped expression: order_value_usd * promo_discount_pct / 100
   → metric.promo_discount_value ALREADY EXISTS and matches this expression.
   → Fix is vocabulary, not modelling. Add terms: give away, discount cost,
     promo spend, markdown

2. source_gap · 14 questions · 6 users
   "Delay rate by destination region"
   destination_city has no region rollup in the source
   → Requires a dimension table: destination_city → region. Upstream change.

3. missing_operation · 9 questions · 5 users
   "Which carriers got worse compared to last quarter?"
   Window functions: lag
   → IR feature: period-over-period comparison

4. out_of_scope · 6 questions · 4 users
   "What did shipping cost us last month?"
   → Correctly refused. No cost columns. No action.
```

Item 1 is the report doing its real job: the metric existed, the vocabulary didn't. Without SQL feature extraction that gets filed as "add a discount metric" and a duplicate ships.

### 8.6 Promotion workflow

1. Gap enters a review queue with its proposed YAML and its cluster's questions attached
2. A human approves, edits, or rejects — layer changes are code review, not an admin UI
3. Merge bumps `layer_version`
4. **Replay:** every logged question in the cluster is re-run against the new layer in CI. Each must now produce `path = 'ir'` and a valid IR. If any still falls through, the gap is not closed and the PR does not merge
5. Passing replays are appended to the golden eval set (§10), so the fix is permanently regression-tested
6. Original askers are notified that their question now works

Step 4 is what makes this a loop rather than a backlog. Without replay you'll add metrics that don't actually change planner behaviour, and the same cluster reappears next week.

### 8.7 Service level indicators

| SLI | Target | Alert |
|---|---|---|
| Verified answer rate | > 90% of answered questions | < 80% for 3 days |
| Raw-SQL fall-through | < 5% | > 10% weekly |
| Clarification rate | 5–15% | > 25% or < 2% |
| Empty verified results | < 3% | > 8% |
| Rephrase rate | < 10% | > 20% |
| Planner p95 latency | < 2.5s | > 5s |
| Top-20 cluster coverage | 100% within 2 sprints | any cluster open > 4 weeks |

Clarification rate is watched from both sides. Too low is not a win — it means the planner is guessing on ambiguous questions and returning confident wrong answers, which is the most expensive failure mode this system has.

### 8.8 The other direction

The same log identifies frequent **verified** questions. A question asked weekly by six people that resolves to a stable IR is a dashboard tile nobody has built yet. Surface those in the same report with a one-click pin, and the NL interface becomes how the fixed dashboard gets designed rather than a feature sitting beside it.

---

## 9. Response envelope

```json
{
  "request_id": "req_01J…",
  "trust": "verified",
  "answer": {
    "text": "LaserShip has the highest delay rate at 22.7% of completed deliveries, against a 14.9% average across all carriers.",
    "highlight": { "value": 0.227, "format": "percent" }
  },
  "chart": { "type": "bar", "spec": {} },
  "data": {
    "columns": [
      { "key": "carrier", "label": "Carrier", "type": "categorical" },
      { "key": "delay_rate", "label": "Delay rate", "type": "percent" },
      { "key": "completed_count", "label": "Completed deliveries", "type": "integer" }
    ],
    "rows": [],
    "row_count": 9,
    "truncated": false
  },
  "explain": {
    "interpretation": "Delay rate by carrier across all available data.",
    "metrics": [{
      "name": "delay_rate",
      "label": "Delay rate",
      "definition": "Orders with status 'delayed' divided by all completed deliveries (delivered, delayed, exception).",
      "notes": "Delayed and delivered are mutually exclusive statuses. Exceptions are not counted as delays under the current configuration."
    }],
    "dimensions": [{ "name": "carrier", "label": "Carrier" }],
    "filters": [],
    "time": {
      "field": "Order date",
      "range": "1 Jan 2025 – 30 Dec 2025",
      "anchor": "data_as_of 2025-12-30",
      "timezone": "Asia/Jakarta",
      "partial_period": false
    },
    "warnings": [
      "Sample sizes are small: the smallest carrier has 28 completed deliveries, so a difference of 3 orders moves its rate by about 11 points."
    ],
    "ir": {},
    "sql": "SELECT …",
    "layer_version": "v2026.08.19a",
    "row_count": 9,
    "execution_ms": 41
  }
}
```

Answer text is written from the returned result set, after execution. It never states a figure the query didn't return.

### 9.1 Sufficiency guard

Runs after execution, before the answer text is written. It is a deterministic check on the result set, not a model judgement, and it changes what the answer is allowed to claim. Visual treatment for each state is specified in `chart-design-spec-v0.4.md` §7.

**Small group check.** Any group whose denominator is below that dimension's `min_group_size` (§3.2) is flagged. The chart marks it; the warning names it and quantifies the sensitivity. Where the dimension's threshold sits below the default, the response states that too — a lane rate computed on 11 deliveries is reportable but not bankable, and the user should be told which it is.

**Ranking check.** When the IR sorts by a ratio metric and the answer text would name a leader, run a two-proportion test between the top group and the overall rate. If it doesn't clear p < 0.05, the answer must not assert a winner:

> Not: "GLS has the highest delay rate at 25%."
> Instead: "GLS shows the highest delay rate at 25%, but that's 2 of 8 completed deliveries — not enough to distinguish it from the 14.9% overall rate. USPS at 23.4% across 47 deliveries is the more meaningful signal."

**Flat-distribution check.** When a breakdown is requested and a χ² test across the groups returns p > 0.20, append: the differences shown are within what random variation would produce at these sample sizes.

Both checks feed `explain.warnings` and constrain the answer text template. This is the difference between a tool people trust and one that gets a carrier dropped over two orders — and it applies in production exactly as it does here, because thin slices are a property of segmentation, not of mock data.

```json
"sufficiency": {
  "min_group_n": 8,
  "groups_below_threshold": ["GLS", "DPD", "LaserShip", "Royal Mail", "OnTrac"],
  "ranking_significant": false,
  "ranking_test": { "method": "two_proportion", "p": 0.41 },
  "distribution_test": { "method": "chi_square", "p": 0.053 }
}
```

---

## 10. Evaluation

**Golden set:** 60–100 `(question, expected_IR)` pairs. Must include, at minimum:

- The delivered/completed denominator trap, phrased three different ways
- Gross vs net revenue
- `region` read as destination when it means origin
- "Which orders are late right now" → `unanswerable`
- A SKU-level forecast request → refused with a category fallback
- A date range outside 2025 → `out_of_coverage`
- A BRUSH or MARKER forecast → `sparse_series` path
- "How many orders are in transit right now" → `unanswerable`
- "Which carrier has the highest delay rate" → answer must not assert a winner (§9.1)
- "Delay rate by region" → flat-distribution warning fires
- Two questions that should clarify, and two adjacent ones that should not

Assert on **behaviour, not values**. "Warns that the top group has fewer than 30 deliveries" is a valid expectation; "returns GLS" is not — that's tuning to a mock dataset, and it will break the day real data arrives.

**Scoring:** exact IR match (after field-order normalisation), semantic match (different IR, same result set — counts as a pass), clarification precision and recall, hallucinated-field rate. Hallucinated fields must be zero; any nonzero value blocks release.

**Gate:** run against every candidate model and every layer change. A model swap that drops exact-match below baseline doesn't ship. Store results per model so provider choice is evidence-based rather than a preference.

---

## 11. Build order

1. Semantic layer + validator + compiler, tested with hand-written IR and no model at all
2. Chart selector over the compiler's output
3. Query log and SQL feature extraction — **before** the planner
4. Planner with the tool-call contract, one model, golden set alongside
5. Explainability panel wired to the real `explain` block
6. Forecast service with its guards
7. Model routing, caching, second tier
8. Raw SQL path, clustering job, coverage report

Steps 1 and 2 carry most of the correctness and contain no LLM. Step 3 before step 4 is deliberate: the coverage loop is worth more the earlier it starts, and retrofitting logging after launch throws away the most informative weeks of usage you will ever have.

The three conformance tests from §1.2 go into CI at step 4, once there is a model to swap out. Test 3 — execute a stored IR with the model disabled — is the cheapest of the three and the one most likely to catch a regression, because any leak of business logic into prompt or code will break it immediately.