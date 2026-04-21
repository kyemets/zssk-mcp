import type { GtfsIndex } from "../entities/gtfs-index.js";
import { resolveStation } from "./resolve-station.js";
import { resolveAgencies } from "./resolve-agency.js";
import { serviceRunsOn, toGtfsDate } from "./service-calendar.js";
import { matchesTrainTypes, normalizeTrainTypes } from "./train-category.js";

export type GetTimetableInput = Readonly<{
  station: string;
  date: string;
  limit: number;
  operator: string | null;
  trainTypes: ReadonlyArray<string> | null;
}>;

export type Departure = Readonly<{
  tripId: string;
  trainNumber: string;
  trainName: string | null;
  agency: string;
  headsign: string;
  departureTime: string;
  arrivalTime: string;
  platformCode: string | null;
}>;

type StationCandidate = Readonly<{ stopId: string; stopName: string }>;

export type GetTimetableResult =
  | Readonly<{ status: "ok"; station: string; date: string; departures: ReadonlyArray<Departure> }>
  | Readonly<{ status: "ambiguous"; candidates: ReadonlyArray<StationCandidate> }>
  | Readonly<{ status: "no_match" }>
  | Readonly<{ status: "no_match_operator"; operator: string; available: ReadonlyArray<string> }>;

export function getTimetable(gtfs: GtfsIndex, input: GetTimetableInput): GetTimetableResult {
  const match = resolveStation(input.station, gtfs.stopsById);
  if (match.kind === "none") return { status: "no_match" };
  if (match.kind === "ambiguous") {
    return {
      status: "ambiguous",
      candidates: match.candidates.map(s => ({ stopId: s.stopId, stopName: s.stopName })),
    };
  }

  const allowedAgencyIds = resolveOperator(input.operator, gtfs);
  if (allowedAgencyIds === "no_match") {
    return {
      status: "no_match_operator",
      operator: input.operator ?? "",
      available: Array.from(gtfs.agenciesById.values()).map(a => a.agencyName),
    };
  }

  const gtfsDate = toGtfsDate(input.date);
  const allowedTypes = normalizeTrainTypes(input.trainTypes);
  const stopTimes = gtfs.stopTimesByStop.get(match.station.stopId) ?? [];
  const departures: Departure[] = [];

  for (const st of stopTimes) {
    const trip = gtfs.tripsById.get(st.tripId);
    if (!trip) continue;
    if (!serviceRunsOn(gtfs, trip.serviceId, gtfsDate)) continue;

    // Skip terminus rows: GTFS stores arrival_time == departure_time there,
    // which would leak as a phantom departure.
    const tripStops = gtfs.stopTimesByTrip.get(st.tripId);
    const lastStop = tripStops?.[tripStops.length - 1];
    if (lastStop && st.stopSequence === lastStop.stopSequence) continue;

    const route = gtfs.routesById.get(trip.routeId);
    if (allowedAgencyIds && !(route && allowedAgencyIds.has(route.agencyId))) continue;
    if (!matchesTrainTypes(route, allowedTypes)) continue;

    const trainNumber = (route?.shortName || trip.shortName || trip.tripId).trim();
    const agencyName = route ? (gtfs.agenciesById.get(route.agencyId)?.agencyName ?? "") : "";

    departures.push({
      tripId: trip.tripId,
      trainNumber,
      trainName: route?.longName ? route.longName : null,
      agency: agencyName,
      headsign: trip.headsign,
      departureTime: st.departureTime.slice(0, 5),
      arrivalTime: st.arrivalTime.slice(0, 5),
      // ŽSR feed has no per-trip platform data — fall back to the station's
      // default platform_code when present.
      platformCode: match.station.platformCode,
    });
  }

  departures.sort((a, b) => a.departureTime.localeCompare(b.departureTime));
  return {
    status: "ok",
    station: match.station.stopName,
    date: input.date,
    departures: departures.slice(0, input.limit),
  };
}

function resolveOperator(
  operator: string | null,
  gtfs: GtfsIndex,
): ReadonlySet<string> | null | "no_match" {
  if (!operator) return null;
  const match = resolveAgencies(operator, gtfs.agenciesById);
  if (match.kind === "none") return "no_match";
  return new Set(match.agencies.map(a => a.agencyId));
}
