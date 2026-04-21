import type { GtfsIndex } from "../entities/gtfs-index.js";
import { serviceRunsOn, toGtfsDate, checkDateInRange, toMinutesGtfs } from "./service-calendar.js";
import { detectBorderCrossing } from "./border-crossing.js";

export type RenderTripRouteInput = Readonly<{
  tripId: string;
  date: string;
}>;

export type RenderTripRouteResult =
  | Readonly<{
      status: "ok";
      tripId: string;
      date: string;
      route: string;
      summary: Readonly<{
        trainNumber: string;
        trainName: string | null;
        agency: string;
        fromStop: string;
        toStop: string;
        departureTime: string;
        arrivalTime: string;
        durationMinutes: number;
        stops: number;
        wheelchairAccessible: 0 | 1 | 2;
        international: boolean;
        borderCountries: ReadonlyArray<string>;
      }>;
    }>
  | Readonly<{ status: "trip_not_found"; tripId: string }>
  | Readonly<{ status: "not_running"; tripId: string; date: string }>
  | Readonly<{ status: "date_out_of_range"; date: string; feedStartDate: string; feedEndDate: string }>;

// Multiline ASCII timeline of one trip's stops. Designed to render inside a
// chat message — fixed-width font assumed, minimal Unicode:
//   ● filled stop marker, │ line connector, → direction arrow.
// The client can display it verbatim or re-format; the structured `summary`
// is preserved alongside so nothing is lost to ASCII.
export function renderTripRoute(gtfs: GtfsIndex, input: RenderTripRouteInput): RenderTripRouteResult {
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

  const gtfsDate = toGtfsDate(input.date);
  if (!serviceRunsOn(gtfs, trip.serviceId, gtfsDate)) {
    return { status: "not_running", tripId: input.tripId, date: input.date };
  }

  const stopTimes = gtfs.stopTimesByTrip.get(input.tripId);
  if (!stopTimes || stopTimes.length < 2) {
    return { status: "trip_not_found", tripId: input.tripId };
  }

  const first = stopTimes[0];
  const last = stopTimes[stopTimes.length - 1];
  if (!first || !last) return { status: "trip_not_found", tripId: input.tripId };

  const route = gtfs.routesById.get(trip.routeId);
  const agency = route ? gtfs.agenciesById.get(route.agencyId) : undefined;
  const trainNumber = (route?.shortName || trip.shortName || trip.tripId).trim();
  const trainName = route?.longName ? route.longName : null;
  const fromStop = gtfs.stopsById.get(first.stopId)?.stopName ?? first.stopId;
  const toStop = gtfs.stopsById.get(last.stopId)?.stopName ?? last.stopId;
  const duration = toMinutesGtfs(last.arrivalTime) - toMinutesGtfs(first.departureTime);
  const border = detectBorderCrossing(stopTimes, trip.headsign, gtfs);

  const lines: string[] = [];

  lines.push(
    `${trainNumber}${trainName ? ` ${trainName}` : ""} · ${fromStop} → ${toStop} · ${input.date}`,
  );
  const metaBits = [
    `duration ${formatDuration(duration)}`,
    `${stopTimes.length} stops`,
    agency ? agency.agencyName : null,
    trip.wheelchairAccessible === 1 ? "♿ accessible" : null,
    border.international ? `⇄ ${border.countries.join(",")}` : null,
  ].filter((x): x is string => x !== null);
  lines.push(metaBits.join(" · "));
  lines.push("");

  for (let i = 0; i < stopTimes.length; i += 1) {
    const st = stopTimes[i];
    if (!st) continue;
    const stopName = gtfs.stopsById.get(st.stopId)?.stopName ?? st.stopId;
    const isFirst = i === 0;
    const isLast = i === stopTimes.length - 1;
    const time = (isFirst ? st.departureTime : st.arrivalTime).slice(0, 5);
    const dwell = isFirst || isLast
      ? 0
      : toMinutesGtfs(st.departureTime) - toMinutesGtfs(st.arrivalTime);
    const dwellSuffix = dwell >= 2 ? ` (${dwell} min stop)` : "";
    lines.push(`${time}  ● ${stopName}${dwellSuffix}`);
    if (!isLast) lines.push(`       │`);
  }

  return {
    status: "ok",
    tripId: input.tripId,
    date: input.date,
    route: lines.join("\n"),
    summary: {
      trainNumber,
      trainName,
      agency: agency?.agencyName ?? "",
      fromStop,
      toStop,
      departureTime: first.departureTime.slice(0, 5),
      arrivalTime: last.arrivalTime.slice(0, 5),
      durationMinutes: duration,
      stops: stopTimes.length,
      wheelchairAccessible: trip.wheelchairAccessible,
      international: border.international,
      borderCountries: border.countries,
    },
  };
}

function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}
