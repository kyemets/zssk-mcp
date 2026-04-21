import type { GtfsIndex } from "../entities/gtfs-index.js";
import { serviceRunsOn, toGtfsDate, checkDateInRange } from "./service-calendar.js";

export type GetTripGeojsonInput = Readonly<{
  tripId: string;
  date: string;
}>;

export type TripFeature = Readonly<{
  type: "Feature";
  geometry: Readonly<{
    type: "LineString";
    coordinates: ReadonlyArray<readonly [number, number]>;
  }>;
  properties: Readonly<{
    tripId: string;
    trainNumber: string;
    trainName: string | null;
    agency: string;
    headsign: string;
    from: string;
    to: string;
    date: string;
    stops: ReadonlyArray<
      Readonly<{
        stopId: string;
        stopName: string;
        arrivalTime: string;
        departureTime: string;
        coordinates: readonly [number, number];
      }>
    >;
  }>;
}>;

export type GetTripGeojsonResult =
  | Readonly<{ status: "ok"; feature: TripFeature; skippedStops: number }>
  | Readonly<{ status: "trip_not_found"; tripId: string }>
  | Readonly<{ status: "not_running"; tripId: string; date: string }>
  | Readonly<{ status: "no_coordinates"; tripId: string }>
  | Readonly<{ status: "date_out_of_range"; date: string; feedStartDate: string; feedEndDate: string }>;

// Emit a GeoJSON Feature with a LineString geometry so any map-capable
// client (Leaflet, Mapbox, etc.) can draw the trip's path. Coordinates are
// [lon, lat] per the RFC-7946 spec. Stops without coordinates in the feed
// (lat=0 && lon=0) are skipped from the geometry but reported in
// `skippedStops` so the caller knows the line is partial.
export function getTripGeojson(gtfs: GtfsIndex, input: GetTripGeojsonInput): GetTripGeojsonResult {
  const dateCheck = checkDateInRange(gtfs, input.date);
  if (!dateCheck.ok) {
    return {
      status: "date_out_of_range",
      date: input.date,
      feedStartDate: dateCheck.feedStartDate,
      feedEndDate: dateCheck.feedEndDate,
    };
  }

  const trip = gtfs.tripsById.get(input.tripId);
  if (!trip) return { status: "trip_not_found", tripId: input.tripId };

  if (!serviceRunsOn(gtfs, trip.serviceId, toGtfsDate(input.date))) {
    return { status: "not_running", tripId: input.tripId, date: input.date };
  }

  const stopTimes = gtfs.stopTimesByTrip.get(input.tripId);
  if (!stopTimes || stopTimes.length < 2) {
    return { status: "trip_not_found", tripId: input.tripId };
  }

  const stops: TripFeature["properties"]["stops"][number][] = [];
  const coords: Array<readonly [number, number]> = [];
  let skipped = 0;
  for (const st of stopTimes) {
    const station = gtfs.stopsById.get(st.stopId);
    if (!station) {
      skipped += 1;
      continue;
    }
    // The loader defaults unknown lat/lon to 0; skip those rather than
    // drawing a line through the gulf of guinea.
    if (station.stopLat === 0 && station.stopLon === 0) {
      skipped += 1;
      continue;
    }
    const point: readonly [number, number] = [station.stopLon, station.stopLat];
    coords.push(point);
    stops.push({
      stopId: st.stopId,
      stopName: station.stopName,
      arrivalTime: st.arrivalTime.slice(0, 5),
      departureTime: st.departureTime.slice(0, 5),
      coordinates: point,
    });
  }

  if (coords.length < 2) {
    return { status: "no_coordinates", tripId: input.tripId };
  }

  const first = stopTimes[0];
  const last = stopTimes[stopTimes.length - 1];
  if (!first || !last) return { status: "trip_not_found", tripId: input.tripId };

  const route = gtfs.routesById.get(trip.routeId);
  const agency = route ? gtfs.agenciesById.get(route.agencyId) : undefined;

  return {
    status: "ok",
    skippedStops: skipped,
    feature: {
      type: "Feature",
      geometry: { type: "LineString", coordinates: coords },
      properties: {
        tripId: trip.tripId,
        trainNumber: (route?.shortName || trip.shortName || trip.tripId).trim(),
        trainName: route?.longName ? route.longName : null,
        agency: agency?.agencyName ?? "",
        headsign: trip.headsign,
        from: gtfs.stopsById.get(first.stopId)?.stopName ?? first.stopId,
        to: gtfs.stopsById.get(last.stopId)?.stopName ?? last.stopId,
        date: input.date,
        stops,
      },
    },
  };
}
