#!/usr/bin/env python3
"""Re-derive every figure in docs/SPEC.md section 3 from the CSV.

Run it whenever the dataset changes. Asserts, so a drifted number fails loudly
instead of quietly making the spec wrong.

    python3 scripts/verify_data_facts.py
"""

import collections
import csv
import datetime
import math
import pathlib
import statistics

CSV = pathlib.Path(__file__).resolve().parent.parent / "mock_logistics_data.csv"
COMPLETED = {"delivered", "delayed", "exception"}


def load():
    with CSV.open() as fh:
        return list(csv.DictReader(fh))


def date(s):
    return datetime.date.fromisoformat(s)


def transit_days(row):
    if not row["delivery_date"]:
        return None
    return (date(row["delivery_date"]) - date(row["order_date"])).days


def percentile(sorted_values, q):
    idx = (len(sorted_values) - 1) * q
    lo, hi = math.floor(idx), math.ceil(idx)
    return sorted_values[lo] + (sorted_values[hi] - sorted_values[lo]) * (idx - lo)


def chi2_p(rows, dim):
    """Two-row contingency chi-square of `delayed` against everything else."""
    groups = collections.defaultdict(lambda: [0, 0])
    for row in rows:
        groups[row[dim]][0 if row["status"] == "delayed" else 1] += 1
    keys = sorted(groups)
    delayed = [groups[k][0] for k in keys]
    other = [groups[k][1] for k in keys]
    total, row_d, row_o = sum(delayed) + sum(other), sum(delayed), sum(other)
    stat = 0.0
    for i, _ in enumerate(keys):
        n = delayed[i] + other[i]
        for observed, row_total in ((delayed[i], row_d), (other[i], row_o)):
            expected = n * row_total / total
            if expected > 0:
                stat += (observed - expected) ** 2 / expected
    return survival(stat, len(keys) - 1)


def survival(x, df):
    """P(X > x) for chi-square with df degrees of freedom, via the series
    expansion of the regularized lower incomplete gamma. Avoids a scipy dep."""
    if x <= 0:
        return 1.0
    shape, scaled = df / 2, x / 2
    term = total = 1.0 / shape
    for n in range(1, 10_000):
        term *= scaled / (shape + n)
        total += term
        if term < 1e-15 * total:
            break
    lower = total * math.exp(-scaled + shape * math.log(scaled) - math.lgamma(shape))
    return max(0.0, 1.0 - lower)


def check(label, actual, expected):
    if isinstance(expected, float):
        ok = abs(actual - expected) < 0.05
    else:
        ok = actual == expected
    print(f"{'ok ' if ok else 'FAIL'}  {label:<44} {actual!r}")
    assert ok, f"{label}: got {actual!r}, spec says {expected!r}"


def main():
    rows = load()
    completed = [r for r in rows if r["status"] in COMPLETED]
    status = collections.Counter(r["status"] for r in rows)
    days = sorted(d for d in (transit_days(r) for r in rows) if d is not None)

    check("rows", len(rows), 400)
    check("columns", len(rows[0]), 17)
    check("distinct order_id", len({r["order_id"] for r in rows}), 400)

    for name, n in [("delivered", 304), ("delayed", 55), ("exception", 11),
                    ("in_transit", 27), ("canceled", 3)]:
        check(f"status {name}", status[name], n)
    check("completed deliveries", len(completed), 370)
    check("missing delivery_date", sum(1 for r in rows if not r["delivery_date"]), 30)

    check("order_date min", min(r["order_date"] for r in rows), "2025-01-01")
    check("order_date max", max(r["order_date"] for r in rows), "2025-12-30")
    check("delivery_date max", max(r["delivery_date"] for r in rows if r["delivery_date"]), "2025-12-31")

    check("on-time rate %", round(100 * status["delivered"] / len(completed), 1), 82.2)
    check("delay rate %", round(100 * status["delayed"] / len(completed), 1), 14.9)
    check("avg transit days", round(statistics.mean(days), 2), 3.83)
    check("p50 transit days", percentile(days, 0.50), 4.0)
    check("p90 transit days", percentile(days, 0.90), 6.0)
    check("p95 transit days (tail_threshold_days)", percentile(days, 0.95), 8.0)
    check("max transit days", max(days), 12)
    check("orders at/above tail threshold", sum(1 for d in days if d >= 8), 21)

    for dim, n in [("carrier", 9), ("origin_city", 9), ("warehouse", 9), ("region", 5),
                   ("destination_city", 47), ("product_category", 8), ("client_id", 30),
                   ("sku", 355)]:
        check(f"distinct {dim}", len({r[dim] for r in rows}), n)
    check("distinct lanes", len({(r["origin_city"], r["destination_city"]) for r in rows}), 47)

    # The two identities the semantic layer depends on.
    multi_origin = {d for d in {r["destination_city"] for r in rows}
                    if len({r["origin_city"] for r in rows if r["destination_city"] == d}) > 1}
    check("destinations with >1 origin (lane == destination)", len(multi_origin), 0)
    cross_region = {d for d in {r["destination_city"] for r in rows}
                    if len({r["region"] for r in rows if r["destination_city"] == d}) > 1}
    check("destinations spanning >1 region (all lanes intra-region)", len(cross_region), 0)

    mismatched = sum(1 for r in rows if abs(
        float(r["order_value_usd"]) - float(r["quantity"]) * float(r["unit_price_usd"])) > 0.011)
    check("rows where order_value != qty x price", mismatched, 0)
    check("promo orders", sum(1 for r in rows if r["is_promo"] == "1"), 22)

    monthly = collections.Counter(r["order_date"][:7] for r in rows)
    series = [monthly.get(f"2025-{m:02d}", 0) for m in range(1, 13)]
    check("monthly order counts", series, [75, 36, 46, 25, 29, 21, 42, 34, 18, 26, 24, 24])
    zero_months = {}
    for category in sorted({r["product_category"] for r in rows}):
        by_month = collections.Counter(
            r["order_date"][:7] for r in rows if r["product_category"] == category)
        zero_months[category] = sum(
            1 for m in range(1, 13) if by_month.get(f"2025-{m:02d}", 0) == 0)
    # The sparse-series guard fires above 30% of periods, i.e. 4 of 12 months.
    check("worst category zero months (guard needs 4)", max(zero_months.values()), 2)
    check("categories with any zero month",
          sorted(c for c, n in zero_months.items() if n), ["BRUSH", "MARKER", "PAINT"])

    # Group coverage: how many groups clear each min_group_size floor.
    for dim, floor, expected in [("carrier", 30, 4), ("client_id", 20, 5),
                                 ("destination_city", 10, 10), ("warehouse", 30, 9),
                                 ("product_category", 30, 8)]:
        counts = collections.Counter(r[dim] for r in completed)
        check(f"{dim} groups reaching n>={floor}", sum(1 for v in counts.values() if v >= floor), expected)

    for dim, p in [("carrier", 0.053), ("region", 0.945), ("product_category", 0.949),
                   ("warehouse", 0.983), ("is_promo", 0.652)]:
        check(f"chi2 p, delayed by {dim}", round(chi2_p(completed, dim), 3), p)

    print("\nAll figures in docs/SPEC.md section 3 verified against the CSV.")


if __name__ == "__main__":
    main()
