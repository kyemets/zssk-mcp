import type { GtfsIndex } from "../entities/gtfs-index.js";
import type { Station } from "../entities/station.js";
import { resolveStation } from "./resolve-station.js";
import { serviceRunsOn, toGtfsDate, checkDateInRange, toMinutesGtfs } from "./service-calendar.js";

export type FindReachableInput = Readonly<{
  from: string;
  date: string;
  departureAfter: string;
  withinMinutes: number;
  maxTransfers: 0 | 1;
}>;

export type ReachableStation = Readonly<{
  stopId: string;
  stopName: string;
  durationMinutes: number;
  arrivalTime: string;
  viaTransfer: string | null;
}>;

type StationCandidate = Readonly<{ stopId: string; stopName: string }>;

export type FindReachableResult =
  | Readonly<{
      status: "ok";
      from: string;
      date: string;
      withinMinutes: number;
      maxTransfers: 0 | 1;
      stations: ReadonlyArray<ReachableStation>;
    }>
  | Readonly<{ status: "ambiguous"; which: "from"; candidates: ReadonlyArray<StationCandidate> }>
  | Readonly<{ status: "no_match"; which: "from" }>
  | Readonly<{ status: "date_out_of_range"; date: string; feedStartDate: string; feedEndDate: string }>;

// Transfer window for a 1-change reach: same policy as
// find_connection_with_transfer so the two tools agree on what counts as a
// feasible change.
const MIN_TRANSFER_MINUTES = 5;
const MAX_RESULTS = 200;

// Answer "from A, within N minutes of travel starting after time T on date D,
// where can I get to?". Direct-only by default; set maxTransfers=1 to also
// consider one interchange. Total duration is measured from T's departure
// out of A to final arrival at the destination.
export function findReachableStations(
  gtfs: GtfsIndex,
  input: FindReachableInput,
): FindReachableResult {
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

  const gtfsDate = toGtfsDate(input.date);
  const afterTime = `${input.departureAfter}:00`;
  const fromId = fromMatch.station.stopId;

  // Keep the best (shortest duration) option per destination; later finds
  // replace earlier ones only if they're strictly faster end-to-end.
  type Best = Readonly<{ durationMinutes: number; arrivalTime: string; viaTransfer: string | null }>;
  const best = new Map<string, Best>();

  // Leg 1: every trip departing `from` on the target date.
  for (const dep of gtfs.stopTimesByStop.get(fromId) ?? []) {
    if (dep.departureTime < afterTime) continue;

    const trip = gtfs.tripsById.get(dep.tripId);
    if (!trip) continue;
    if (!serviceRunsOn(gtfs, trip.serviceId, gtfsDate)) continue;

    const tripStops = gtfs.stopTimesByTrip.get(dep.tripId);
    if (!tripStops) continue;

    const depMinutes = toMinutesGtfs(dep.departureTime);

    for (const onward of tripStops) {
      if (onward.stopSequence <= dep.stopSequence) continue;
      if (onward.stopId === fromId) continue;
      const duration = toMinutesGtfs(onward.arrivalTime) - depMinutes;
      if (duration <= 0) continue;
      if (duration > input.withinMinutes) break;
      updateBest(best, onward.stopId, {
        durationMinutes: duration,
        arrivalTime: onward.arrivalTime.slice(0, 5),
        viaTransfer: null,
      });
    }

    // Leg 2: for each intermediate on this trip, try an onward connection.
    if (input.maxTransfers === 1) {
      for (const intermediate of tripStops) {
        if (intermediate.stopSequence <= dep.stopSequence) continue;
        if (intermediate.stopId === fromId) continue;
        const atIntermediateMinutes = toMinutesGtfs(intermediate.arrivalTime);
        const elapsedToHub = atIntermediateMinutes - depMinutes;
        if (elapsedToHub >= input.withinMinutes) break;

        for (const leg2Dep of gtfs.stopTimesByStop.get(intermediate.stopId) ?? []) {
          if (leg2Dep.tripId === dep.tripId) continue;

          const leg2DepMinutes = toMinutesGtfs(leg2Dep.departureTime);
          const wait = leg2DepMinutes - atIntermediateMinutes;
          if (wait < MIN_TRANSFER_MINUTES) continue;
          if (leg2DepMinutes - depMinutes >= input.withinMinutes) break;

          const leg2Trip = gtfs.tripsById.get(leg2Dep.tripId);
          if (!leg2Trip) continue;
          if (!serviceRunsOn(gtfs, leg2Trip.serviceId, gtfsDate)) continue;
          const leg2Stops = gtfs.stopTimesByTrip.get(leg2Dep.tripId);
          if (!leg2Stops) continue;

          for (const onward of leg2Stops) {
            if (onward.stopSequence <= leg2Dep.stopSequence) continue;
            if (onward.stopId === fromId) continue;
            const totalDuration = toMinutesGtfs(onward.arrivalTime) - depMinutes;
            if (totalDuration <= 0) continue;
            if (totalDuration > input.withinMinutes) break;
            const interchangeName = gtfs.stopsById.get(intermediate.stopId)?.stopName ?? intermediate.stopId;
            updateBest(best, onward.stopId, {
              durationMinutes: totalDuration,
              arrivalTime: onward.arrivalTime.slice(0, 5),
              viaTransfer: interchangeName,
            });
          }
        }
      }
    }
  }

  const stations: ReachableStation[] = [];
  for (const [stopId, entry] of best) {
    const station = gtfs.stopsById.get(stopId);
    if (!station) continue;
    stations.push({
      stopId,
      stopName: station.stopName,
      durationMinutes: entry.durationMinutes,
      arrivalTime: entry.arrivalTime,
      viaTransfer: entry.viaTransfer,
    });
  }

  stations.sort((a, b) =>
    a.durationMinutes - b.durationMinutes
    || a.stopName.localeCompare(b.stopName),
  );

  return {
    status: "ok",
    from: fromMatch.station.stopName,
    date: input.date,
    withinMinutes: input.withinMinutes,
    maxTransfers: input.maxTransfers,
    stations: stations.slice(0, MAX_RESULTS),
  };
}

function updateBest(
  best: Map<string, { durationMinutes: number; arrivalTime: string; viaTransfer: string | null }>,
  stopId: string,
  candidate: { durationMinutes: number; arrivalTime: string; viaTransfer: string | null },
): void {
  const prev = best.get(stopId);
  if (!prev || candidate.durationMinutes < prev.durationMinutes) {
    best.set(stopId, candidate);
  }
}

function toCandidate(s: Station): StationCandidate {
  return { stopId: s.stopId, stopName: s.stopName };
}
