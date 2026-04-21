# zssk-mcp — roadmap

Status after v0.5.0 (`feat/v0.5-integrations`).

---

## ✅ Done in v5

### `get_feed_info` tool

Mirror of the existing `zssk://feed/info` resource. Claude Code (and most
MCP clients at the moment) don't expose `resources/read` to the agent as a
callable surface, so the tool is the reliable way to get feed metadata
programmatically. Same payload either way.

### Booking deep-links

Every connection / leg / trip result now carries a `booking` object:

```
{ provider: "ZSSK" | "RegioJet" | "Leo Express",
  url: "https://...?from=...&to=...&date=...&time=...",
  note: "Best-effort deep-link ..." }
```

Per-agency portal (ZSSK + Trezka → `ik.zssk.sk`, RegioJet → `regiojet.com`,
Leo Express → `leoexpress.com`). Query params are best-effort hints; if the
portal ignores them the user still lands on the right site. Documented as a
hint, not a contract — fine for a pet project.

### `sort_by` parameter

On `find_connection` and `find_connection_with_transfer`:
`earliest_departure` (default, unchanged behaviour), `earliest_arrival`,
`shortest_trip`. Verified in smoke that `shortest_trip`'s first element has
duration ≤ any other sort's first element.

### International / border-crossing flag

Every connection / leg / trip now has `international: boolean` and
`borderCountries: string[]` (ISO alpha-2). Detection uses a conservative
hardcoded marker list of CZ / AT / HU / PL / UA / DE hub city names against
stop names + headsign. Intentionally conservative — prefer missing a minor
hop over false-positive on Slovak station names that partially match.

### `search_stations` tool

Browse-style station search. Returns all tiers (exact > prefix > substring)
sorted by score then alphabetically. Fills the gap between
`resolveStation` (ambiguous-tier only) and `find_stations_nearby`
(requires coordinates). Diacritic-insensitive via the same
`normalizeStationQuery` used everywhere else.

### `export_connection_as_ics` tool

RFC-5545 VCALENDAR/VEVENT output for a `trip_id + date`. Embeds
`TZID=Europe/Bratislava`, includes the full stop list in the description.
Handles GTFS post-midnight times (≥ 24:00) by bumping the calendar date
and wrapping the hour, so `25:30 Košice` on 2026-04-21 becomes a valid
`20260422T013000` end time. Returns `trip_not_found`, `not_running`, or
`date_out_of_range` on the respective error paths.

---

## 🛑 Still open

### #1 Real-time delays

Unchanged since v2. Requires a source decision (scrape
`zssk.sk/aktualna-poloha-vlakov` vs third-party aggregator vs wait for
GTFS-RT). `check_delay` remains a stub.

### Ticket prices

Dead-end for a clean implementation (see v4 notes). ZSSK has no GTFS-Fares
data, booking API needs auth, scraping breaks the no-scraping rule and
misses promos/discounts (error ±30–50 %). The v5 booking deep-links are
the honest compromise: point the user at the right portal, let the portal
quote the real price.

---

## Explicitly still out of scope

- Multi-transfer (2+ changes) routing.
- Ticket booking automation (price quote, seat selection, payment).
- Web UI / dashboard.
- Docker.
- A full test framework — smoke + `tsc --noEmit` is enough.
- A database.
