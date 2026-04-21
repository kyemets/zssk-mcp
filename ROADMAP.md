# zssk-mcp — roadmap

Status after v0.4.0 (`feat/v0.4-ergonomics-extras`).

---

## ✅ Done in v4

### `via` parameter

On `find_connection` and `find_connection_with_transfer`. For direct search
the trip must visit `via` strictly between `from` and `to`. For transfer
search the via may be the interchange or lie on either leg. Unknown `via`
value returns `no_match` with `which: "via"` — no silent expansion.

### `arrive_by` parameter

Same two tools accept an `arrive_by` (`HH:MM`) gate on the destination
arrival time. Natural fit for "last train home by X" and "what can I
catch if I must arrive by noon".

### `wheelchair_only` filter

Loaded `wheelchair_accessible` from `trips.txt` into a new
`WheelchairAccessibility` field on the `Trip` entity. Applied as a filter
on the four trip-returning tools (`find_connection`,
`find_connection_with_transfer`, `get_timetable`, `find_trip_by_number`).
Trips with unknown status (`0`) are excluded when the filter is on.

### `date_out_of_range` status

New explicit status on every date-taking tool when the requested date
falls outside `feed_start_date..feed_end_date`. Replaces the earlier
silent empty response that was easily misread as "no trains that day".

### MCP resource `zssk://feed/info`

Static read-only resource published alongside the six tools. Returns
`{ feedVersion, feedStartDate, feedEndDate, agencies, counts, warning }`.
Client reads it once per session to get the feed's validity window
without burning a tool call.

---

## ✅ Done in v3

- `find_trip_by_number` — full stop list for a named train.
- `find_stations_nearby` — haversine proximity search.
- `train_types` filter (Os / R / REX / Ex / IC / EC / RJ / LE).
- `_feed_warning` field injected on tool responses ≤14 days from expiry.
- MCP tool annotations (`readOnly`, non-destructive, idempotent, closed-world).

## ✅ Done in v2

- `find_connection_with_transfer` — single-transfer itineraries.
- `operator` filter with alias table (ZSSK / RJ / LE / Trezka).
- License confirmed as CC0-1.0.
- Smoke: structural floor on dataset sizes + tight alias-leak regression.

---

## 🛑 Still open

### #1 Real-time delays

Same blocker as v2/v3 — requires a source decision (scrape
`zssk.sk/aktualna-poloha-vlakov` vs third-party aggregator vs wait for
GTFS-RT). `check_delay` remains a stub.

### Ticket prices / fares

Investigated in v4 — dead-end for a clean implementation. Feed has no
GTFS-Fares data; ZSSK's booking API requires auth; scraping breaks the
"no scraping" rule and misses promos/discounts (error ±30–50 %).
Intentionally not adding an `estimate_price` tool that would silently
hallucinate numbers. If you want it, the realistic option is a static
TR-201 tariff table with an explicit `_estimate_warning` on every
response — ~1 day of work, pending a go-ahead.

---

## Explicitly still out of scope

- Multi-transfer (2+ changes) routing.
- Ticket booking, fares, seat selection (see above).
- Web UI / dashboard.
- Docker.
- A full test framework — smoke test plus `tsc --noEmit` is enough.
- A database.
