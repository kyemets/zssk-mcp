# zssk-mcp — roadmap

Status after v0.6.0 (`feat/v0.6-visuals`).

---

## ✅ Done in v6

### Visual rendering tools

Three fixed-width ASCII renderers that produce chat-ready text. Unicode
kept minimal — `●` / `·` / `│` / `─` / `→`, plus `♿` / `⇄` where they
carry real meaning. No emoji cascade.

- **`render_trip_route(trip_id, date)`** — vertical timeline of one
  trip's stops. Header with train number + route + date, meta line with
  duration / agency / accessibility / cross-border info, one stop per
  line with a ● marker and │ connector. Preserves a structured
  `summary` alongside the rendered string.
- **`render_service_calendar(train_number, month)`** — Mo–Su month grid
  with ● on days the train runs, · on days it doesn't, `_` on days
  outside the feed's validity window. Covers the natural "does Ex 603
  run on Sundays?" question without a date-per-date probe.
- **`render_timetable_chart(station, date)`** — 24-hour histogram of
  departures from a station. Each row `HH ●●●● (N)`. Skips terminus
  rows. Keeps GTFS post-midnight buckets (24+) so the rhythm reflects
  actual same-service-day operations.

### Badges

Every `Connection` / `Leg` / `TripDetails` gains a `badges: Badge[]`
field. Each badge is `{ kind, symbol, label }`:

- `accessibility` · `♿` — trip has `wheelchair_accessible=1`.
- `international` · `⇄` — border-crossing, with country codes in label.
- `express` · `»` — route category Ex / IC / EC.
- `private_operator` · `»` — RJ / LE.
- `regional` · `·` — Os / R / REX.

Clients without icon support can render from `kind` + `label`; the
symbol is a hint, never the only information carrier.

---

## ✅ Done earlier

### v5 — integrations

- `get_feed_info` tool (resource mirror for Claude Code).
- Per-operator booking deep-links (`ik.zssk.sk`, RegioJet, Leo Express).
- `sort_by` on search tools (`earliest_departure` / `earliest_arrival` /
  `shortest_trip`).
- `international` + `borderCountries` on every result.
- `search_stations` autocomplete tool.
- `export_connection_as_ics` with RFC-5545 output, post-midnight
  time handling.

### v4 — ergonomics extras

- `via` + `arrive_by` + `wheelchair_only` filters.
- `date_out_of_range` status on every date-taking tool.
- Static `zssk://feed/info` MCP resource.

### v3

- `find_trip_by_number`, `find_stations_nearby`.
- `train_types` filter.
- `_feed_warning` field near feed expiry.
- MCP tool annotations (readOnly / non-destructive / idempotent / closed-world).

### v2

- `find_connection_with_transfer` (single-transfer itineraries).
- `operator` filter with alias table.
- License confirmed as CC0-1.0.

---

## 🛑 Still open

### #1 Real-time delays

Unchanged. Source decision still required. `check_delay` remains a stub.

### Ticket prices

Dead-end for a clean implementation — see v4/v5 notes. Booking
deep-links in v5 are the honest compromise.

---

## Explicitly still out of scope

- Multi-transfer (2+ changes) routing.
- Ticket booking automation.
- Web UI.
- Docker.
- A full test framework.
- A database.
