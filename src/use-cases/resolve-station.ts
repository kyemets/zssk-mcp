import type { Station } from "../entities/station.js";

// Diacritics stripped so "Zilina" can match "Žilina".
export function normalizeStationQuery(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim();
}

export type StationMatch =
  | Readonly<{ kind: "unique"; station: Station }>
  | Readonly<{ kind: "ambiguous"; candidates: ReadonlyArray<Station> }>
  | Readonly<{ kind: "none" }>;

// Returns only the top-scoring tier (exact=3 > prefix=2 > substring=1); if
// that tier has ≥2 members, surface all of them rather than guessing.
export function resolveStation(
  query: string,
  stops: ReadonlyMap<string, Station>,
): StationMatch {
  const q = normalizeStationQuery(query);
  if (!q) return { kind: "none" };

  let topScore = 0;
  let hits: Station[] = [];
  for (const station of stops.values()) {
    const name = normalizeStationQuery(station.stopName);
    const score =
      name === q ? 3 : name.startsWith(q) ? 2 : name.includes(q) ? 1 : 0;
    if (score === 0) continue;
    if (score > topScore) {
      topScore = score;
      hits = [station];
    } else if (score === topScore) {
      hits.push(station);
    }
  }

  if (hits.length === 0) return { kind: "none" };
  const first = hits[0];
  if (hits.length === 1 && first) return { kind: "unique", station: first };
  return { kind: "ambiguous", candidates: hits };
}
