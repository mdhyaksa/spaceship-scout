-- Fact table. One row per order, exactly as the CSV ships it.
-- No derived columns: transit days and status groupings are declared in the
-- semantic layer, not baked into the schema. In production those derivations
-- move to dbt (tech-stack.md 11.4), and this table becomes a dbt model.
DROP TABLE IF EXISTS fct_orders;
CREATE TABLE fct_orders (
  order_id           TEXT PRIMARY KEY,
  client_id          TEXT    NOT NULL,
  order_date         TEXT    NOT NULL,          -- ISO 8601 date
  delivery_date      TEXT,                      -- NULL for in_transit and canceled
  carrier            TEXT    NOT NULL,
  origin_city        TEXT    NOT NULL,
  destination_city   TEXT    NOT NULL,
  status             TEXT    NOT NULL,
  sku                TEXT    NOT NULL,
  product_category   TEXT    NOT NULL,
  quantity           INTEGER NOT NULL,
  unit_price_usd     REAL    NOT NULL,
  order_value_usd    REAL    NOT NULL,
  is_promo           INTEGER NOT NULL,
  promo_discount_pct REAL    NOT NULL,
  region             TEXT    NOT NULL,
  warehouse          TEXT    NOT NULL
);

CREATE INDEX idx_orders_date   ON fct_orders (order_date);
CREATE INDEX idx_orders_status ON fct_orders (status);

-- Query log. Written on every request regardless of path, per
-- Natural_language_query_spec.md 8.1. The embedding column and the clustering
-- job it feeds are deferred; the log itself is not, because retrofitting it
-- later throws away the most informative weeks of usage there are.
DROP TABLE IF EXISTS nl_query_log;
CREATE TABLE nl_query_log (
  request_id          TEXT PRIMARY KEY,
  occurred_at         TEXT    NOT NULL,
  question_raw        TEXT,
  question_normalized TEXT,
  path                TEXT    NOT NULL,   -- ir | clarify | unanswerable | planner_failed | tile
  trust               TEXT    NOT NULL,   -- verified | none
  intent              TEXT,
  ir                  TEXT,               -- JSON
  generated_sql       TEXT,
  validator_errors    TEXT,               -- JSON
  clarify_reason      TEXT,
  model_id            TEXT,
  planner_latency_ms  INTEGER,
  query_latency_ms    INTEGER,
  row_count           INTEGER,
  returned_empty      INTEGER,
  layer_version       TEXT    NOT NULL,
  data_as_of          TEXT    NOT NULL
);

CREATE INDEX idx_log_path ON nl_query_log (path, occurred_at);
