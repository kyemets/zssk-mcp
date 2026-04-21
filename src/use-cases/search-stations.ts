import type { Station } from "../entities/station.js";
import { normalizeStationQuery } from "./resolve-station.js";

export type StationMatch = Readonly<{
  stopId: string;
  stopName: string;
  score: number;
}>;

export type SearchStationsResult = Readonly<{
  status: "ok";
  query: string;
  matches: ReadonlyArray<StationMatch>;
}>;

// Like resolveStation but returns all tiers (exact=3, prefix=2, substring=1)
// so the caller can browse candidates instead of being told "ambiguous".
// Sorted by score desc, then stopName alphabetically for deterministic output.
export function searchStations(
  query: string,
  stops: ReadonlyMap<string, Station>,
  limit: number,
): SearchStationsResult {
  const q = normalizeStationQuery(query);
  if (!q) return { status: "ok", query, matches: [] };

  const hits: StationMatch[] = [];
  for (const station of stops.values()) {
    const name = normalizeStationQuery(station.stopName);
    const score =
      name === q ? 3 : name.startsWith(q) ? 2 : name.includes(q) ? 1 : 0;
    if (score === 0) continue;
    hits.push({ stopId: station.stopId, stopName: station.stopName, score });
  }

  hits.sort(
    (a, b) => b.score - a.score || a.stopName.localeCompare(b.stopName),
  );
  return { status: "ok", query, matches: hits.slice(0, limit) };
}
