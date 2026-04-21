import type { GtfsIndex } from "../entities/gtfs-index.js";
import type { StopTime } from "../entities/stop-time.js";

// Cities outside Slovakia that Slovak operators (ZSSK, RegioJet, Leo Express)
// reach on through services. Key is a substring that reliably appears in
// GTFS `stop_name` or `trip_headsign`; value is the ISO 3166-1 alpha-2 code.
// This list is intentionally conservative — missing a minor border hop is
// better than false-positives from partial-word matches on Slovak names.
const FOREIGN_CITY_MARKERS: ReadonlyMap<string, string> = new Map([
  ["Praha", "CZ"],
  ["Brno", "CZ"],
  ["Ostrava", "CZ"],
  ["Olomouc", "CZ"],
  ["Pardubice", "CZ"],
  ["Česká Třebová", "CZ"],
  ["Břeclav", "CZ"],
  ["Wien", "AT"],
  ["Graz", "AT"],
  ["Budapest", "HU"],
  ["Miskolc", "HU"],
  ["Nyíregyháza", "HU"],
  ["Warszawa", "PL"],
  ["Kraków", "PL"],
  ["Krakow", "PL"],
  ["Katowice", "PL"],
  ["Kyiv", "UA"],
  ["Lviv", "UA"],
  ["Uzhhorod", "UA"],
  ["Mukachevo", "UA"],
  ["Berlin", "DE"],
  ["München", "DE"],
  ["Munich", "DE"],
  ["Hamburg", "DE"],
]);

export type BorderCrossing = Readonly<{
  international: boolean;
  countries: ReadonlyArray<string>;
}>;

export function detectBorderCrossing(
  tripStops: ReadonlyArray<StopTime>,
  headsign: string,
  gtfs: GtfsIndex,
): BorderCrossing {
  const countries = new Set<string>();

  for (const st of tripStops) {
    const stop = gtfs.stopsById.get(st.stopId);
    if (!stop) continue;
    for (const [marker, code] of FOREIGN_CITY_MARKERS) {
      if (stop.stopName.includes(marker)) countries.add(code);
    }
  }
  if (headsign) {
    for (const [marker, code] of FOREIGN_CITY_MARKERS) {
      if (headsign.includes(marker)) countries.add(code);
    }
  }

  return {
    international: countries.size > 0,
    countries: Array.from(countries).sort(),
  };
}
