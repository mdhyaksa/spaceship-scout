# Chart Area — Design Specification

**Version:** 0.5
**Scope:** Visual system for every chart, tile and data surface in the logistics dashboard and in NL query answers.
**Companion:** `docs/Natural_language_query_spec.md` — chart *selection* rules live in §6.2 there; this document covers how the selected chart looks. Product scope and the built/deferred split are in `docs/SPEC.md`.
**Changes from 0.4:** cross-references now use real filenames; the distribution chart's tail threshold is named and defined; the scatter states its switchable dimensions and its sample-size coverage caption.

---

## 1. Two rules that generate the rest

**Chroma is reserved for the brand.** `#10F080` at 88% saturation appears on the logo mark, one primary action, and the chat launcher — roughly half a percent of the screen in the existing product. Data color is muted: the delivered, in-transit and fulfilled icons all sit between 2% and 28% saturation. Following that discipline is what keeps a bright green from becoming wallpaper, and it is why nothing in this document uses `#10F080` as a chart mark.

**Shapes get fills, labels get pills.** A stacked bar or a series line needs marks that read as areas, which means a mid-lightness fill. A status label inside a table row needs a pale tint with dark text, exactly as Track & Trace already does. These are different jobs and they take different stops. Never substitute one for the other.

---

## 2. Surfaces

Sampled from the existing product. `#FFFFFF` is 46% of its pixels, `#F6F6F8` is 10%, `#141414` is 9%.

```css
--canvas:         #F6F6F8;   /* page */
--surface-card:   #FFFFFF;   /* tile, chart background */
--surface-rail:   #141414;   /* navigation rail */
--surface-inset:  #F1F1F4;   /* empty bar track, table zebra */

--border:         rgba(20, 20, 20, 0.09);
--border-strong:  rgba(20, 20, 20, 0.14);
--grid:           rgba(20, 20, 20, 0.07);
--axis:           rgba(20, 20, 20, 0.18);

--text-primary:   #141414;
--text-secondary: #5A5A5E;
--text-muted:     #8A8A90;
--text-on-rail:   #F3F3F3;
```

Cards carry a 0.5px border and no shadow. Page-to-card contrast is 1.08:1 — deliberately faint, with the border doing the separating.

---

## 3. Palette

### 3.1 Graphite ramp

The default ink for anything without semantic meaning. Most charts on this dashboard are graphite.

| Token | Value | On white |
|---|---|---|
| `graphite-900` | `#141414` | 18.4:1 |
| `graphite-700` | `#3A3A3F` | 11.3:1 |
| `graphite-600` | `#5E5E66` | 6.4:1 |
| `graphite-500` | `#87878F` | 3.6:1 |
| `graphite-400` | `#B4B4BC` | 2.1:1 |
| `graphite-300` | `#C8C8CE` | 1.8:1 |
| `graphite-200` | `#DCDCE1` | 1.4:1 |
| `graphite-100` | `#F1F1F4` | 1.1:1 |

### 3.2 Semantic families

Three hues, all inherited from the product's icons. `fill` is for shapes, `tint` and `text` are the pill pair.

| Family | Hue | fill | tint | text | Source |
|---|---|---|---|---|---|
| Green | 151° | `#45785F` | `#DEEDE6` | `#2F7553` | Delivered icon, unchanged |
| Amber | 42° | `#A88738` | `#F4EBD7` | `#82641C` | Exception icon, remapped (§4.1) |
| Amber deep | 42° | `#735C26` | `#E9DEC4` | `#7A5D1A` | Derived, same hue |
| Teal | 184° | `#5A999E` | `#DEECED` | `#317377` | In-transit icon, unchanged |
| Graphite | — | `#87878F` | `#F1F1F4` | `#4A4A50` | Fulfilled icon family |

Every `text` stop clears 4.5:1 against its own `tint`. Green and amber-deep fills clear 4.5:1 on white; amber and teal fills sit at 3.4:1 and 3.2:1, which is adequate for large areas but not for text or thin strokes.

### 3.3 Brand accent

`#10F080` — logo mark, one primary action per view, active nav indicator, focus rings, chat launcher. Never a chart mark, never text (1.52:1 on white), never more than one instance per tile. For large solid fills prefer the softer `#8CE191` the product already uses on buttons.

> **Open item.** The button green samples at hue 123.5° while the logo mark is 150°. That is a visible difference, not rounding. Worth resolving with whoever owns the brand before both are inherited into a new surface.

### 3.4 Sequential ramp

For intensity encodings — heatmaps, ordered buckets. Built on the green hue at the product's saturation, monotonic in luminance.

```
#EBF4F0  →  #CBE2D7  →  #9DC8B3  →  #69AB8B  →  #44795F
```

Never use the semantic families for ordered data.

### 3.5 Categorical series

For data with no inherent meaning and more than one series. Lightness-separated first, hue second, so it survives grayscale.

```
series-1  #3A3A3F   graphite-700
series-2  #45785F   green
series-3  #A88738   amber
series-4  #5A999E   teal
series-5  #B4B4BC   graphite-400
```

Five is the ceiling. Beyond that the selector collapses to top-4-plus-other (`Natural_language_query_spec.md` §6.2) rather than extending the ramp.

---

## 4. Roles

Chart code assigns a role. The theme resolves it. Never write a hex in chart code.

| Role | Family | Applies to |
|---|---|---|
| `positive` | Green | Delivered, on-time, favourable |
| `problem` | Amber | Delayed — the common failure |
| `problem-severe` | Amber deep | Exception |
| `open` | Teal | In transit, unresolved |
| `neutral` | Graphite 200 | Canceled, excluded |
| `ink` | Graphite 700 | Default single-series chart mark |
| `reference` | Graphite 900 | Targets, SLA lines, averages |
| `muted` | `#D4D4DA` | Below sufficiency threshold (§8.1) |

### 4.1 Status mapping

| Status | Role | Bar fill | Pill tint | Pill text |
|---|---|---|---|---|
| Delivered | `positive` | `#45785F` | `#DEEDE6` | `#2F7553` |
| Delayed | `problem` | `#A88738` | `#F4EBD7` | `#82641C` |
| Exception | `problem-severe` | `#735C26` | `#E9DEC4` | `#7A5D1A` |
| In transit | `open` | `#5A999E` | `#DEECED` | `#317377` |
| Canceled | `neutral` | `#E4E4E8` | `#F1F1F4` | `#4A4A50` |

Delivered and in-transit take the product's icon colors unchanged — they mean the same thing on both surfaces, so a user moving between them reads the same signal.

The amber is remapped. Track & Trace has no *delayed* state, and its exception icon amber becomes the dashboard's `problem` fill, with exception moving to a darker stop of the same hue. The reasoning: delayed is the more common failure (55 orders against 11), so it gets the more visible treatment, and darker-means-worse is legible without a legend. Reusing the icon amber for exception directly would have left delayed as the only colorless failure state, inverting the emphasis.

In transit takes a cool, non-judgmental color. It is not a failure — those orders simply haven't resolved — and the data cannot say whether they are late (`Natural_language_query_spec.md` §2.5).

> **Inherited ambiguity.** In Track & Trace, the *Fulfilled* pill is amber (`#F4D9AC`) while the *Exception* icon is also amber (`#A68538`) — a positive and a failure state sharing a hue on one screen. This dashboard uses amber for problems only. Raise the conflict at the source; until it is resolved, never rely on amber alone here — always show the label alongside it, which the pills and the status bar already do.

### 4.2 Colorblind behaviour

Green `#45785F` (luminance 0.155) and amber `#A88738` (0.252) separate by lightness as well as hue, so they survive deuteranopia. Every chart must remain readable in grayscale — that is the practical test, and it is why the categorical order in §3.5 is lightness-first.

Where on-time is compared against delayed as two lines, use direct end-of-line labels rather than a legend.

---

## 5. Chart furniture

**Default ink is graphite, not green.** A single-series bar chart of on-time rate by carrier uses `ink` (`#3A3A3F`). Green means `positive`, not "our house color." If every chart were green the accent would stop signalling anything.

**Gridlines.** Horizontal only, `--grid`, 0.5px. No vertical gridlines except on scatter. The zero baseline takes `--axis` at 1px.

**Axes.** No line on the value axis; gridlines carry it. Category axis takes a 0.5px `--axis` rule. Ticks 11px `--text-secondary`. Axis titles 11px `--text-muted`, only when units aren't obvious from the labels.

**Baselines.** Bars always start at zero. Lines may zoom, but a zoomed axis needs a visible break marker near the origin.

**Bars.** 2px top radius, square at the baseline, 20% gap. Empty track `--surface-inset`. Horizontal whenever a category label exceeds 12 characters — with lane labels like "San Francisco, CA → Sacramento, CA", that covers most lane charts.

**Lines.** 2px stroke. Point markers only below 20 points, 3px filled. No smoothing — monotone interpolation invents values between real observations, which is the kind of quiet fabrication this product exists to prevent.

**Areas.** Use the family `tint` stop directly; it is already calibrated. Never stack more than three.

**Distribution charts.** Where the tail is the story — transit time is the case here — render the body in `graphite-300` and the tail at or beyond `tail_threshold_days` in `ink`. The threshold is a semantic-layer parameter (`Natural_language_query_spec.md` §3.2), set to 8 days: the p95 of completed transit, above which sit 21 orders spanning 8 to 12 days. The eye should land on those, not on the mode at 4 days.

Two `reference` lines, both labelled inline: the **mean** (3.83 days) and the **p90** (6 days). Carrying both is the point of the chart — the mean sits inside the body and says nothing about the orders that generate complaints, while p90 is the number a service target can actually be set against. A distribution chart that shows only its average has hidden its own subject.

**Reference lines.** `reference`, 1px, dashed `4 3`, inline right-aligned label. Used for SLA thresholds and the all-groups average in any comparison chart.

**Tooltips.** White, 0.5px `--border`, 8px radius, 12px text. Show the category, every series value, and the group's `n` whenever a ratio metric is displayed. The `n` is not optional (§8.1).

**Empty state.** Never a blank grid. Axes plus a centered 13px `--text-secondary` line saying why: "No orders match these filters" or "That period is outside the data (Jan–Dec 2025)".

---

## 6. Named components

The dashboard ships four charts — the delivery-performance composition bar, order volume, the transit-time histogram, and the breakdown scatter — plus the forecast chart on its own view. Three of them fall out of the generic chart-selection table in `Natural_language_query_spec.md` §6.2. The two below do not, and are specified here.

### 6.1 Breakdown scatter

Replaces the separate carrier and lane scorecards. One component, one switchable dimension, four metrics.

**Encoding.** Each metric is matched to how precisely it needs to be read.

| Metric | Channel | Why |
|---|---|---|
| Share of volume | x position | Wide numeric spread (2% to 23% for carriers); position is the most accurately read channel |
| On-time rate | y position | The decision metric, read against a target line |
| Avg transit days | Point fill darkness, graphite ramp | Diagnostic. "Slower than others" is enough; the range is only 3.4–5.1 days, too narrow for size to resolve |
| P90 transit | Tooltip only | A lookup value, not a comparison |

**Size is not an encoding.** Points are a fixed radius. Size reads as importance, and volume already holds that meaning on the x-axis — a large point would say "this matters" while meaning "this is slow." Two channels claiming the same intuition is worse than leaving one unused.

**Priority quadrant.** Shade the region below the target line and right of the volume threshold in `#FDF6EA`, labeled "High volume, below target". Both bounds come from `Natural_language_query_spec.md` §3.2 `priority_quadrant` — the rate threshold is the computed overall rate under the active filters, never a hardcoded number, and the volume threshold varies by dimension because 10% of volume is a large carrier and an impossible lane.

Orientation matters and is easy to get backwards: the y-axis runs low-to-high upward, so below target is **below** the line. The shaded region is bottom-right, not top-right.

**Dimensions.** The switcher offers carrier, region, warehouse, product category, lane and client. Origin city is omitted — it is 1:1 with warehouse — and destination city is omitted because it partitions identically to lane. SKU is never offered.

**Sample-size coverage.** The tile states how much of the dimension clears its floor, as a 12px `--text-muted` caption under the title: "10 of 47 lanes meet the minimum sample of 10. The rest are shown hollow and are indicative only." Silently muting three quarters of the points and saying nothing is the failure this caption exists to prevent.

**Sufficiency.** Groups under that dimension's `min_group_size` render as hollow circles — white fill, 1.5px stroke in their transit color — rather than muted fills. A hollow point keeps its true position, so a promising small carrier is still visible as promising, while the outline says the value isn't bankable. This is the one place where §8.1's muted-fill rule does not apply.

**Labelling.** Label every point up to about 12 categories. Beyond that — lanes at 47, clients at 30 — label only points inside the priority quadrant or more than 10 points from the target line; the rest are unlabeled with tooltips. Forty-seven labels collide into noise and defeat the chart.

**Axis floor.** The y-axis does not start at zero, and that is correct for a scatter of rates. The floor must be visible on the axis so nobody reads the vertical spread as larger than it is. Set it to the nearest 10% below the minimum value present.

**Empty quadrant.** When nothing falls in the priority region, keep the shading and add a 12px caption: "No high-volume group is below target." An empty quadrant is a result, not a rendering failure.

### 6.2 Tables rank by problem, never by recency

A table on an analytics surface is ordered by revenue at risk, severity, or deviation from a target. Never by recency.

Recency answers "what just happened," which is an operational question Track & Trace already owns; duplicating it here adds a tile that can never surface anything the user didn't already know to look for. Row-level detail belongs behind a drill-down — click the transit-time tail and get those orders, click a scatter point and get that carrier's late deliveries — not as a permanent tile.

Where a ranking metric is itself noisy, sort by the reliable metric and flag on the noisy one. The lane view sorts by volume and colors below-target rates amber, because sorting 47 lanes by a rate computed on 11 deliveries each produces a leaderboard of sampling accidents.

---

## 7. Forecast rendering

Forecasts must not look like history.

- **History**: solid 2px `#45785F`
- **Forecast**: same hue, dashed `5 4`, same weight
- **Interval band**: `#DEEDE6` for the 80% band, `#EBF4F0` for the 95%, no stroke
- **Boundary**: 1px `reference` vertical rule at the last actual period, labeled "Forecast from"

The band is the honest part of the chart. When backtest error is high the band is wide and must be allowed to look wide — never clamp the visual range to make a projection look confident. On a sparse series (`sparse_series: true`, routine at category level on this dataset), add a 12px `--text-muted` caption giving the history length and chosen method.

---

## 8. Data-quality states

Visual treatments for states the analytics spec defines. This is the part of the design system that does real work, and it is why the palette keeps contrast headroom in reserve.

### 8.1 Below sufficiency threshold

Any group whose denominator falls under `min_group_size_warning` (default 30):

- Mark renders in `muted` (`#D4D4DA`) instead of its role color — a 15× luminance gap from `ink`, unmistakable at a glance
- Label suffixed with `· n=8` at 11px `--text-muted`
- Excluded from any "highest" or "lowest" callout in the answer text

A carrier at 25% from 8 deliveries must not look the same as one at 23% from 47. Applies to dashboard tiles exactly as it does to NL answers.

### 8.2 Partial period

Final bar or point gets a hollow fill with a 0.5px dashed outline in its own role color. Tooltip states the period is partial and gives the coverage. December 2025 ends on the 30th, so this fires more often on this dataset than you would expect.

### 8.3 Unverified answer

Charts from the raw SQL path (`trust: "unverified"`):

- Tile border becomes 1px `#A88738`
- Amber pill in the tile header reading "Unverified"
- No pin control rendered at all

The difference must be obvious across a room, because the failure mode is someone screenshotting an unverified chart into a deck.

> **v1 scope.** The raw-SQL path is deferred (`docs/SPEC.md` §10), so `trust: "unverified"` is unreachable in the first release and this treatment renders for nothing. It stays specified — the pin restriction it enforces is why the pin control can be built now without a gate that later has to be retrofitted.

### 8.4 Flat distribution

When the distribution test returns p > 0.20, render every bar in `muted` with a single `reference` line at the overall rate, plus a 12px caption: "Differences are within normal variation at these sample sizes." Delay broken down by region, category or warehouse on the current dataset always lands here.

---

## 9. Type and density

| Element | Size | Weight | Color |
|---|---|---|---|
| Tile title | 12–13px | 500 | `--text-primary` |
| Tile subtitle | 11px | 400 | `--text-muted` |
| KPI value | 19–22px | 500 | `--text-primary` |
| KPI label | 11–12px | 400 | `--text-secondary` |
| KPI context line | 10–11px | 400 | `--text-muted` |
| Axis tick | 11px | 400 | `--text-secondary` |
| Data label | 11px | 500 | Family `text` stop, or white on a `fill` |
| Pill | 10–11px | 400 | Family `text` on family `tint`, 20px radius |
| Caption / warning | 12px | 400 | `--text-muted` |

Two weights only, 400 and 500. Tabular figures on every number in a table or axis. Minimum chart height 180px. Minimum tile width 260px for a chart, 140px for a KPI card.

**Scale.** The sizes above are the ramp sampled from the existing product. This dashboard renders that ramp at **1.25x** — 13/14/15/16px with a 25px KPI value — because the sampled density is tighter than this surface is read at. The factor lives in one place, `src/lib/tokens.css`, with `SCALE` in `src/charts/scale.ts` applying it to the SVG constants no CSS token reaches. Change the token, not the literals.

> **Open item.** Track & Trace uses uppercase KPI labels ("FULFILLED", "IN TRANSIT"); this spec is sentence case throughout. Pick one and apply it to both surfaces.

---

## 10. Checklist

- Does every color come from a role, not a hex literal?
- Is the right stop used — `fill` for shapes, `tint`/`text` for pills?
- Is the default chart ink graphite rather than green?
- Does green appear only where it means `positive`?
- Is `#10F080` used at most once on the view, and never as a mark?
- Is it readable in grayscale?
- Do groups below 30 render `muted` with their `n` visible?
- Does the value axis start at zero, or carry a visible break?
- Does the forecast look unmistakably different from history?
- Does the empty state say why it is empty?
- Does the tooltip show `n` for every ratio metric?
- On a scatter, is the priority quadrant below the target line rather than above it?
- Does the scatter state how many groups clear the sample floor?
- Does the distribution chart show p90 as well as the mean?
- Is every table ranked by a problem rather than by recency?