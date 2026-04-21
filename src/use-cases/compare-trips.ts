import type { GtfsIndex } from "../entities/gtfs-index.js";
import { serviceRunsOn, toGtfsDate, checkDateInRange, toMinutesGtfs } from "./service-calendar.js";
import { detectBorderCrossing } from "./border-crossing.js";
import { buildBookingLink, type BookingLink } from "./booking-link.js";
import { buildBadges, type Badge } from "./badges.js";

export type CompareTripsInput = Readonly<{
  tripIds: ReadonlyArray<string>;
  date: string;
}>;

export type ComparedTrip =
  | Readonly<{
      tripId: string;
      status: "ok";
      trainNumber: string;
      trainName: string | null;
      agency: string;
      headsign: string;
      fromStop: string;
      toStop: string;
      departureTime: string;
      arrivalTime: string;
      durationMinutes: number;
      stops: number;
      wheelchairAccessible: 0 | 1 | 2;
      international: boolean;
      borderCountries: ReadonlyArray<string>;
      booking: BookingLink;
      badges: ReadonlyArray<Badge>;
    }>
  | Readonly<{ tripId: string; status: "trip_not_found" }>
  | Readonly<{ tripId: string; status: "not_running"; date: string }>;

export type CompareTripsResult =
  | Readonly<{ status: "ok"; date: string; trips: ReadonlyArray<ComparedTrip> }>
  | Readonly<{ status: "too_few_trips"; tripIds: ReadonlyArray<string> }>
  | Readonly<{ status: "too_many_trips"; tripIds: ReadonlyArray<string>; max: number }>
  | Readonly<{ status: "date_out_of_range"; date: string; feedStartDate: string; feedEndDate: string }>;

const MIN_TRIPS = 2;
const MAX_TRIPS = 5;

// Side-by-side enrichment for 2–5 trip_ids on one date. Each entry either
// carries the full TripDetails-style record or a per-trip error status;
// missing trips don't abort the whole comparison. Deliberately does NOT
// rank ("fastest" / "best") — LLM can see the numbers and decide.
export function compareTrips(gtfs: GtfsIndex, input: CompareTripsInput): CompareTripsResult {
  if (input.tripIds.length < MIN_TRIPS) {
    return { status: "too_few_trips", tripIds: input.tripIds };
  }
  if (input.tripIds.length > MAX_TRIPS) {
    return { status: "too_many_trips", tripIds: input.tripIds, max: MAX_TRIPS };
  }

  const dateCheck = checkDateInRange(gtfs, input.date);
  if (!dateCheck.ok) {
    return {
      status: "date_out_of_range",
      date: input.date,
      feedStartDate: dateCheck.feedStartDate,
      feedEndDate: dateCheck.feedEndDate,
    };
  }

  const gtfsDate = toGtfsDate(input.date);
  const trips: ComparedTrip[] = input.tripIds.map(tripId => {
    const trip = gtfs.tripsById.get(tripId);
    if (!trip) return { tripId, status: "trip_not_found" };
    if (!serviceRunsOn(gtfs, trip.serviceId, gtfsDate)) {
      return { tripId, status: "not_running", date: input.date };
    }

    const stopTimes = gtfs.stopTimesByTrip.get(tripId);
    if (!stopTimes || stopTimes.length < 2) return { tripId, status: "trip_not_found" };
    const first = stopTimes[0];
    const last = stopTimes[stopTimes.length - 1];
    if (!first || !last) return { tripId, status: "trip_not_found" };

    const route = gtfs.routesById.get(trip.routeId);
    const trainNumber = (route?.shortName || trip.shortName || trip.tripId).trim();
    const agency = route ? gtfs.agenciesById.get(route.agencyId) : undefined;
    const fromName = gtfs.stopsById.get(first.stopId)?.stopName ?? first.stopId;
    const toName = gtfs.stopsById.get(last.stopId)?.stopName ?? last.stopId;
    const border = detectBorderCrossing(stopTimes, trip.headsign, gtfs);

    return {
      tripId,
      status: "ok",
      trainNumber,
      trainName: route?.longName ? route.longName : null,
      agency: agency?.agencyName ?? "",
      headsign: trip.headsign,
      fromStop: fromName,
      toStop: toName,
      departureTime: first.departureTime.slice(0, 5),
      arrivalTime: last.arrivalTime.slice(0, 5),
      durationMinutes: toMinutesGtfs(last.arrivalTime) - toMinutesGtfs(first.departureTime),
      stops: stopTimes.length,
      wheelchairAccessible: trip.wheelchairAccessible,
      international: border.international,
      borderCountries: border.countries,
      booking: buildBookingLink(agency, {
        from: fromName,
        to: toName,
        date: input.date,
        departureTime: first.departureTime.slice(0, 5),
      }),
      badges: buildBadges({
        wheelchairAccessible: trip.wheelchairAccessible,
        international: border.international,
        borderCountries: border.countries,
        trainNumber,
      }),
    };
  });

  return { status: "ok", date: input.date, trips };
}
