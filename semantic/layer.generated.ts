// GENERATED FILE — do not edit.
// Source: semantic/layer.yaml   Run: npm run build:layer
// Business logic belongs in the YAML, never here.
import type { Layer } from '../shared/layer-types.ts';

export const layer: Layer = {
  "version": "v2026.09.08a",
  "time_anchor": {
    "mode": "max_data_date",
    "field": "order_date",
    "value": "2025-12-30",
    "timezone": "Asia/Jakarta"
  },
  "snapshot_now": null,
  "datasets": {
    "orders": {
      "label": "Orders",
      "description": "One row per customer order, from placement to final status.",
      "base_table": "fct_orders",
      "postgres_schema": "analytics",
      "primary_key": "order_id",
      "grain": "order",
      "joins": [],
      "row_count": 400,
      "coverage": {
        "order_date": [
          "2025-01-01",
          "2025-12-30"
        ],
        "delivery_date": [
          "2025-01-02",
          "2025-12-31"
        ]
      }
    }
  },
  "parameters": {
    "completed_statuses": [
      "delivered",
      "delayed",
      "exception"
    ],
    "open_statuses": [
      "in_transit"
    ],
    "exception_counts_as_late": false,
    "min_group_size": {
      "default": 30,
      "carrier": 30,
      "region": 30,
      "warehouse": 30,
      "product_category": 30,
      "client_id": 20,
      "lane": 10,
      "sku": null
    },
    "tail_threshold_days": 8,
    "flat_distribution_p": 0.2,
    "priority_quadrant": {
      "rate_threshold": "metric.on_time_rate",
      "volume_threshold_pct": {
        "default": 10,
        "carrier": 10,
        "region": 15,
        "lane": 3,
        "client_id": 5
      }
    },
    "delayed_statuses": [
      "delayed"
    ]
  },
  "metrics": {
    "order_count": {
      "label": "Orders",
      "agg": "count_distinct",
      "expr": "order_id",
      "format": "integer"
    },
    "completed_count": {
      "label": "Completed deliveries",
      "agg": "count_distinct",
      "expr": "order_id",
      "filter": "status IN ('delivered','delayed','exception')",
      "format": "integer",
      "notes": "Orders that reached a final delivery outcome. Excludes in-transit and canceled."
    },
    "on_time_count": {
      "label": "Delivered on time",
      "agg": "count_distinct",
      "expr": "order_id",
      "filter": "status = 'delivered'",
      "format": "integer"
    },
    "delayed_count": {
      "label": "Delayed orders",
      "agg": "count_distinct",
      "expr": "order_id",
      "filter": "status IN {{delayed_statuses}}",
      "format": "integer",
      "notes": "Status-flagged as delayed. This dataset has no promised delivery date, so lateness is a recorded outcome rather than a computed one.\n"
    },
    "exception_count": {
      "label": "Exceptions",
      "agg": "count_distinct",
      "expr": "order_id",
      "filter": "status = 'exception'",
      "format": "integer"
    },
    "in_transit_count": {
      "label": "In transit",
      "agg": "count_distinct",
      "expr": "order_id",
      "filter": "status = 'in_transit'",
      "format": "integer",
      "point_in_time": false,
      "notes": "Open status with no capture timestamp. In this dataset in-transit orders span the full year, so this is a count of a label, not a live backlog. Cannot be trended or grouped by a time grain.\n"
    },
    "canceled_count": {
      "label": "Canceled orders",
      "agg": "count_distinct",
      "expr": "order_id",
      "filter": "status = 'canceled'",
      "format": "integer",
      "point_in_time": false
    },
    "delay_rate": {
      "label": "Delay rate",
      "agg": "ratio",
      "numerator": "delayed_count",
      "denominator": "completed_count",
      "format": "percent",
      "null_policy": "null_when_denominator_zero",
      "notes": "Delayed orders as a share of completed deliveries. Delayed and delivered are mutually exclusive statuses, so the denominator is all completed orders, not just on-time ones. Computing delayed/delivered inflates the rate by excluding late orders from their own denominator.\n"
    },
    "on_time_rate": {
      "label": "On-time rate",
      "agg": "ratio",
      "numerator": "on_time_count",
      "denominator": "completed_count",
      "format": "percent"
    },
    "exception_rate": {
      "label": "Exception rate",
      "agg": "ratio",
      "numerator": "exception_count",
      "denominator": "completed_count",
      "format": "percent"
    },
    "cancellation_rate": {
      "label": "Cancellation rate",
      "agg": "ratio",
      "numerator": "canceled_count",
      "denominator": "order_count",
      "format": "percent",
      "notes": "Denominator is all orders, not completed deliveries - a canceled order never reaches completion, so it cannot be a share of completions.\n"
    },
    "avg_transit_days": {
      "label": "Average transit days",
      "agg": "avg",
      "expr": "date_diff(delivery_date, order_date)",
      "filter": "delivery_date IS NOT NULL",
      "format": "days_1dp",
      "notes": "Order date to delivery date. Only completed orders contribute: 30 of 400 orders have no delivery_date (27 in transit, 3 canceled) and are excluded from the denominator. Shown on the KPI card, not only in the panel.\n"
    },
    "p95_transit_days": {
      "label": "95th percentile transit days",
      "agg": "percentile_disc",
      "percentile": 0.95,
      "expr": "date_diff(delivery_date, order_date)",
      "filter": "delivery_date IS NOT NULL",
      "format": "days_1dp",
      "notes": "Discrete, not interpolated: it reports a transit time some order actually had. p95 is the number a service target is set against, and it is the same boundary tail_threshold_days marks on the distribution chart - one definition of the tail, not two. The mean sits inside the body and says nothing about it.\n"
    },
    "max_transit_days": {
      "label": "Slowest delivery",
      "agg": "max",
      "expr": "date_diff(delivery_date, order_date)",
      "filter": "delivery_date IS NOT NULL",
      "format": "days_1dp"
    },
    "gross_revenue": {
      "label": "Gross revenue",
      "agg": "sum",
      "expr": "order_value_usd",
      "format": "currency_usd",
      "notes": "order_value_usd equals quantity x unit_price_usd. It does NOT have the promo discount applied. Use net_revenue for post-discount figures.\n"
    },
    "net_revenue": {
      "label": "Net revenue",
      "agg": "sum",
      "expr": "order_value_usd * (1 - promo_discount_pct / 100.0)",
      "format": "currency_usd"
    },
    "promo_discount_value": {
      "label": "Discount given",
      "agg": "sum",
      "expr": "order_value_usd * (promo_discount_pct / 100.0)",
      "format": "currency_usd"
    },
    "units_ordered": {
      "label": "Units",
      "agg": "sum",
      "expr": "quantity",
      "format": "integer"
    },
    "avg_order_value": {
      "label": "Average order value",
      "agg": "ratio",
      "numerator": "gross_revenue",
      "denominator": "order_count",
      "format": "currency_usd"
    },
    "promo_order_count": {
      "label": "Promo orders",
      "agg": "count_distinct",
      "expr": "order_id",
      "filter": "is_promo = 1",
      "format": "integer"
    },
    "promo_share": {
      "label": "Promo share of orders",
      "agg": "ratio",
      "numerator": "promo_order_count",
      "denominator": "order_count",
      "format": "percent"
    }
  },
  "dimensions": {
    "carrier": {
      "label": "Carrier",
      "expr": "carrier",
      "type": "categorical",
      "values": [
        "DHL",
        "DPD",
        "FedEx",
        "GLS",
        "LaserShip",
        "OnTrac",
        "Royal Mail",
        "UPS",
        "USPS"
      ]
    },
    "region": {
      "label": "Region",
      "expr": "region",
      "type": "categorical",
      "values": [
        "EU",
        "UK",
        "US-C",
        "US-E",
        "US-W"
      ],
      "notes": "All 47 lanes in this dataset are intra-region, so origin region and destination region are the same value. Split into origin_region and destination_region only when cross-region lanes appear.\n"
    },
    "origin_city": {
      "label": "Origin city",
      "expr": "origin_city",
      "type": "categorical",
      "approx_cardinality": 9,
      "parent": "region",
      "groupable": false,
      "notes": "1:1 with warehouse. Filterable; group by warehouse instead."
    },
    "destination_city": {
      "label": "Destination city",
      "expr": "destination_city",
      "type": "categorical",
      "approx_cardinality": 47,
      "groupable": false,
      "notes": "Filterable only. Partitions identically to lane (0 of 47 destinations have more than one origin), so grouping by it would draw the same chart under a different name.\n"
    },
    "warehouse": {
      "label": "Warehouse",
      "expr": "warehouse",
      "type": "categorical",
      "approx_cardinality": 9,
      "parent": "region",
      "notes": "One warehouse per origin city in this dataset, so this is the origin grain."
    },
    "lane": {
      "label": "Lane",
      "expr": "origin_city || ' -> ' || destination_city",
      "type": "categorical",
      "approx_cardinality": 47,
      "notes": "The only destination grain. destination_city partitions identically, so it stays a filterable column rather than a second dimension that would draw the same chart under a different chip.\n"
    },
    "transit_days": {
      "label": "Transit days",
      "expr": "CAST(date_diff(delivery_date, order_date) AS INTEGER)",
      "type": "ordinal",
      "approx_cardinality": 12,
      "notes": "Whole days from order to delivery. A distribution grain rather than a reporting grain: it exists so the transit-time histogram is a declared query like every other tile, instead of hand-written SQL sitting outside the semantic layer. Null for the 30 orders with no delivery date.\n"
    },
    "order_status": {
      "label": "Status",
      "expr": "status",
      "type": "categorical",
      "values": [
        "delivered",
        "delayed",
        "in_transit",
        "exception",
        "canceled"
      ]
    },
    "product_category": {
      "label": "Product category",
      "expr": "product_category",
      "type": "categorical",
      "values": [
        "BOOK",
        "BRUSH",
        "CRAYON",
        "MARKER",
        "PAINT",
        "PAPER",
        "PENCIL",
        "STICKER"
      ]
    },
    "sku": {
      "label": "SKU",
      "expr": "sku",
      "type": "categorical",
      "approx_cardinality": 355,
      "high_cardinality": true,
      "groupable": false,
      "parent": "product_category",
      "notes": "1.13 orders per SKU on average, maximum 3. Filterable, but never a trend, breakdown or forecast grain.\n"
    },
    "client_id": {
      "label": "Client",
      "expr": "client_id",
      "type": "categorical",
      "approx_cardinality": 30
    },
    "is_promo": {
      "label": "Promotional order",
      "expr": "is_promo",
      "type": "boolean",
      "value_labels": {
        "0": "Standard",
        "1": "Promotional"
      }
    }
  },
  "time_dimensions": {
    "order_date": {
      "label": "Order date",
      "expr": "order_date",
      "default": true,
      "coverage": [
        "2025-01-01",
        "2025-12-30"
      ]
    },
    "delivery_date": {
      "label": "Delivery date",
      "expr": "delivery_date",
      "coverage": [
        "2025-01-02",
        "2025-12-31"
      ],
      "nullable": true,
      "notes": "Null for in-transit and canceled orders. Filtering or grouping by this field silently excludes 30 of 400 orders. Surfaced as a warning whenever it is used.\n"
    }
  },
  "glossary": [
    {
      "terms": [
        "late",
        "delayed",
        "overdue",
        "missed SLA",
        "behind schedule"
      ],
      "maps_to": "metric.delayed_count"
    },
    {
      "terms": [
        "on time",
        "OTIF",
        "punctual",
        "service level"
      ],
      "maps_to": "metric.on_time_rate"
    },
    {
      "terms": [
        "shipper",
        "courier",
        "3PL",
        "transporter",
        "delivery company"
      ],
      "maps_to": "dimension.carrier"
    },
    {
      "terms": [
        "lane",
        "route",
        "corridor",
        "destination",
        "destination city",
        "ship-to"
      ],
      "maps_to": "dimension.lane"
    },
    {
      "terms": [
        "DC",
        "FC",
        "fulfilment centre",
        "fulfillment center",
        "depot"
      ],
      "maps_to": "dimension.warehouse"
    },
    {
      "terms": [
        "revenue",
        "sales",
        "turnover",
        "GMV"
      ],
      "maps_to": "metric.gross_revenue",
      "note": "Gross of promotional discount. Use net_revenue when the user says \"net\" or \"after discount\"."
    },
    {
      "terms": [
        "region",
        "territory",
        "market",
        "origin region",
        "destination region"
      ],
      "maps_to": "dimension.region",
      "note": "One region dimension. Every lane is intra-region on this data, so origin and destination region resolve to the same value; the answer says so.\n"
    },
    {
      "terms": [
        "transit time",
        "delivery time",
        "how long",
        "speed",
        "lead time"
      ],
      "maps_to": "metric.avg_transit_days",
      "note": "Offer p95_transit_days alongside it. The mean hides the tail."
    },
    {
      "terms": [
        "problem orders",
        "issues",
        "failures"
      ],
      "maps_to": "metric.exception_count",
      "note": "Ambiguous. Prefer clarify between exceptions, delays and cancellations."
    }
  ],
  "unanswerable": [
    {
      "pattern": "currently late, late right now, running behind, in transit right now",
      "reason": "No promised delivery date exists, and open statuses carry no capture timestamp. Lateness is only known once an order reaches a final status. Offer the historical delay rate instead.\n"
    },
    {
      "pattern": "cost, margin, profit, shipping spend, freight rate",
      "reason": "No cost columns in this dataset."
    },
    {
      "pattern": "customer name, address, contact details",
      "reason": "Only client_id is present; no customer master data."
    },
    {
      "pattern": "forecast for a single SKU, predict demand for SKU",
      "reason": "355 SKUs across 400 orders - 1.13 orders each, maximum 3. There is no series to fit. Offer the parent product category instead.\n"
    }
  ]
} as Layer;

export default layer;
