# ADR-004: Chat and pin state live in the app shell

## Status
Accepted

## Date
2026-09-10

## Context

The chat used to render at the bottom of the Overview view, below every chart. Asking about a tile meant scrolling past the whole dashboard to reach the input and scrolling back to see the tile. It moved to a collapsible right sidebar.

That move crosses a component boundary. The sidebar sits beside every view, but its two inputs originate elsewhere:

- **"Add to chat"** is on a tile in `Overview`, and hands the tile's query plan to the chat as context.
- **"Pin to dashboard"** is on a chat answer, and puts a plan back on `Overview`.

So neither component can own both ends.

## Decision

`src/App.tsx` owns `chatOpen`, `conversations`, `activeId`, `context` and `pins`, and passes handlers down. `Overview` receives `onAddToChat`, `pins` and `onUnpin`; the sidebar receives the rest.

Conversations and pins persist to `localStorage` (`src/lib/chat.ts`), following the pattern already used for pins.

The sidebar splits the row rather than covering it: `main` keeps `flex: 1; min-width: 0`, so opening the sidebar narrows it and the charts — which measure their own container — re-lay out at the new width. Below 1040px the sidebar overlays instead, because 380px of a narrower viewport would leave the main column under ~620px, narrower than a single chart tile wants.

## Alternatives Considered

### React context, or a small store
- Pros: no prop drilling; either component can reach the state directly.
- Cons: two consumers and one level of nesting does not need an indirection layer, and it makes the data flow harder to follow than passing two props.
- Rejected: premature for the size of the problem. Worth revisiting if a third surface needs the chat.

### Keep the chat in Overview, render it into a sidebar with a portal
- Pros: no state moves.
- Cons: the chat would vanish on the Forecast and Coverage views, or would have to be duplicated.
- Rejected: the sidebar is a shell feature, so it belongs in the shell.

### Server-side conversation storage
- Pros: survives a browser change; would make history a real product feature.
- Cons: needs a user identity, which this prototype does not have.
- Rejected as out of scope, and recorded in the consequences.

## Consequences

- A tile's plan can seed a chat question, and a chat answer can become a dashboard tile, without either view knowing about the other.
- A pinned tile stores the **IR, not the result**, so it re-executes on load and stays as current as any built-in tile.
- Conversation history is per-browser, not per-user. It is lost when site data is cleared, and does not follow anyone to another machine. That is acceptable for a prototype with no authentication, and is the first thing to change if history becomes a feature rather than a convenience.
- `localStorage` writes are wrapped: a full or blocked store loses history rather than throwing.
