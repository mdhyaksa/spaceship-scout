# ADR-001: Render explanations in a floating bubble

## Status
Accepted

## Date
2026-09-10

## Context

Every tile and every chat answer can show how its number was computed — filters, metric definitions, the query plan, the compiled SQL, the rows. That panel is the product's main claim: the numbers are computed and inspectable, not asserted.

It was rendered inline, expanded by a disclosure button beneath the tile. Two problems surfaced in use, both visible in `ref/Screenshot 2026-09-10 at 09.24.55.png` and `ref/Screenshot 2026-09-10 at 09.31.01.png`:

1. **It moved unrelated content.** The KPI cards sit in a CSS grid, and grid items in a row stretch to the tallest. Opening one card's explanation grew that card and pushed the other four with it. The same applied to the two chart tiles sharing a row.
2. **It overflowed its container.** Inside a ~150px KPI card the panel had nowhere to go, and the query plan spilled sideways across its neighbours.

The second problem had a specific cause worth recording, because it looks like an `overflow` bug and is not. The panel's rows are a `92px 1fr` grid. A grid track's implicit `min-width` is `auto` — min-content — so a wide `<pre>` sized the `1fr` track rather than scrolling inside it, and the `overflow-x: auto` on the `<pre>` never engaged.

## Decision

Render the panel in a **portal-mounted floating layer** (`src/components/ExplainBubble.tsx`), anchored to its trigger, flipped and clamped into the viewport.

Independently, fix the track sizing with `min-width: 0` on the content column, since the same panel renders inside the chat where it is not in a bubble.

KPI cards take a **compact variant**: interpretation, metric definitions, filters, period, warnings — no query plan, no SQL.

## Alternatives Considered

### Keep it inline, fix only the CSS
- Pros: one-line change; nothing overflows.
- Cons: the grid still reflows on open, and a query plan read through a 150px column is not an explanation.
- Rejected: it fixes the symptom in the screenshots and leaves the reason they were taken.

### A full-width panel beneath the KPI row
- Pros: no overlay, no z-index, real width for the plan.
- Cons: still changes layout height on open, pushing everything below it down the page; requires lifting "which card is expanded" into the parent.
- Rejected: less disruptive than per-card expansion, but still disruptive.

### A non-portalled absolutely-positioned popover
- Pros: simpler; no portal.
- Cons: any ancestor with `overflow` or a `border-radius` clips it — and the tile it hangs off is a rounded card.
- Rejected: it reintroduces the clipping in the second screenshot.

## Consequences

- The dashboard grid never reflows when an explanation opens. Measured: the five KPI cards stay at 153px, identical, open or closed.
- The bubble sizes against `document.documentElement.clientWidth`, not `window.innerWidth`. `innerWidth` includes the scrollbar, so a bubble sized against it overhangs the right edge on any page tall enough to scroll — which this one is.
- Positioning reads `getBoundingClientRect()` and renders `position: fixed`. Anything that desynchronises those two coordinate spaces breaks it — notably CSS `zoom` on an ancestor, which is one reason ADR-003 went the way it did.
- The bubble closes on Escape, outside click, and page scroll, and returns focus to its trigger.
- `docs/SPEC.md` §9 previously claimed every KPI card exposes its rows and the compiled SQL. That is no longer true and the line has been corrected: a KPI card's underlying data is the number on its face.
