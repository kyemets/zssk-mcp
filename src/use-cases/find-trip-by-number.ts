import type { GtfsIndex } from "../entities/gtfs-index.js";
import {
  serviceRunsOn,
  toGtfsDate,
  checkDateInRange,
  toMinutesGtfs,
} from "./service-calendar.js";
import { buildBookingLink, type BookingLink } from "./booking-link.js";
import { detectBorderCrossing } from "./border-crossing.js";

export type FindTripByNumberInput = Readonly<{
  trainNumber: string;
  date: string;
  wheelchairOnly: boolean;
}>;

export type StopVisit = Readonly<{
  stopSequence: number;
  stopId: string;
  stopName: string;
  arrivalTime: string;
  departureTime: string;
  platformCode: string | null;
}>;

export type TripDetails = Readonly<{
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
  international: boolean;
  borderCountries: ReadonlyArray<string>;
  booking: BookingLink;
  stops: ReadonlyArray<StopVisit>;
}>;

export type FindTripByNumberResult =
  | Readonly<{
      status: "ok";
      trainNumber: string;
      date: string;
      trips: ReadonlyArray<TripDetails>;
    }>
  | Readonly<{ status: "no_match"; trainNumber: string; date: string }>
  | Readonly<{
      status: "date_out_of_range";
      date: string;
      feedStartDate: string;
      feedEndDate: string;
    }>;

export function findTripByNumber(
  gtfs: GtfsIndex,
  input: FindTripByNumberInput,
): FindTripByNumberResult {
  const dateCheck = checkDateInRange(gtfs, input.date);
  if (!dateCheck.ok) {
    return {
      status: "date_out_of_range",
      date: input.date,
      feedStartDate: dateCheck.feedStartDate,
      feedEndDate: dateCheck.feedEndDate,
    };
  }

  const query = normalizeNumber(input.trainNumber);
  if (!query)
    return {
      status: "no_match",
      trainNumber: input.trainNumber,
      date: input.date,
    };

  const gtfsDate = toGtfsDate(input.date);
  const matches: TripDetails[] = [];

  for (const trip of gtfs.tripsById.values()) {
    const route = gtfs.routesById.get(trip.routeId);
    const routeShort = normalizeNumber(route?.shortName ?? "");
    const tripShort = normalizeNumber(trip.shortName);
    if (routeShort !== query && tripShort !== query) continue;
    if (!serviceRunsOn(gtfs, trip.serviceId, gtfsDate)) continue;
    if (input.wheelchairOnly && trip.wheelchairAccessible !== 1) continue;

    const stopTimes = gtfs.stopTimesByTrip.get(trip.tripId);
    if (!stopTimes || stopTimes.length === 0) continue;

    const firstStop = stopTimes[0];
    const lastStop = stopTimes[stopTimes.length - 1];
    if (!firstStop || !lastStop) continue;

    const agency = route ? gtfs.agenciesById.get(route.agencyId) : undefined;
    const agencyName = agency?.agencyName ?? "";
    const fromName =
      gtfs.stopsById.get(firstStop.stopId)?.stopName ?? firstStop.stopId;
    const toName =
      gtfs.stopsById.get(lastStop.stopId)?.stopName ?? lastStop.stopId;
    const border = detectBorderCrossing(stopTimes, trip.headsign, gtfs);
    const booking = buildBookingLink(agency, {
      from: fromName,
      to: toName,
      date: input.date,
      departureTime: firstStop.departureTime.slice(0, 5),
    });

    matches.push({
      tripId: trip.tripId,
      trainNumber: (route?.shortName || trip.shortName || trip.tripId).trim(),
      trainName: route?.longName ? route.longName : null,
      agency: agencyName,
      headsign: trip.headsign,
      fromStop: fromName,
      toStop: toName,
      departureTime: firstStop.departureTime.slice(0, 5),
      arrivalTime: lastStop.arrivalTime.slice(0, 5),
      durationMinutes:
        toMinutesGtfs(lastStop.arrivalTime) -
        toMinutesGtfs(firstStop.departureTime),
      wheelchairAccessible: trip.wheelchairAccessible,
      international: border.international,
      borderCountries: border.countries,
      booking,
      stops: stopTimes.map((st) => {
        const station = gtfs.stopsById.get(st.stopId);
        return {
          stopSequence: st.stopSequence,
          stopId: st.stopId,
          stopName: station?.stopName ?? st.stopId,
          arrivalTime: st.arrivalTime.slice(0, 5),
          departureTime: st.departureTime.slice(0, 5),
          platformCode: station?.platformCode ?? null,
        };
      }),
    });
  }

  if (matches.length === 0) {
    return {
      status: "no_match",
      trainNumber: input.trainNumber,
      date: input.date,
    };
  }
  matches.sort((a, b) => a.departureTime.localeCompare(b.departureTime));
  return {
    status: "ok",
    trainNumber: input.trainNumber,
    date: input.date,
    trips: matches,
  };
}

function normalizeNumber(s: string): string {
  return s.trim().toLowerCase().replaceAll(/\s+/g, " ");
}
