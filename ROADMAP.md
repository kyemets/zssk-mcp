# zssk-mcp — roadmap

Status after v0.7.0 (`feat/v0.7-reach-and-geo`).

---

## ✅ Done in v7

### `next_departures_from(station, limit)`

Convenience wrapper around `get_timetable`. Resolves "today" and "now" in
Europe/Bratislava via `Intl.DateTimeFormat` (host-timezone-agnostic), then
filters out already-departed trains. Covers the very common "what's next
at Žilina?" ask in a single tool call.

### `get_trip_geojson(trip_id, date)`

Emit an RFC-7946 GeoJSON `Feature` with a `LineString` geometry built
from the trip's stop coordinates (`[lon, lat]` per spec). Any map-capable
client (Leaflet, Mapbox, Obsidian) can drop it onto a layer to draw the
route. Stops with unknown coords (lat=0 && lon=0 in the feed) are
skipped and reported in `skippedStops`.

### `compare_trips([trip_id_a, trip_id_b, ...], date)`

2–5 trip_ids, one date, side-by-side enriched metadata per trip. Each
row carries the same fields we already expose elsewhere (train number,
duration, stops, agency, wheelchair, international, booking, badges).
A trip that doesn't resolve or doesn't run comes back as its own
`trip_not_found` / `not_running` row without aborting the whole query.
Deliberately does **not** rank — no "winner" field.

### `find_reachable_stations(from, date, departure_after, within_minutes, max_transfers)`

Direct-default reachability search. For `max_transfers=0` (default),
walks every departure from `from` and follows each trip's stops until
the running time exceeds `within_minutes`. For `max_transfers=1`, also
explores one interchange per intermediate with a 5-minute minimum wait.
Returns up to 200 stations sorted by shortest total duration, each with
an `arrivalTime` and (for transfers) `viaTransfer` station name.

Smoke verified on real data: **74 stations reachable from Bratislava
hl.st. within 90 min direct; 147 stations within 180 min allowing one
transfer**.

---

## ✅ Done earlier

### v6 — visual rendering
- `render_trip_route`, `render_service_calendar`, `render_timetable_chart`.
- Unified `badges: Badge[]` on all trip results.

### v5 — integrations
- Booking deep-links, `sort_by`, `international`, `search_stations`,
  `export_connection_as_ics`, `get_feed_info`.

### v4 — ergonomics extras
- `via`, `arrive_by`, `wheelchair_only`, `date_out_of_range`,
  `zssk://feed/info` resource.

### v3
- `find_trip_by_number`, `find_stations_nearby`, `train_types`,
  feed-expiry warning, tool annotations.

### v2
- `find_connection_with_transfer`, `operator` filter, CC0-1.0 license
  confirmed.

---

## 🛑 Still open

### #1 Real-time delays

Unchanged. Source decision still required. `check_delay` remains a stub.

### Ticket prices

Booking deep-links (v5) are the honest compromise. Not revisiting.

---

## Explicitly still out of scope

- Multi-transfer (2+ changes) routing — `max_transfers: 2` would add
  combinatorial blowup for marginal coverage gain; 1-transfer already
  covers most realistic trips in Slovakia.
- Ticket booking automation.
- Web UI / dashboard.
- Docker / k8s.
- A full test framework.
- A database.
