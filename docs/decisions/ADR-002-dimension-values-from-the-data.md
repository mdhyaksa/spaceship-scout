# ADR-002: Dimension values come from the layer where declared, from the data where not

## Status
Accepted

## Date
2026-09-10

## Context

The filter chip row offers a value list per dimension. Two chips — Warehouse and Promotional order — were empty, falling through to "9 values — filter from the chat instead". Neither declares `values:` in `semantic/layer.yaml`: `warehouse` carries only `approx_cardinality: 9`, `is_promo` only `value_labels`.

The obvious fix is to query the data for distinct values. That is not safe everywhere, and the reason is the point of this record.

A declared `values:` list is read by three consumers, not one:

1. the **validator**, which rejects a filter value outside the declared set (`invalid_value`);
2. the **planner prompt**, which renders the list so the model does not invent a carrier;
3. the **filter chips**.

If the chips were fed live values while the validator kept checking the declaration, the UI could offer a value the validator then refuses — a filter that visibly does nothing. The two lists must not be allowed to drift.

## Decision

Split by whether the layer declares the dimension:

- **Declared** (`carrier`, `region`, `order_status`, `product_category`): the declaration wins. The chips show exactly what the validator will accept.
- **Undeclared** (`warehouse`, `is_promo`): the catalog queries `SELECT DISTINCT` at `/api/layer`. These are not value-checked by the validator — its check only fires `if (dim.values)` — so live values are safe here and never go stale.

Capped at 60 distinct values; above that a dropdown is the wrong control and the existing "filter from the chat instead" message stands, and is then true. Computed dimensions (`lane`) and high-cardinality ones (`sku`) are skipped.

Enforced by a test in `tests/parity.test.ts`: every dimension that declares `values` must declare exactly the set present in the data.

## Alternatives Considered

### Declare warehouse and is_promo in the layer
- Pros: one source for all three consumers; consistent with how carrier and region already work; 11 lines of YAML.
- Cons: goes stale the first time a warehouse opens or closes, and nothing catches it until someone notices a missing chip.
- Rejected: the staleness is silent, and the parity test that would catch it is the same test now guarding the declared dimensions anyway.

### Query live values for every dimension
- Pros: nothing ever goes stale; `client_id` and `lane` get chips too.
- Cons: the validator and the prompt still read the declaration, so the UI would offer values the validator rejects.
- Rejected: it trades a stale list for an inconsistent one, which is worse — the first is visible, the second looks like a broken filter.

### Drop the declarations and validate against live values
- Pros: genuinely one source.
- Cons: the validator would have to query on every request, and the planner prompt would change per request, making the golden set non-reproducible.
- Rejected: the declaration is business logic. Deleting it to avoid duplication moves business logic into the data.

## Consequences

- Warehouse and Promotional order now list real values. Two chips stopped lying.
- The catalog became async and is cached on `layer.version + data_as_of`, so the DISTINCT queries run once per layer or data change rather than per request.
- A dimension gains chips simply by *not* being declared, which is a slightly surprising rule. It is the right way round — declaring a dimension is a statement that its values are business-defined, not merely observed — but it is worth knowing before wondering why adding `values:` made a chip *less* current.
- If a declared dimension's data drifts, the parity test fails rather than the UI quietly losing an option.
