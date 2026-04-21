# zssk-mcp

Standalone MCP server that exposes **Slovak Railways (ZSSK / ŽSR) GTFS timetable data**
to any MCP-compatible client (Claude Desktop, Claude Code, etc.).

This is a personal pet project — no production infra, no real-time delays in v1.

---

## Disclaimer

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

---

## Data source

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
  This also matches the Slovak national open-data portal's default policy —
  under Act 95/2019 (ITVS), datasets in data.gov.sk / data.slovensko.sk are
  published as public-domain-equivalent unless a different license is
  explicitly marked on the dataset page. If you plan to redistribute the data,
  double-check the current terms on the catalog page just to be safe.

---

## Tools exposed

| Tool                             | Purpose                                                                      | Since   |
|----------------------------------|------------------------------------------------------------------------------|---------|
| `find_connection`                | **Direct** train connections between two stations on a given date.           | v1      |
| `find_connection_with_transfer`  | Two-leg train connections via a single transfer (5 min ≤ wait ≤ 180 min).    | v2      |
| `get_timetable`                  | Departures from a station on a given date.                                   | v1      |
| `find_trip_by_number`            | Full stop list for a train identified by human number (`Ex 603`, `R 681`).   | v3      |
| `find_stations_nearby`           | Stations within a radius of a lat/lon, sorted by distance (haversine).       | v3      |
| `check_delay`                    | Real-time delay lookup. Returns `not_implemented` — pending source decision. | v1 stub |

All query tools are marked `readOnly`, non-destructive, idempotent, and
closed-world via MCP tool annotations, so clients can route them through
automated pipelines without extra confirmations.

### Operator filter (v2)

`find_connection`, `find_connection_with_transfer` and `get_timetable` all
accept an optional `operator` argument. Accepted values: agency-name
substrings (e.g. `RegioJet`, `Leo Express`) or short codes (`ZSSK`, `RJ`,
`LE`, `Trezka`). Unknown values return a `no_match_operator` response with
the list of available agencies, rather than silently returning nothing.

### Train-type filter (v3)

Same three search tools accept an optional `train_types: string[]` argument.
Values are case-insensitive ZSSK categories: `Os` (local), `R` (rýchlik),
`REX` (regional express), `Ex` (expres), `IC`, `EC`, plus private carriers
`RJ` (RegioJet), `LE` (Leo Express). Category is parsed from
`route_short_name` (first token). Omit or pass `[]` to include all categories.

### Feed-expiry warning (v3)

Tool responses gain a `_feed_warning` field when the GTFS feed's
`feed_end_date` is within 14 days (`severity: "warning"`) or already past
(`severity: "expired"`). The field is omitted when there is nothing to flag.
Refresh with `ZSSK_GTFS_REFRESH=1` ahead of the December grafikon
switchover.

### Station matching

Stations are fuzzy-matched against `stops.txt:stop_name`, case- and
diacritic-insensitive (so `Zilina` resolves to `Žilina`). Scoring is
exact → prefix → substring. If the top-scoring tier has more than one
station the tool returns `{ status: "ambiguous", candidates: [...] }`
instead of guessing.

### Platform codes

The ŽSR feed does not include per-trip platform data. When `stops.txt`
carries a `platform_code` it's returned; otherwise `platformCode` is `null`.

### Still out of scope

- Real-time delays / GTFS-RT (tracked as #1 in `ROADMAP.md`)
- Multi-transfer routing (2+ changes)
- Ticket booking, fares, seat selection

---

## Requirements

- **Node.js ≥ 20** (the code also runs fine on Node 24).
- npm.

---

## Install & run

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

### Smoke test

One quick script exercises each tool against live data:

```bash
npm run smoke
```

It prints one example response per tool plus the parsed dataset sizes and
the cold-start time.

### Typecheck

```bash
npm run typecheck   # tsc --noEmit, strict mode
```

---

## Testing the MCP

Five ways, from fastest to closest-to-production:

### 1. Smoke script

Exercises every use-case directly in-process (no MCP transport):

```bash
npm run smoke
```

### 2. MCP Inspector (recommended during development)

The official Anthropic UI for poking at MCP servers. Shows the tool list,
renders an input form per tool, and displays JSON-RPC traffic and stderr
logs.

```bash
# dev (no build step):
npx @modelcontextprotocol/inspector npx -y tsx /absolute/path/to/zssk-mcp/src/main.ts

# after build:
npm run build
npx @modelcontextprotocol/inspector node /absolute/path/to/zssk-mcp/dist/main.js
```

Opens at `http://localhost:6274` with an auth token printed to the terminal.

### 3. Manual stdio (JSON-RPC over pipes)

A no-UI sanity check — pipe JSON-RPC frames into `npm run dev`:

```bash
(echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"cli","version":"0"}}}'; \
 echo '{"jsonrpc":"2.0","method":"notifications/initialized"}'; \
 echo '{"jsonrpc":"2.0","id":2,"method":"tools/list"}') \
 | npm run dev --silent
```

### 4. Claude Code CLI

```bash
npm run build
claude mcp add zssk -- node /absolute/path/to/zssk-mcp/dist/main.js
claude mcp list
```

### 5. Claude Desktop

See the registration section below.

### Scenarios to cover by hand

- Ambiguous station (`from: "Bratislava"`) → expect `status: "ambiguous"` with candidates.
- Diacritic-free input (`station: "Zilina"`) → resolves to `Žilina`.
- Unknown `operator` value → `no_match_operator` with the agency list.
- `find_connection_with_transfer` between cities with no direct train — verify 5 min ≤ wait ≤ 180 min.
- Weekend / past date → `serviceRunsOn` filters correctly.
- `ZSSK_GTFS_REFRESH=1 npm run dev` → forces a zip re-download.
- Terminus stops don't leak into `get_timetable` as phantom departures.

---

## Register with Claude Desktop

Add an entry to your `claude_desktop_config.json` (macOS path:
`~/Library/Application Support/Claude/claude_desktop_config.json`):

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

Run `npm run build` first so `dist/main.js` exists. Alternatively, for a
development setup using `tsx` without a build step:

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
> binary with `cwd=/` — won't trip over `mkdir '.cache'`. Override the
> location via `ZSSK_CACHE_DIR` if you need to place it elsewhere (e.g.
> read-only installs).

---

## Example prompts

Once the server is wired into Claude Desktop or Claude Code, you can talk to
it in plain language — the client picks the right tool from the schemas. If
multiple MCP servers could match, nudge it with the server name (`"through
zssk…"`).

**Station timetable (`get_timetable`)**
> Show departures from Žilina tomorrow, limit 10.
>
> What leaves Bratislava hl.st. today after 18:00?

**Direct trains (`find_connection`)**
> Find a train from Bratislava hl.st. to Košice tomorrow morning.
>
> Is there an overnight train Bratislava hl.st. → Humenné tonight?

**Operator filter**
> Any RegioJet from Žilina to Praha on Friday?
>
> Leo Express departures from Bratislava hl.st. tomorrow.

**Transfer routing (`find_connection_with_transfer`)**
> How do I get from Skalité to Štrba on Saturday? (no direct train — expect a transfer, usually via Žilina)
>
> Route with one transfer: Trenčín → Humenné tomorrow.

**Fuzzy / diacritic-insensitive matching**
> Departures from Zilina tomorrow. (resolves to `Žilina`)
>
> Find a train Kosice → Presov today.

**Error paths worth seeing**
> Find a train from Bratislava to Košice. (no `hl.st.` → `status: "ambiguous"` with candidates)
>
> Trains by operator "Flixtrain" from Bratislava hl.st. (→ `no_match_operator` with the agency list)
>
> Check the delay of train Ex 42. (→ `not_implemented`, stub)

---

## Project layout

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
    service-calendar.ts
    train-category.ts
    feed-status.ts
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
