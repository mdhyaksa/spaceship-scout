# Overview

This is a logistics analytics dashboard that serve conventional chart based analytics and natural language query.

# Data source
- primarily a mock data in `./mock_logistics_data.csv`. Free to deploy as local postgresql or injected to managed DB.

# Design
- see the design spec at docs/DESIGN.md and wireframe at docs/wireframes/full_dashboard_wireframe_v4_with_breakdown_scatter.html

# Core Capability
- Chart and cards dashboard
- Natural language query (from scratch or quoting a dashboard/chart)
- Forecasting

## Chart and cards
Charts and cards must be cached and has a refresh button (use refresh icon).
- Cards
  - Delivered Orders
  - Total Orders
  - Delayed Orders
  - On-time Delivery Rate
  - Average Delivery Time

- Charts
  - Order volume over time
  - Order Performance (delayed vs. on-time)
  - status composition bar covering all five status with number and percentage of total
  - Delivery Days vs. number of orders bar chart. late orders are the ones creating complaints
  - On-time Delivery Rate per carrier (optionally add/replace with region)

- Available Filters / Dimensions for comparison
  - Product Category
  - origin city
  - destination city
  - Lane (origin-destination pair)
  - date range
  - region
  - warehouse
  - client_id
  - carrier
  - sku

## Natural Language Query
- Chart and cards must have a button that can add them as context into the active chat window
- see docs/Natural_language_query_spec.md for further spec.