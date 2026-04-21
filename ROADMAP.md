# zssk-mcp — roadmap

Status after v0.2.0 ship.

---

## ✅ Done in v2

### #2 Transfers — shipped as `find_connection_with_transfer`

Separate tool (v1 `find_connection` contract unchanged). Single-transfer
itineraries with 5-min minimum and 180-min maximum wait at the interchange.
Explicitly excludes trips that already reach the destination directly —
those stay in `find_connection`, so the two tools give a non-overlapping view.

Performance guardrails:
- Per-interchange hub cap of 5 emitted itineraries (stops a crowded junction
  like Žilina from dominating).
- Global pre-sort cap of 500 candidates.
- Output sorted by arrival time, then duration; top 20 returned.

Verified on real data: Bratislava → Prešov routes correctly via Kysak
(Ex 607 TATRAN → REX 1954), which is the actual ZSSK-recommended change.

### #3 Agency filter — shipped

Optional `operator` parameter on all three search tools
(`find_connection`, `find_connection_with_transfer`, `get_timetable`).
Accepts fuzzy substring or short codes via an alias table
(`ZSSK → Železničná spoločnosť Slovensko`, `RJ → RegioJet`, etc.).
Unknown operators return a structured `no_match_operator` response with
the list of 5 available agencies — no silent empty results.

### #4 License — confirmed CC0-1.0

Transitland records this feed under CC0-1.0 (Public Domain). Matches the
Slovak national open-data portal's default policy under Act 95/2019 on ITVS.
README now cites the license directly instead of hedging.

### #5 Snapshot sanity — shipped in `scripts/smoke.ts`

Structural floor only, not a percentage threshold (per the softer option
discussed). Asserts: each index has a conservative minimum size, every
tool returns the expected status, agency filter doesn't leak foreign
operators, and `feedVersion` parses as YYYYMMDD. Seasonal grafikon swings
don't trip it; upstream column renames or empty files do.

---

## 🛑 Still open

### #1 Real-time delays

**Blocked on a source decision.** Explicitly documented in the original
v1 spec as out of scope, and the v1 rule "don't scrape zssk.sk as a
workaround" still applies here unless overridden.

Options, unchanged since v2 kickoff:

- Scrape `zssk.sk/aktualna-poloha-vlakov` (HTML / possible JSON behind
  the live map) — fastest path, breaks the no-scraping rule.
- Pull from a third-party aggregator (e.g. chaps.cz / CIS) — cleaner,
  needs checking whether ZSSK actually feeds them.
- Wait for ŽSR to publish GTFS-RT — cleanest, no visible ETA.

**Decision needed from user** before any implementation:
1. Which source is OK.
2. Is it acceptable to degrade `check_delay` to the stub on upstream
   failure (expected to happen often with a scrape), or should errors
   surface hard?

Scope estimate once unblocked: ~1 day including caching + failure-mode
handling. Will stay as a stub until you give the go.

---

## Explicitly still out of scope

- Ticket booking, fares, seat selection — different data source,
  requires ZSSK account / API access.
- Multi-transfer (2+ changes) routing — diminishing returns for a
  pet-project scope; current single-transfer coverage is good enough.
- Web UI / dashboard — this stays an MCP server.
- Docker / CI — doesn't warrant the overhead.
- A full test framework — smoke test with structural assertions plus
  `tsc --noEmit` is enough.
- A database — in-memory comfortably fits the 30 k stop_times.
