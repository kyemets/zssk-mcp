# zssk-mcp — roadmap

Status after v0.3.0 (feat/v0.3-ergonomics).

---

## ✅ Done in v3

### #4 `find_trip_by_number` — shipped

Look up one or more trips by the human train number printed on tickets
(`Ex 603`, `R 681`, `RJ 1046`). Matches against both `route_short_name`
and `trip_short_name`, so either `Ex 603` or just `603` works. Returns
full stop lists with arrival / departure / platform per stop, filtered
to the specific service date.

### #5 Train-type filter — shipped

`find_connection`, `find_connection_with_transfer` and `get_timetable`
accept `train_types?: string[]` (ZSSK categories: `Os`, `R`, `REX`,
`Ex`, `IC`, `EC`, `RJ`, `LE`). Category is parsed as the first token of
`route_short_name`. Empty / omitted → no filter. Smoke verifies that
`["Ex"]` actually shrinks results and every output starts with `Ex `.

### #6 `find_stations_nearby` — shipped

Haversine proximity search. Input: `lat`, `lon`, `radius_km` (default 10,
max 500). Output: stations sorted by distance (`distanceKm` rounded to
3 decimals), capped at 50 results. Invalid coordinates return
`invalid_coordinates` with a reason. Stations with unknown coordinates
(`lat==0 && lon==0` in the feed) are silently skipped.

### #7 Tool annotations — shipped

All six tools expose `readOnlyHint: true`, `destructiveHint: false`,
`idempotentHint: true`, `openWorldHint: false`. Clients that honor the
MCP annotation hints can route these through without extra user
confirmation.

### #8 Feed-expiry warning — shipped

Loader now reads `feed_start_date` / `feed_end_date` from
`feed_info.txt`. A thin `getFeedWarning()` helper returns `warning` when
validity is within 14 days of ending, `expired` once `feed_end_date` is
in the past. The adapter wraps every tool response so the warning
appears as `_feed_warning` on every payload — no changes needed in the
pure use-case layer.

---

## 🛑 Still open (unchanged from v2)

### #1 Real-time delays

Same blocker as in v2 — requires a source decision (scrape
`zssk.sk/aktualna-poloha-vlakov` vs third-party aggregator vs wait for
GTFS-RT). `check_delay` remains a stub.

---

## Explicitly still out of scope

- Ticket booking, fares, seat selection — different data source.
- Multi-transfer (2+ changes) routing — current single-transfer coverage
  is good enough for a pet-project scope.
- Web UI / dashboard — this stays an MCP server.
- Docker / CI — doesn't warrant the overhead.
- A full test framework — smoke test with structural assertions plus
  `tsc --noEmit` is enough.
- A database — in-memory comfortably fits the 30 k stop_times.
