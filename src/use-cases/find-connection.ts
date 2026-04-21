import type { GtfsIndex } from "../entities/gtfs-index.js";
import type { Station } from "../entities/station.js";
import { resolveStation } from "./resolve-station.js";
import { resolveAgencies } from "./resolve-agency.js";
import { serviceRunsOn, toGtfsDate, checkDateInRange } from "./service-calendar.js";
import { matchesTrainTypes, normalizeTrainTypes } from "./train-category.js";

export type FindConnectionInput = Readonly<{
  from: string;
  to: string;
  date: string;
  departureAfter: string;
  arriveBy: string | null;
  operator: string | null;
  trainTypes: ReadonlyArray<string> | null;
  via: string | null;
  wheelchairOnly: boolean;
}>;

export type Connection = Readonly<{
  tripId: string;
  trainNumber: string;
  trainName: string | null;
  agency: string;
  headsign: string;
  fromStop: string;
  toStop: string;
  departureTime: string;
  arrivalTime: string;
  intermediateStops: number;
  wheelchairAccessible: 0 | 1 | 2;
}>;

type StationCandidate = Readonly<{ stopId: string; stopName: string }>;
type Which = "from" | "to" | "via";

export type FindConnectionResult =
  | Readonly<{ status: "ok"; date: string; from: string; to: string; via: string | null; connections: ReadonlyArray<Connection> }>
  | Readonly<{ status: "ambiguous"; which: Which; candidates: ReadonlyArray<StationCandidate> }>
  | Readonly<{ status: "no_match"; which: Which }>
  | Readonly<{ status: "no_match_operator"; operator: string; available: ReadonlyArray<string> }>
  | Readonly<{ status: "date_out_of_range"; date: string; feedStartDate: string; feedEndDate: string }>;

const MAX_CONNECTIONS = 20;

export function findConnection(gtfs: GtfsIndex, input: FindConnectionInput): FindConnectionResult {
  const dateCheck = checkDateInRange(gtfs, input.date);
  if (!dateCheck.ok) {
    return {
      status: "date_out_of_range",
      date: input.date,
      feedStartDate: dateCheck.feedStartDate,
      feedEndDate: dateCheck.feedEndDate,
    };
  }

  const fromMatch = resolveStation(input.from, gtfs.stopsById);
  if (fromMatch.kind === "none") return { status: "no_match", which: "from" };
  if (fromMatch.kind === "ambiguous") {
    return { status: "ambiguous", which: "from", candidates: fromMatch.candidates.map(toCandidate) };
  }

  const toMatch = resolveStation(input.to, gtfs.stopsById);
  if (toMatch.kind === "none") return { status: "no_match", which: "to" };
  if (toMatch.kind === "ambiguous") {
    return { status: "ambiguous", which: "to", candidates: toMatch.candidates.map(toCandidate) };
  }

  // via is optional; only resolve when provided. A typo in via shouldn't
  // silently expand to any connection — treat it as an error just like from/to.
  let viaStopId: string | null = null;
  let viaStopName: string | null = null;
  if (input.via) {
    const viaMatch = resolveStation(input.via, gtfs.stopsById);
    if (viaMatch.kind === "none") return { status: "no_match", which: "via" };
    if (viaMatch.kind === "ambiguous") {
      return { status: "ambiguous", which: "via", candidates: viaMatch.candidates.map(toCandidate) };
    }
    viaStopId = viaMatch.station.stopId;
    viaStopName = viaMatch.station.stopName;
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
  const afterTime = `${input.departureAfter}:00`;
  const arriveByTime = input.arriveBy ? `${input.arriveBy}:00` : null;
  const fromId = fromMatch.station.stopId;
  const toId = toMatch.station.stopId;
  const allowedTypes = normalizeTrainTypes(input.trainTypes);

  const departures = gtfs.stopTimesByStop.get(fromId) ?? [];
  const connections: Connection[] = [];

  for (const depart of departures) {
    if (depart.departureTime < afterTime) continue;

    const trip = gtfs.tripsById.get(depart.tripId);
    if (!trip) continue;
    if (!serviceRunsOn(gtfs, trip.serviceId, gtfsDate)) continue;
    if (input.wheelchairOnly && trip.wheelchairAccessible !== 1) continue;

    const route = gtfs.routesById.get(trip.routeId);
    if (allowedAgencyIds && !(route && allowedAgencyIds.has(route.agencyId))) continue;
    if (!matchesTrainTypes(route, allowedTypes)) continue;

    const tripStops = gtfs.stopTimesByTrip.get(depart.tripId);
    if (!tripStops) continue;
    const arrival = tripStops.find(st => st.stopId === toId && st.stopSequence > depart.stopSequence);
    if (!arrival) continue;
    if (arriveByTime && arrival.arrivalTime > arriveByTime) continue;

    // via must appear strictly between the from and to stops on the trip, not
    // at either endpoint — otherwise "via Košice" on a Bratislava→Košice train
    // would match trivially.
    if (viaStopId) {
      const viaHit = tripStops.some(
        st => st.stopId === viaStopId
          && st.stopSequence > depart.stopSequence
          && st.stopSequence < arrival.stopSequence,
      );
      if (!viaHit) continue;
    }

    const trainNumber = (route?.shortName || trip.shortName || trip.tripId).trim();
    const trainName = route?.longName ? route.longName : null;
    const agencyName = route ? (gtfs.agenciesById.get(route.agencyId)?.agencyName ?? "") : "";

    connections.push({
      tripId: trip.tripId,
      trainNumber,
      trainName,
      agency: agencyName,
      headsign: trip.headsign,
      fromStop: fromMatch.station.stopName,
      toStop: toMatch.station.stopName,
      departureTime: depart.departureTime.slice(0, 5),
      arrivalTime: arrival.arrivalTime.slice(0, 5),
      intermediateStops: arrival.stopSequence - depart.stopSequence - 1,
      wheelchairAccessible: trip.wheelchairAccessible,
    });
  }

  connections.sort((a, b) => a.departureTime.localeCompare(b.departureTime));
  return {
    status: "ok",
    date: input.date,
    from: fromMatch.station.stopName,
    to: toMatch.station.stopName,
    via: viaStopName,
    connections: connections.slice(0, MAX_CONNECTIONS),
  };
}

// null = no filter, Set = allowed agency_ids, "no_match" = bail with error.
function resolveOperator(
  operator: string | null,
  gtfs: GtfsIndex,
): ReadonlySet<string> | null | "no_match" {
  if (!operator) return null;
  const match = resolveAgencies(operator, gtfs.agenciesById);
  if (match.kind === "none") return "no_match";
  return new Set(match.agencies.map(a => a.agencyId));
}

function toCandidate(s: Station): StationCandidate {
  return { stopId: s.stopId, stopName: s.stopName };
}
