import type { GtfsIndex } from "../entities/gtfs-index.js";
import {
  serviceRunsOn,
  toGtfsDate,
  checkDateInRange,
} from "./service-calendar.js";

export type ExportIcsInput = Readonly<{
  tripId: string;
  date: string;
}>;

export type ExportIcsResult =
  | Readonly<{ status: "ok"; ics: string; tripId: string; date: string }>
  | Readonly<{ status: "trip_not_found"; tripId: string }>
  | Readonly<{ status: "not_running"; tripId: string; date: string }>
  | Readonly<{
      status: "date_out_of_range";
      date: string;
      feedStartDate: string;
      feedEndDate: string;
    }>;

export function exportIcs(
  gtfs: GtfsIndex,
  input: ExportIcsInput,
): ExportIcsResult {
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
  if (!stopTimes || stopTimes.length === 0) {
    return { status: "trip_not_found", tripId: input.tripId };
  }
  const first = stopTimes[0];
  const last = stopTimes[stopTimes.length - 1];
  if (!first || !last)
    return { status: "trip_not_found", tripId: input.tripId };

  const route = gtfs.routesById.get(trip.routeId);
  const trainNumber = (
    route?.shortName ||
    trip.shortName ||
    trip.tripId
  ).trim();
  const fromName = gtfs.stopsById.get(first.stopId)?.stopName ?? first.stopId;
  const toName = gtfs.stopsById.get(last.stopId)?.stopName ?? last.stopId;

  const description = stopTimes
    .map((st) => {
      const stopName = gtfs.stopsById.get(st.stopId)?.stopName ?? st.stopId;
      return `${st.departureTime.slice(0, 5)}  ${stopName}`;
    })
    .join("\n");

  const ics = buildIcs({
    uid: `${trip.tripId}-${gtfsDate}@zssk-mcp`,
    summary: `${trainNumber} ${fromName} → ${toName}`,
    description,
    location: fromName,
    startDate: gtfsDate,
    startTime: first.departureTime,
    endDate: gtfsDate,
    endTime: last.arrivalTime,
  });

  return { status: "ok", ics, tripId: input.tripId, date: input.date };
}

type IcsEvent = Readonly<{
  uid: string;
  summary: string;
  description: string;
  location: string;
  startDate: string;
  startTime: string;
  endDate: string;
  endTime: string;
}>;

function buildIcs(ev: IcsEvent): string {
  const stampUtc = toUtcStamp(new Date());
  const start = resolveDateTime(ev.startDate, ev.startTime);
  const end = resolveDateTime(ev.endDate, ev.endTime);

  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//zssk-mcp//v0.5//EN",
    "CALSCALE:GREGORIAN",
    "BEGIN:VEVENT",
    `UID:${escapeIcs(ev.uid)}`,
    `DTSTAMP:${stampUtc}`,
    `DTSTART;TZID=Europe/Bratislava:${start.date}T${start.time}`,
    `DTEND;TZID=Europe/Bratislava:${end.date}T${end.time}`,
    `SUMMARY:${escapeIcs(ev.summary)}`,
    `LOCATION:${escapeIcs(ev.location)}`,
    `DESCRIPTION:${escapeIcs(ev.description)}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");
}

// GTFS times may exceed 24:00 (e.g. "26:15:00" = 02:15 the next day).
// Bump the calendar date and wrap the hour so the iCal time parses cleanly.
function resolveDateTime(
  yyyymmdd: string,
  gtfsTime: string,
): { date: string; time: string } {
  const parts = gtfsTime.split(":");
  let hours = Number(parts[0] ?? 0);
  const minutes = Number(parts[1] ?? 0);
  const seconds = Number(parts[2] ?? 0);
  let date = yyyymmdd;
  while (hours >= 24) {
    hours -= 24;
    date = addOneDay(date);
  }
  return { date, time: `${pad2(hours)}${pad2(minutes)}${pad2(seconds)}` };
}

function addOneDay(yyyymmdd: string): string {
  const y = Number(yyyymmdd.slice(0, 4));
  const m = Number(yyyymmdd.slice(4, 6));
  const d = Number(yyyymmdd.slice(6, 8));
  const next = new Date(Date.UTC(y, m - 1, d + 1));
  return `${next.getUTCFullYear()}${pad2(next.getUTCMonth() + 1)}${pad2(next.getUTCDate())}`;
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function toUtcStamp(d: Date): string {
  return (
    `${d.getUTCFullYear()}${pad2(d.getUTCMonth() + 1)}${pad2(d.getUTCDate())}` +
    `T${pad2(d.getUTCHours())}${pad2(d.getUTCMinutes())}${pad2(d.getUTCSeconds())}Z`
  );
}

function escapeIcs(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/\r?\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
}
