import type { GtfsIndex } from "../entities/gtfs-index.js";
import type { Station } from "../entities/station.js";
import type { Trip } from "../entities/trip.js";
import type { StopTime } from "../entities/stop-time.js";
import { resolveStation } from "./resolve-station.js";
import { resolveAgencies } from "./resolve-agency.js";
import {
  serviceRunsOn,
  toGtfsDate,
  checkDateInRange,
  toMinutesGtfs,
} from "./service-calendar.js";
import { matchesTrainTypes, normalizeTrainTypes } from "./train-category.js";
import { buildBookingLink, type BookingLink } from "./booking-link.js";
import { detectBorderCrossing } from "./border-crossing.js";
import type { SortBy } from "./find-connection.js";

export type FindTransferInput = Readonly<{
  from: string;
  to: string;
  date: string;
  departureAfter: string;
  arriveBy: string | null;
  operator: string | null;
  trainTypes: ReadonlyArray<string> | null;
  via: string | null;
  wheelchairOnly: boolean;
  sortBy: SortBy;
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
  durationMinutes: number;
  wheelchairAccessible: 0 | 1 | 2;
  booking: BookingLink;
}>;

export type Itinerary = Readonly<{
  departureTime: string;
  arrivalTime: string;
  transferAt: string;
  transferWaitMinutes: number;
  totalDurationMinutes: number;
  international: boolean;
  borderCountries: ReadonlyArray<string>;
  legs: readonly [Leg, Leg];
}>;

type StationCandidate = Readonly<{ stopId: string; stopName: string }>;
type Which = "from" | "to" | "via";

export type FindTransferResult =
  | Readonly<{
      status: "ok";
      date: string;
      from: string;
      to: string;
      via: string | null;
      sortBy: SortBy;
      itineraries: ReadonlyArray<Itinerary>;
    }>
  | Readonly<{
      status: "ambiguous";
      which: Which;
      candidates: ReadonlyArray<StationCandidate>;
    }>
  | Readonly<{ status: "no_match"; which: Which }>
  | Readonly<{
      status: "no_match_operator";
      operator: string;
      available: ReadonlyArray<string>;
    }>
  | Readonly<{
      status: "date_out_of_range";
      date: string;
      feedStartDate: string;
      feedEndDate: string;
    }>;

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
    return {
      status: "ambiguous",
      which: "from",
      candidates: fromMatch.candidates.map(toCandidate),
    };
  }

  const toMatch = resolveStation(input.to, gtfs.stopsById);
  if (toMatch.kind === "none") return { status: "no_match", which: "to" };
  if (toMatch.kind === "ambiguous") {
    return {
      status: "ambiguous",
      which: "to",
      candidates: toMatch.candidates.map(toCandidate),
    };
  }

  let viaStopId: string | null = null;
  let viaStopName: string | null = null;
  if (input.via) {
    const viaMatch = resolveStation(input.via, gtfs.stopsById);
    if (viaMatch.kind === "none") return { status: "no_match", which: "via" };
    if (viaMatch.kind === "ambiguous") {
      return {
        status: "ambiguous",
        which: "via",
        candidates: viaMatch.candidates.map(toCandidate),
      };
    }
    viaStopId = viaMatch.station.stopId;
    viaStopName = viaMatch.station.stopName;
  }

  const allowedAgencyIds = resolveOperator(input.operator, gtfs);
  if (allowedAgencyIds === "no_match") {
    return {
      status: "no_match_operator",
      operator: input.operator ?? "",
      available: Array.from(gtfs.agenciesById.values()).map(
        (a) => a.agencyName,
      ),
    };
  }

  const gtfsDate = toGtfsDate(input.date);
  const afterSec = `${input.departureAfter}:00`;
  const arriveByTime = input.arriveBy ? `${input.arriveBy}:00` : null;
  const fromId = fromMatch.station.stopId;
  const toId = toMatch.station.stopId;
  const allowedTypes = normalizeTrainTypes(input.trainTypes);

  const candidates: Itinerary[] = [];

  for (const leg1Dep of gtfs.stopTimesByStop.get(fromId) ?? []) {
    if (leg1Dep.departureTime < afterSec) continue;

    const leg1Trip = gtfs.tripsById.get(leg1Dep.tripId);
    if (!leg1Trip) continue;
    if (!serviceRunsOn(gtfs, leg1Trip.serviceId, gtfsDate)) continue;
    if (input.wheelchairOnly && leg1Trip.wheelchairAccessible !== 1) continue;
    if (allowedAgencyIds && !agencyAllowed(gtfs, leg1Trip, allowedAgencyIds))
      continue;
    if (!matchesTrainTypes(gtfs.routesById.get(leg1Trip.routeId), allowedTypes))
      continue;

    const leg1Stops = gtfs.stopTimesByTrip.get(leg1Dep.tripId);
    if (!leg1Stops) continue;

    const reachesToDirectly = leg1Stops.some(
      (st) => st.stopId === toId && st.stopSequence > leg1Dep.stopSequence,
    );
    if (reachesToDirectly) continue;

    for (const intermediate of leg1Stops) {
      if (intermediate.stopSequence <= leg1Dep.stopSequence) continue;
      if (intermediate.stopId === fromId || intermediate.stopId === toId)
        continue;

      let perHubEmitted = 0;
      for (const leg2Dep of gtfs.stopTimesByStop.get(intermediate.stopId) ??
        []) {
        if (leg2Dep.tripId === leg1Dep.tripId) continue;

        const waitMin =
          toMinutesGtfs(leg2Dep.departureTime) -
          toMinutesGtfs(intermediate.arrivalTime);
        if (waitMin < MIN_TRANSFER_MINUTES) continue;
        if (waitMin > MAX_TRANSFER_WAIT_MINUTES) continue;

        const leg2Trip = gtfs.tripsById.get(leg2Dep.tripId);
        if (!leg2Trip) continue;
        if (!serviceRunsOn(gtfs, leg2Trip.serviceId, gtfsDate)) continue;
        if (input.wheelchairOnly && leg2Trip.wheelchairAccessible !== 1)
          continue;
        if (
          allowedAgencyIds &&
          !agencyAllowed(gtfs, leg2Trip, allowedAgencyIds)
        )
          continue;
        if (
          !matchesTrainTypes(
            gtfs.routesById.get(leg2Trip.routeId),
            allowedTypes,
          )
        )
          continue;

        const leg2Stops = gtfs.stopTimesByTrip.get(leg2Dep.tripId);
        if (!leg2Stops) continue;
        const leg2Arr = leg2Stops.find(
          (st) => st.stopId === toId && st.stopSequence > leg2Dep.stopSequence,
        );
        if (!leg2Arr) continue;
        if (arriveByTime && leg2Arr.arrivalTime > arriveByTime) continue;

        if (viaStopId) {
          const isInterchange = intermediate.stopId === viaStopId;
          const onLeg1 =
            !isInterchange &&
            leg1Stops.some(
              (st) =>
                st.stopId === viaStopId &&
                st.stopSequence > leg1Dep.stopSequence &&
                st.stopSequence < intermediate.stopSequence,
            );
          const onLeg2 =
            !isInterchange &&
            !onLeg1 &&
            leg2Stops.some(
              (st) =>
                st.stopId === viaStopId &&
                st.stopSequence > leg2Dep.stopSequence &&
                st.stopSequence < leg2Arr.stopSequence,
            );
          if (!isInterchange && !onLeg1 && !onLeg2) continue;
        }

        const intermediateStation = gtfs.stopsById.get(intermediate.stopId);
        const leg1Border = detectBorderCrossing(
          leg1Stops,
          leg1Trip.headsign,
          gtfs,
        );
        const leg2Border = detectBorderCrossing(
          leg2Stops,
          leg2Trip.headsign,
          gtfs,
        );
        const allCountries = Array.from(
          new Set([...leg1Border.countries, ...leg2Border.countries]),
        ).sort();

        candidates.push({
          departureTime: leg1Dep.departureTime.slice(0, 5),
          arrivalTime: leg2Arr.arrivalTime.slice(0, 5),
          transferAt: intermediateStation?.stopName ?? intermediate.stopId,
          transferWaitMinutes: waitMin,
          totalDurationMinutes:
            toMinutesGtfs(leg2Arr.arrivalTime) -
            toMinutesGtfs(leg1Dep.departureTime),
          international: allCountries.length > 0,
          borderCountries: allCountries,
          legs: [
            makeLeg(
              gtfs,
              leg1Trip,
              leg1Dep,
              intermediate,
              fromMatch.station,
              intermediateStation,
              input.date,
            ),
            makeLeg(
              gtfs,
              leg2Trip,
              leg2Dep,
              leg2Arr,
              intermediateStation,
              toMatch.station,
              input.date,
            ),
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

  sortItineraries(candidates, input.sortBy);

  return {
    status: "ok",
    date: input.date,
    from: fromMatch.station.stopName,
    to: toMatch.station.stopName,
    via: viaStopName,
    sortBy: input.sortBy,
    itineraries: candidates.slice(0, MAX_OUTPUT),
  };
}

function sortItineraries(itineraries: Itinerary[], sortBy: SortBy): void {
  switch (sortBy) {
    case "earliest_departure":
      itineraries.sort(
        (a, b) =>
          a.departureTime.localeCompare(b.departureTime) ||
          a.totalDurationMinutes - b.totalDurationMinutes,
      );
      return;
    case "earliest_arrival":
      itineraries.sort(
        (a, b) =>
          a.arrivalTime.localeCompare(b.arrivalTime) ||
          a.totalDurationMinutes - b.totalDurationMinutes,
      );
      return;
    case "shortest_trip":
      itineraries.sort(
        (a, b) =>
          a.totalDurationMinutes - b.totalDurationMinutes ||
          a.departureTime.localeCompare(b.departureTime),
      );
      return;
  }
}

function makeLeg(
  gtfs: GtfsIndex,
  trip: Trip,
  dep: StopTime,
  arr: StopTime,
  fromStation: Station | undefined,
  toStation: Station | undefined,
  date: string,
): Leg {
  const route = gtfs.routesById.get(trip.routeId);
  const trainNumber = (
    route?.shortName ||
    trip.shortName ||
    trip.tripId
  ).trim();
  const agency = route ? gtfs.agenciesById.get(route.agencyId) : undefined;
  const agencyName = agency?.agencyName ?? "";
  const fromName = fromStation?.stopName ?? dep.stopId;
  const toName = toStation?.stopName ?? arr.stopId;
  return {
    tripId: trip.tripId,
    trainNumber,
    trainName: route?.longName ? route.longName : null,
    agency: agencyName,
    headsign: trip.headsign,
    fromStop: fromName,
    toStop: toName,
    departureTime: dep.departureTime.slice(0, 5),
    arrivalTime: arr.arrivalTime.slice(0, 5),
    durationMinutes:
      toMinutesGtfs(arr.arrivalTime) - toMinutesGtfs(dep.departureTime),
    wheelchairAccessible: trip.wheelchairAccessible,
    booking: buildBookingLink(agency, {
      from: fromName,
      to: toName,
      date,
      departureTime: dep.departureTime.slice(0, 5),
    }),
  };
}

function agencyAllowed(
  gtfs: GtfsIndex,
  trip: Trip,
  allowed: ReadonlySet<string>,
): boolean {
  const route = gtfs.routesById.get(trip.routeId);
  return route !== undefined && allowed.has(route.agencyId);
}

function resolveOperator(
  operator: string | null,
  gtfs: GtfsIndex,
): ReadonlySet<string> | null | "no_match" {
  if (!operator) return null;
  const match = resolveAgencies(operator, gtfs.agenciesById);
  if (match.kind === "none") return "no_match";
  return new Set(match.agencies.map((a) => a.agencyId));
}

function toCandidate(s: Station): StationCandidate {
  return { stopId: s.stopId, stopName: s.stopName };
}
