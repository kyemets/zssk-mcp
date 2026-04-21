import type { GtfsIndex } from "../entities/gtfs-index.js";
import type { Station } from "../entities/station.js";
import type { Trip } from "../entities/trip.js";
import type { StopTime } from "../entities/stop-time.js";
import { resolveStation } from "./resolve-station.js";
import { resolveAgencies } from "./resolve-agency.js";
import { serviceRunsOn, toGtfsDate } from "./service-calendar.js";
import { matchesTrainTypes, normalizeTrainTypes } from "./train-category.js";

export type FindTransferInput = Readonly<{
  from: string;
  to: string;
  date: string;
  departureAfter: string;
  operator: string | null;
  trainTypes: ReadonlyArray<string> | null;
}>;

export type Leg = Readonly<{
  tripId: string;
  trainNumber: string;
  trainName: string | null;
  agency: string;
  headsign: string;
  fromStop: string;
  toStop: string;
  departureTime: string;
  arrivalTime: string;
}>;

export type Itinerary = Readonly<{
  departureTime: string;
  arrivalTime: string;
  transferAt: string;
  transferWaitMinutes: number;
  totalDurationMinutes: number;
  legs: readonly [Leg, Leg];
}>;

type StationCandidate = Readonly<{ stopId: string; stopName: string }>;

export type FindTransferResult =
  | Readonly<{ status: "ok"; date: string; from: string; to: string; itineraries: ReadonlyArray<Itinerary> }>
  | Readonly<{ status: "ambiguous"; which: "from" | "to"; candidates: ReadonlyArray<StationCandidate> }>
  | Readonly<{ status: "no_match"; which: "from" | "to" }>
  | Readonly<{ status: "no_match_operator"; operator: string; available: ReadonlyArray<string> }>;

// Policy: single transfer only, 5 min ≤ wait ≤ 180 min. Multi-leg search
// explodes combinatorially and the extra legs add more noise than value.
const MIN_TRANSFER_MINUTES = 5;
const MAX_TRANSFER_WAIT_MINUTES = 180;
const MAX_CANDIDATES_BEFORE_SORT = 500;
const MAX_OUTPUT = 20;

export function findConnectionWithTransfer(
  gtfs: GtfsIndex,
  input: FindTransferInput,
): FindTransferResult {
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

  const allowedAgencyIds = resolveOperator(input.operator, gtfs);
  if (allowedAgencyIds === "no_match") {
    return {
      status: "no_match_operator",
      operator: input.operator ?? "",
      available: Array.from(gtfs.agenciesById.values()).map(a => a.agencyName),
    };
  }

  const gtfsDate = toGtfsDate(input.date);
  const afterSec = `${input.departureAfter}:00`;
  const fromId = fromMatch.station.stopId;
  const toId = toMatch.station.stopId;
  const allowedTypes = normalizeTrainTypes(input.trainTypes);

  const candidates: Itinerary[] = [];

  for (const leg1Dep of gtfs.stopTimesByStop.get(fromId) ?? []) {
    if (leg1Dep.departureTime < afterSec) continue;

    const leg1Trip = gtfs.tripsById.get(leg1Dep.tripId);
    if (!leg1Trip) continue;
    if (!serviceRunsOn(gtfs, leg1Trip.serviceId, gtfsDate)) continue;
    if (allowedAgencyIds && !agencyAllowed(gtfs, leg1Trip, allowedAgencyIds)) continue;
    if (!matchesTrainTypes(gtfs.routesById.get(leg1Trip.routeId), allowedTypes)) continue;

    const leg1Stops = gtfs.stopTimesByTrip.get(leg1Dep.tripId);
    if (!leg1Stops) continue;

    // Skip trips that already reach "to" directly — find_connection covers
    // those, and duplicating them here would bury the transfer results.
    const reachesToDirectly = leg1Stops.some(
      st => st.stopId === toId && st.stopSequence > leg1Dep.stopSequence,
    );
    if (reachesToDirectly) continue;

    for (const intermediate of leg1Stops) {
      if (intermediate.stopSequence <= leg1Dep.stopSequence) continue;
      if (intermediate.stopId === fromId || intermediate.stopId === toId) continue;

      // Cap per-hub emissions so a crowded station (Žilina, Bratislava)
      // doesn't blow out the candidate list before global sort.
      let perHubEmitted = 0;
      for (const leg2Dep of gtfs.stopTimesByStop.get(intermediate.stopId) ?? []) {
        if (leg2Dep.tripId === leg1Dep.tripId) continue;

        const waitMin = toMinutes(leg2Dep.departureTime) - toMinutes(intermediate.arrivalTime);
        if (waitMin < MIN_TRANSFER_MINUTES) continue;
        if (waitMin > MAX_TRANSFER_WAIT_MINUTES) continue;

        const leg2Trip = gtfs.tripsById.get(leg2Dep.tripId);
        if (!leg2Trip) continue;
        if (!serviceRunsOn(gtfs, leg2Trip.serviceId, gtfsDate)) continue;
        if (allowedAgencyIds && !agencyAllowed(gtfs, leg2Trip, allowedAgencyIds)) continue;
        if (!matchesTrainTypes(gtfs.routesById.get(leg2Trip.routeId), allowedTypes)) continue;

        const leg2Stops = gtfs.stopTimesByTrip.get(leg2Dep.tripId);
        if (!leg2Stops) continue;
        const leg2Arr = leg2Stops.find(
          st => st.stopId === toId && st.stopSequence > leg2Dep.stopSequence,
        );
        if (!leg2Arr) continue;

        const intermediateStation = gtfs.stopsById.get(intermediate.stopId);
        candidates.push({
          departureTime: leg1Dep.departureTime.slice(0, 5),
          arrivalTime: leg2Arr.arrivalTime.slice(0, 5),
          transferAt: intermediateStation?.stopName ?? intermediate.stopId,
          transferWaitMinutes: waitMin,
          totalDurationMinutes: toMinutes(leg2Arr.arrivalTime) - toMinutes(leg1Dep.departureTime),
          legs: [
            makeLeg(gtfs, leg1Trip, leg1Dep, intermediate, fromMatch.station, intermediateStation),
            makeLeg(gtfs, leg2Trip, leg2Dep, leg2Arr, intermediateStation, toMatch.station),
          ],
        });

        perHubEmitted += 1;
        if (perHubEmitted >= 5) break;
        if (candidates.length >= MAX_CANDIDATES_BEFORE_SORT) break;
      }
      if (candidates.length >= MAX_CANDIDATES_BEFORE_SORT) break;
    }
    if (candidates.length >= MAX_CANDIDATES_BEFORE_SORT) break;
  }

  candidates.sort((a, b) => {
    if (a.arrivalTime !== b.arrivalTime) return a.arrivalTime.localeCompare(b.arrivalTime);
    return a.totalDurationMinutes - b.totalDurationMinutes;
  });

  return {
    status: "ok",
    date: input.date,
    from: fromMatch.station.stopName,
    to: toMatch.station.stopName,
    itineraries: candidates.slice(0, MAX_OUTPUT),
  };
}

function makeLeg(
  gtfs: GtfsIndex,
  trip: Trip,
  dep: StopTime,
  arr: StopTime,
  fromStation: Station | undefined,
  toStation: Station | undefined,
): Leg {
  const route = gtfs.routesById.get(trip.routeId);
  const trainNumber = (route?.shortName || trip.shortName || trip.tripId).trim();
  const agencyName = route ? (gtfs.agenciesById.get(route.agencyId)?.agencyName ?? "") : "";
  return {
    tripId: trip.tripId,
    trainNumber,
    trainName: route?.longName ? route.longName : null,
    agency: agencyName,
    headsign: trip.headsign,
    fromStop: fromStation?.stopName ?? dep.stopId,
    toStop: toStation?.stopName ?? arr.stopId,
    departureTime: dep.departureTime.slice(0, 5),
    arrivalTime: arr.arrivalTime.slice(0, 5),
  };
}

function agencyAllowed(gtfs: GtfsIndex, trip: Trip, allowed: ReadonlySet<string>): boolean {
  const route = gtfs.routesById.get(trip.routeId);
  return route !== undefined && allowed.has(route.agencyId);
}

// GTFS spec: times may exceed 24:00:00 (e.g. 25:30 for post-midnight stops
// on the same service day), so parse raw H*60+M without Date.
function toMinutes(gtfsTime: string): number {
  const parts = gtfsTime.split(":");
  const h = Number(parts[0] ?? "0");
  const m = Number(parts[1] ?? "0");
  return h * 60 + m;
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

function toCandidate(s: Station): StationCandidate {
  return { stopId: s.stopId, stopName: s.stopName };
}
