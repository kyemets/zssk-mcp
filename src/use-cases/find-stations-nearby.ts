import type { GtfsIndex } from "../entities/gtfs-index.js";

export type FindStationsNearbyInput = Readonly<{
  lat: number;
  lon: number;
  radiusKm: number;
}>;

export type NearbyStation = Readonly<{
  stopId: string;
  stopName: string;
  lat: number;
  lon: number;
  distanceKm: number;
}>;

export type FindStationsNearbyResult =
  | Readonly<{ status: "ok"; center: Readonly<{ lat: number; lon: number }>; radiusKm: number; stations: ReadonlyArray<NearbyStation> }>
  | Readonly<{ status: "invalid_coordinates"; reason: string }>;

const MAX_RESULTS = 50;

export function findStationsNearby(
  gtfs: GtfsIndex,
  input: FindStationsNearbyInput,
): FindStationsNearbyResult {
  if (!Number.isFinite(input.lat) || input.lat < -90 || input.lat > 90) {
    return { status: "invalid_coordinates", reason: `lat out of range: ${input.lat}` };
  }
  if (!Number.isFinite(input.lon) || input.lon < -180 || input.lon > 180) {
    return { status: "invalid_coordinates", reason: `lon out of range: ${input.lon}` };
  }
  if (!Number.isFinite(input.radiusKm) || input.radiusKm <= 0) {
    return { status: "invalid_coordinates", reason: `radiusKm must be > 0: ${input.radiusKm}` };
  }

  const hits: NearbyStation[] = [];
  for (const station of gtfs.stopsById.values()) {
    // The loader defaults empty lat/lon to 0 — skip those rather than match
    // every query at the gulf of guinea.
    if (station.stopLat === 0 && station.stopLon === 0) continue;
    const distance = haversineKm(input.lat, input.lon, station.stopLat, station.stopLon);
    if (distance > input.radiusKm) continue;
    hits.push({
      stopId: station.stopId,
      stopName: station.stopName,
      lat: station.stopLat,
      lon: station.stopLon,
      distanceKm: roundTo(distance, 3),
    });
  }

  hits.sort((a, b) => a.distanceKm - b.distanceKm);
  return {
    status: "ok",
    center: { lat: input.lat, lon: input.lon },
    radiusKm: input.radiusKm,
    stations: hits.slice(0, MAX_RESULTS),
  };
}

// Standard haversine in km — earth mean radius 6371 km. Accurate enough for
// < 100 km queries; we don't need Vincenty-level precision here.
function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function roundTo(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
