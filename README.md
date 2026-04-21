# zssk-mcp

Standalone MCP server that exposes **Slovak Railways (ZSSK / ŽSR) GTFS timetable data**
to any MCP-compatible client (Claude Desktop, Claude Code, etc.).

This is a personal pet project — no production infra, no real-time delays in v1.

<div align="center">

[Overview](#overview) · [Tools](#tools-exposed) · [Install](#install--run) · [Testing](#testing-the-mcp) · [Claude Setup](#register-with-claude-desktop) · [Examples](#example-prompts)

</div>

---

## Overview

<details open>
<summary><strong>Data source</strong></summary>
<br>

- **Feed URL** (direct zip, no auth):
  `https://www.zsr.sk/files/pre-cestujucich/cestovny-poriadok/gtfs/gtfs.zip`
- **Catalog entry:** [data.gov.sk — Grafikon vlakovej dopravy vo formáte GTFS](https://data.gov.sk/dataset/https-www-zsr-sk-files-pre-cestujucich-cestovny-poriadok-gtfs-gtfs-zip)
- **Publisher (per `feed_info.txt`):** iTranSys, s.r.o. (<https://itransys.eu>), on behalf of ŽSR.
- **Coverage:** all passenger rail in Slovakia, not only ZSSK. `agency.txt` lists
  ZSSK, RegioJet, Leo Express, Leo Express Slovensko and Trenčianska elektrická
  železnica. The name `zssk-mcp` reflects the dominant operator; the feed itself
  is the ŽSR national grafikon.
- **Refresh cadence:** the feed is versioned by release date (`feed_version`
  field, e.g. `20260415`). It's reissued irregularly when the published
  timetable changes. This server refreshes the local cache every 24h (override
  with `ZSSK_GTFS_REFRESH=1`).
- **License:** **CC0-1.0 / Public Domain.** Reported by
  [Transitland for this feed](https://www.transit.land/feeds/f-eo0-zssk)
  (license URL: <https://creativecommons.org/publicdomain/zero/1.0/>).

</details>

<details>
<summary><strong>Disclaimer</strong></summary>
<br>

> **This is an unofficial, independent project.** It is **not affiliated with,
> endorsed by, or sponsored by** Železnice Slovenskej republiky (ŽSR),
> Železničná spoločnosť Slovensko (ZSSK), iTranSys s.r.o., or any other rail
> operator listed in the feed (RegioJet, Leo Express, Trenčianska elektrická
> železnica, etc.).
>
> The author has **no relationship** with any of those organizations. The
> project only consumes publicly available open data from
> [data.gov.sk](https://data.gov.sk) / ŽSR's public GTFS endpoint and exposes
> it through an MCP interface.
>
> The names "ZSSK", "ŽSR", and other operator/brand names are used **only to
> describe the data source**. All trademarks belong to their respective
> owners. Data is provided as-is with no guarantees of accuracy, completeness,
> or timeliness. Use at your own risk.

</details>

<details>
<summary><strong>Project layout</strong></summary>
<br>

```
src/
  entities/         pure domain types (no imports from adapters)
    station.ts
    trip.ts
    stop-time.ts
    service.ts
    route.ts
    agency.ts
    gtfs-index.ts
  use-cases/        pure logic over a GtfsIndex
    resolve-station.ts
    resolve-agency.ts
    service-calendar.ts            (+ date-range check, toMinutesGtfs)
    train-category.ts
    feed-status.ts                 (warning + buildFeedInfo)
    booking-link.ts                (v5: per-operator deep-link builder)
    border-crossing.ts             (v5: CZ/AT/HU/PL/UA/DE detection)
    search-stations.ts             (v5: browse-style station search)
    export-ics.ts                  (v5: RFC-5545 VEVENT generator)
    badges.ts                      (v6: compact indicators for results)
    render-trip-route.ts           (v6: ASCII route timeline)
    render-service-calendar.ts     (v6: monthly run-day grid)
    render-timetable-chart.ts      (v6: hourly departure histogram)
    next-departures-from.ts        (v7: "now" wrapper, Europe/Bratislava TZ)
    get-trip-geojson.ts            (v7: GeoJSON LineString for maps)
    compare-trips.ts               (v7: 2–5 trips side-by-side)
    find-reachable-stations.ts     (v7: direct + 1-transfer BFS)
    svg-projection.ts              (v8: shared equirectangular + svgEscape)
    render-trip-map.ts             (v8: SVG route map)
    render-reachable-map.ts        (v8: SVG isochrone-style reach map)
    find-connection.ts
    find-connection-with-transfer.ts
    find-trip-by-number.ts
    find-stations-nearby.ts
    get-timetable.ts
    check-delay.ts
  adapters/         external-world concerns
    gtfs-loader.ts  (download + cache + parse)
    mcp-server.ts   (MCP SDK wiring)
  main.ts           composition root
scripts/
  smoke.ts          smoke test + structural sanity assertions
.cache/             ignored by git — GTFS zip and extracted files
```

</details>

---

## Tools exposed

| Tool | Purpose | Since |
| --- | --- | --- |
| `find_connection` | **Direct** train connections between two stations on a given date. | v1 |
| `find_connection_with_transfer` | Two-leg train connections via a single transfer (5 min ≤ wait ≤ 180 min). | v2 |
| `get_timetable` | Departures from a station on a given date. | v1 |
| `find_trip_by_number` | Full stop list for a train identified by human number (`Ex 603`, `R 681`). | v3 |
| `find_stations_nearby` | Stations within a radius of a lat/lon, sorted by distance (haversine). | v3 |
| `search_stations` | Autocomplete-style station search by name (ranked exact > prefix > substr). | v5 |
| `export_connection_as_ics` | Return an RFC-5545 iCal (.ics) event for a trip_id + date. | v5 |
| `get_feed_info` | Feed metadata tool (mirror of the `zssk://feed/info` resource). | v5 |
| `render_trip_route` | ASCII timeline of a trip's stops (fixed-width, chat-renderable). | v6 |
| `render_service_calendar` | Monthly grid showing which days a train runs. | v6 |
| `render_timetable_chart` | Hourly histogram of station departures. | v6 |
| `next_departures_from` | "Now" wrapper — next N departures from a station in Europe/Bratislava time. | v7 |
| `get_trip_geojson` | GeoJSON Feature (LineString) of a trip's path for map rendering. | v7 |
| `compare_trips` | Side-by-side comparison of 2–5 trips on one date. | v7 |
| `find_reachable_stations` | Stations reachable within N minutes (direct, optionally with 1 transfer). | v7 |
| `render_trip_map` | Self-contained SVG map of a trip's route (uses GTFS `route_color`). | v8 |
| `render_reachable_map` | Isochrone-style SVG: dots colored green→red by travel time from origin. | v8 |
| `check_delay` | Real-time delay lookup. Returns `not_implemented` — pending source decision. | v1 stub |

All query tools are marked `readOnly`, non-destructive, idempotent, and
closed-world via MCP tool annotations, so clients can route them through
automated pipelines without extra confirmations.

<details>
<summary><strong>Operator filter (v2)</strong></summary>
<br>

`find_connection`, `find_connection_with_transfer` and `get_timetable` all
accept an optional `operator` argument. Accepted values: agency-name
substrings (e.g. `RegioJet`, `Leo Express`) or short codes (`ZSSK`, `RJ`,
`LE`, `Trezka`). Unknown values return a `no_match_operator` response with
the list of available agencies, rather than silently returning nothing.

</details>

<details>
<summary><strong>Train-type filter (v3)</strong></summary>
<br>

Same three search tools accept an optional `train_types: string[]` argument.
Values are case-insensitive ZSSK categories: `Os` (local), `R` (rýchlik),
`REX` (regional express), `Ex` (expres), `IC`, `EC`, plus private carriers
`RJ` (RegioJet), `LE` (Leo Express). Category is parsed from
`route_short_name` (first token). Omit or pass `[]` to include all categories.

</details>

<details>
<summary><strong>Feed-expiry warning (v3)</strong></summary>
<br>

Tool responses gain a `_feed_warning` field when the GTFS feed's
`feed_end_date` is within 14 days (`severity: "warning"`) or already past
(`severity: "expired"`). The field is omitted when there is nothing to flag.
Refresh with `ZSSK_GTFS_REFRESH=1` ahead of the December grafikon switchover.

</details>

<details>
<summary><strong>via, arrive_by, wheelchair_only (v4)</strong></summary>
<br>

`find_connection` and `find_connection_with_transfer` take three more
optional arguments:

- **`via: string`** — intermediate station the journey must pass through
  (fuzzy-matched). For direct search, the trip must visit via strictly
  between from and to. For transfer search, via may be the interchange or
  lie on either leg. Unknown via returns `no_match` with `which: "via"`.
- **`arrive_by: string`** (`HH:MM`, 24h) — upper bound on arrival time at
  the destination. Pair with `departure_after` to bracket a travel window.
  `arrive_by` alone gives "last train arriving by X".
- **`wheelchair_only: boolean`** — restricts results to trips explicitly
  marked `wheelchair_accessible=1` in `trips.txt`. Trips with unknown
  status (`0`) are excluded.

`get_timetable` and `find_trip_by_number` also take `wheelchair_only`.

</details>

<details>
<summary><strong>Date-out-of-range status (v4)</strong></summary>
<br>

Every date-taking tool (`find_connection`, `find_connection_with_transfer`,
`get_timetable`, `find_trip_by_number`) now returns
`{ status: "date_out_of_range", feedStartDate, feedEndDate }` when the
requested date falls outside the feed's validity window — instead of
silently returning an empty list that looks like "no trains".

</details>

<details>
<summary><strong>sort_by, booking deep-links, international (v5)</strong></summary>
<br>

- **`sort_by`** on `find_connection` and `find_connection_with_transfer`:
  `"earliest_departure"` (default), `"earliest_arrival"` (when you actually
  arrive), or `"shortest_trip"` (total travel time).
- Every connection / leg / trip result now carries a **`booking`** object
  with `{ provider, url, note }`. The URL is a best-effort deep-link into
  the operator's booking portal (`ik.zssk.sk` for ZSSK/Trezka, RegioJet
  for RJ, Leo Express for LE) with `from`, `to`, `date`, `time` query
  params. If the portal ignores them, the user still lands on the right
  site and fills the form manually.
- Every result also carries **`international: boolean`** and
  **`borderCountries: string[]`** (ISO 3166-1 alpha-2), detected by a
  conservative substring match on stop names / headsign against a
  hardcoded list of CZ / AT / HU / PL / UA / DE hub cities. Only
  cross-border services flip the flag.

</details>

<details>
<summary><strong>Visual rendering — ASCII (v6)</strong></summary>
<br>

The three `render_*` tools return fixed-width text blocks you can drop
straight into a chat message. Unicode is kept minimal (`●`, `·`, `│`,
`─`, `→`, plus `♿` / `⇄` where semantically relevant) — no emoji cascade.

**`render_trip_route(trip_id, date)`** — a trip's full stop list as a
vertical timeline:

```
Ex 603 TATRAN · Bratislava hl.st. → Košice · 2026-04-21
duration 5 h 38 min · 17 stops · ZSSK · ♿ accessible

04:15  ● Bratislava hl.st.
       │
04:20  ● Bratislava-Vinohrady
       │
...
09:53  ● Košice
```

**`render_service_calendar(train_number, month)`** — month grid showing
which days a train runs:

```
April 2026
Mo Tu We Th Fr Sa Su
       ●  ●  ●  ●  ●
 ●  ●  ●  ●  ●  ●  ●
...
```

**`render_timetable_chart(station, date)`** — hourly histogram of
departures from a station:

```
Žilina · 2026-04-21 · 156 departures

05 ●●●●●●●●● (9)
06 ●●●●●●●●● (9)
...
```

Every connection / leg / trip also carries a `badges` array: `accessibility` (♿),
`international` (⇄ with country codes), `express` (»), `private_operator` (»),
`regional` (·). Safe to ignore if the client doesn't render indicators.

</details>

<details>
<summary><strong>SVG map rendering (v8)</strong></summary>
<br>

Two tools return self-contained SVG maps — no external tile servers, no
internet required, rendered inline by MCP clients that support
`image/svg+xml` (Claude Desktop does; plain-text clients get the SVG in
the text payload as a fallback).

- **`render_trip_map(trip_id, date)`** — geographic map of one trip's
  path. Station coordinates projected with equirectangular + cos(lat)
  correction. Route polyline uses the `route_color` from `routes.txt`
  when set (ZSSK populates it — Ex/TATRAN is `#FF671F`, etc.).
  Endpoints get full station-name labels; intermediate stops get time
  labels staggered above/below to avoid collisions, and the station
  name lives in the SVG `<title>` tooltip.
- **`render_reachable_map(from, date, within_minutes, max_transfers)`** —
  isochrone-style map. Origin ringed in dark, reachable stations as dots
  colored on an HSL scale (green=fast → red=slow) relative to the
  budget. Transfer-reached stations carry a `via …` line in their
  tooltip. A small gradient legend sits in the bottom-right.

```bash
npm run smoke
open /tmp/zssk-trip-map.svg /tmp/zssk-reach-map.svg
```

</details>

<details>
<summary><strong>Station matching</strong></summary>
<br>

Stations are fuzzy-matched against `stops.txt:stop_name`, case- and
diacritic-insensitive (so `Zilina` resolves to `Žilina`). Scoring is
exact → prefix → substring. If the top-scoring tier has more than one
station the tool returns `{ status: "ambiguous", candidates: [...] }`
instead of guessing.

Platform codes: the ŽSR feed does not include per-trip platform data. When
`stops.txt` carries a `platform_code` it's returned; otherwise `platformCode`
is `null`.

</details>

<details>
<summary><strong>Still out of scope</strong></summary>
<br>

- Real-time delays / GTFS-RT (tracked as #1 in `ROADMAP.md`)
- Multi-transfer routing (2+ changes)
- Ticket booking, fares, seat selection

</details>

---

## Install & run

**Requirements:** Node.js ≥ 20 · npm

```bash
npm install
npm run dev       # start the stdio MCP server (development, via tsx)

# production-ish:
npm run build     # tsc → ./dist
npm start         # node dist/main.js
```

First startup downloads and caches the GTFS zip to `.cache/zssk-gtfs.zip`.
Subsequent starts reuse the cache if it's less than 24 hours old.
Set `ZSSK_GTFS_REFRESH=1` in the environment to force a redownload.

```bash
npm run smoke       # smoke test against live data
npm run typecheck   # tsc --noEmit, strict mode
```

---

## Testing the MCP

<details>
<summary><strong>1. Smoke script</strong></summary>
<br>

Exercises every use-case directly in-process (no MCP transport):

```bash
npm run smoke
```

</details>

<details>
<summary><strong>2. MCP Inspector (recommended during development)</strong></summary>
<br>

The official Anthropic UI for poking at MCP servers. Shows the tool list,
renders an input form per tool, and displays JSON-RPC traffic and stderr logs.

```bash
# dev (no build step):
npx @modelcontextprotocol/inspector npx -y tsx /absolute/path/to/zssk-mcp/src/main.ts

# after build:
npm run build
npx @modelcontextprotocol/inspector node /absolute/path/to/zssk-mcp/dist/main.js
```

Opens at `http://localhost:6274` with an auth token printed to the terminal.

</details>

<details>
<summary><strong>3. Manual stdio (JSON-RPC over pipes)</strong></summary>
<br>

```bash
(echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"cli","version":"0"}}}'; \
 echo '{"jsonrpc":"2.0","method":"notifications/initialized"}'; \
 echo '{"jsonrpc":"2.0","id":2,"method":"tools/list"}') \
 | npm run dev --silent
```

</details>

<details>
<summary><strong>4. Claude Code CLI</strong></summary>
<br>

```bash
npm run build
claude mcp add zssk -- node /absolute/path/to/zssk-mcp/dist/main.js
claude mcp list
```

</details>

<details>
<summary><strong>Scenarios to cover by hand</strong></summary>
<br>

- Ambiguous station (`from: "Bratislava"`) → expect `status: "ambiguous"` with candidates.
- Diacritic-free input (`station: "Zilina"`) → resolves to `Žilina`.
- Unknown `operator` value → `no_match_operator` with the agency list.
- `find_connection_with_transfer` between cities with no direct train — verify 5 min ≤ wait ≤ 180 min.
- Weekend / past date → `serviceRunsOn` filters correctly.
- `ZSSK_GTFS_REFRESH=1 npm run dev` → forces a zip re-download.
- Terminus stops don't leak into `get_timetable` as phantom departures.

</details>

---

## Register with Claude Desktop

Add an entry to your `claude_desktop_config.json`
(macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`):

```jsonc
{
  "mcpServers": {
    "zssk": {
      "command": "node",
      "args": ["/absolute/path/to/zssk-mcp/dist/main.js"]
    }
  }
}
```

Run `npm run build` first so `dist/main.js` exists. For a dev setup without a
build step:

```jsonc
{
  "mcpServers": {
    "zssk": {
      "command": "npx",
      "args": ["-y", "tsx", "/absolute/path/to/zssk-mcp/src/main.ts"]
    }
  }
}
```

Then restart Claude Desktop.

> **Note.** The server resolves its cache directory relative to its own
> location on disk (not `process.cwd()`), so Claude Desktop — which spawns the
> binary with `cwd=/` — won't trip over `mkdir '.cache'`. Override via
> `ZSSK_CACHE_DIR` if you need to place it elsewhere.

---

## Example prompts

Once the server is wired in, you can talk to it in plain language — the client
picks the right tool from the schemas. If multiple MCP servers could match,
nudge it with the server name (`"through zssk…"`).

<details>
<summary><strong>Station timetable · direct trains · operator filter</strong></summary>
<br>

```
Show departures from Žilina tomorrow, limit 10.
What leaves Bratislava hl.st. today after 18:00?

Find a train from Bratislava hl.st. to Košice tomorrow morning.
Is there an overnight train Bratislava hl.st. → Humenné tonight?

Any RegioJet from Žilina to Praha on Friday?
Leo Express departures from Bratislava hl.st. tomorrow.
```

</details>

<details>
<summary><strong>Transfer routing · fuzzy matching</strong></summary>
<br>

```
How do I get from Skalité to Štrba on Saturday?
Route with one transfer: Trenčín → Humenné tomorrow.

Departures from Zilina tomorrow.          (resolves to Žilina)
Find a train Kosice → Presov today.
```

</details>

<details>
<summary><strong>Error paths worth seeing</strong></summary>
<br>

```
Find a train from Bratislava to Košice.
→ status: "ambiguous" with candidates (no hl.st. specified)

Trains by operator "Flixtrain" from Bratislava hl.st.
→ no_match_operator with the full agency list

Check the delay of train Ex 42.
→ not_implemented (stub)
```

</details>
