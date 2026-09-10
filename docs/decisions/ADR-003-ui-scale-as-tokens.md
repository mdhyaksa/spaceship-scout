# ADR-003: Scale the UI with tokens, not with root zoom

## Status
Accepted

## Date
2026-09-10

## Context

`docs/DESIGN.md` §9 fixes the type ramp at 10–13px with a 19–22px KPI value, sampled from the existing product. On this dashboard that ramp reads too small: it was being used at 125% browser zoom, which is a workaround, not a design.

The whole UI is px-based — inline styles in components, and literal constants inside the SVG charts (`fontSize={11}`, padding, chart heights) that no CSS token reaches.

## Decision

Express the ramp as tokens in `src/lib/tokens.css` at **1.25×** the sampled values (13/14/15/16px, 25px KPI), and export `SCALE = 1.25` with a `px()` helper from `src/charts/scale.ts` for the SVG constants.

`docs/DESIGN.md` §9 records both the sampled ramp and the factor, so the spec describes the UI that exists.

## Alternatives Considered

### `zoom: 1.25` on the root element
- Pros: one line; scales everything uniformly including SVG text; exactly reproduces what the browser was doing.
- Cons: two coordinate-space hazards, both live in this codebase.
  - Every chart sizes itself from `ResizeObserver`, whose `contentRect` is reported in the element's own (unzoomed) space, while layout renders zoomed. The charts would be laying out against a space that no longer matches their font constants.
  - The explain bubble (ADR-001) positions a `position: fixed` element from `getBoundingClientRect()`. Under an ancestor `zoom` those two disagree, and the bubble lands off by the zoom factor.
- Rejected: confirmed empirically during this change — applying `zoom: 0.4` to the root as an inspection harness put the bubble off-screen, which is the same failure the real thing would have had.

### Convert everything to `rem` and set a root font size
- Pros: idiomatic; respects user font-size preferences.
- Cons: a large mechanical refactor of every inline style, and the SVG constants still need separate handling.
- Rejected: the same edit surface as the token approach with more churn, for a benefit (user font scaling) the px-based charts cannot honour anyway.

### Leave it and let users zoom
- Rejected: a default that requires a browser setting to be usable is a broken default.

## Consequences

- One factor to tune. Changing the ramp means changing `tokens.css` and `SCALE`, not forty literals.
- Anyone still browsing at 125% now sees roughly 1.56×. The browser should be back at 100%.
- CSS `zoom` is now effectively forbidden on ancestors of the chart containers and the bubble. Worth remembering before reaching for it as a quick fix.
- The type ramp in `docs/DESIGN.md` is no longer the literal set of sizes in the code; it is the base the code multiplies. The section says so.
