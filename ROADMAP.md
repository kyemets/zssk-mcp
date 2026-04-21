# zssk-mcp — roadmap

Status after v0.8.0 (`feat/v0.8-map-render`).

---

## ✅ Done in v8

### SVG map rendering — two new tools

Self-contained SVG output, no tile servers, no internet. Returned as both
an `image/svg+xml` content item (for inline rendering in Claude Desktop /
similar capable clients) and a text payload with the raw SVG + structured
metadata (so plain-text clients still have the whole thing).

- **`render_trip_map(trip_id, date)`** — geographic projection of one
  trip. Stop coordinates come from `stops.txt`, projected with
  equirectangular + cos(lat) correction (fine for a country the size of
  Slovakia, no projection library needed). Route line uses GTFS
  `route_color` when the feed sets it — ZSSK populates it on named
  trains (TATRAN / KRIVÁŇ / ZEMPLÍN etc.), so Ex 603 renders in the
  real ZSSK Ex-class orange `#FF671F`. Endpoint stops get full labels;
  intermediates get time-only labels staggered above/below the line, and
  station names live in the circle's SVG `<title>` tooltip so the map
  stays readable at any zoom.

- **`render_reachable_map(from, date, within_minutes, max_transfers)`** —
  isochrone-style dot map. Origin ringed in dark; reachable stations as
  colored dots on an HSL green→red scale relative to `within_minutes`.
  Transfer-reached stations carry a `via …` line in their tooltip.
  Small gradient legend in the bottom-right.

### Route entity gains `color` + `textColor`

Parsed from `routes.txt:route_color` / `route_text_color`. Normalized to
uppercase six-hex without the `#` prefix; garbage values normalize to
`null` so downstream code can rely on the shape.

### Shared projection helper

`src/use-cases/svg-projection.ts` holds the equirectangular projector
and a defensive `svgEscape`. Both map renderers share it, so the
geometry looks consistent between trip-map and reach-map.

---

## ✅ Done earlier

### v7 — reachability and geo
- `next_departures_from`, `get_trip_geojson`, `compare_trips`,
  `find_reachable_stations`.

### v6 — visual rendering
- `render_trip_route`, `render_service_calendar`,
  `render_timetable_chart`, unified `badges` array.

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
- `find_connection_with_transfer`, `operator` filter, CC0-1.0 confirmed.

---

## 🛑 Still open

### #1 Real-time delays

Unchanged. Source decision still required. `check_delay` remains a stub.

### Ticket prices

Booking deep-links (v5) are the honest compromise. Not revisiting.

---

## Explicitly still out of scope

- Multi-transfer (2+ changes) routing.
- Interactive HTML/Leaflet map with OSM tiles — adds internet dependency
  and a JS runtime; SVG in-response is the right level for an MCP that
  should work offline from the loaded feed.
- Ticket booking automation.
- Web UI / dashboard.
- Docker / k8s.
- A full test framework.
- A database.
