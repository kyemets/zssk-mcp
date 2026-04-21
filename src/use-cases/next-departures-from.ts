import type { GtfsIndex } from "../entities/gtfs-index.js";
import { getTimetable, type GetTimetableResult } from "./get-timetable.js";

export type NextDeparturesInput = Readonly<{
  station: string;
  limit: number;
}>;

export type NextDeparturesResult =
  | (Extract<GetTimetableResult, { status: "ok" }> & Readonly<{ now: string }>)
  | Exclude<GetTimetableResult, { status: "ok" }>;

// Convenience wrapper: "now" = current wall-clock in Europe/Bratislava, date
// = same-day in that zone. The feed's times are all in Europe/Bratislava, so
// comparing a Bratislava-local HH:MM against the feed's HH:MM is apples to
// apples on any host timezone.
export function nextDeparturesFrom(
  gtfs: GtfsIndex,
  input: NextDeparturesInput,
): NextDeparturesResult {
  const now = new Date();
  const baDate = formatBaDate(now);
  const baTime = formatBaTime(now);

  // Ask for a generous window, then filter + slice client-side. 200 covers
  // even the busiest Bratislava day with headroom; get_timetable already
  // caps at 200 per its own schema.
  const full = getTimetable(gtfs, {
    station: input.station,
    date: baDate,
    limit: 200,
    operator: null,
    trainTypes: null,
    wheelchairOnly: false,
  });

  if (full.status !== "ok") return full;

  const upcoming = full.departures.filter(d => d.departureTime >= baTime);
  return {
    ...full,
    now: baTime,
    departures: upcoming.slice(0, input.limit),
  };
}

// Host-timezone-agnostic "today in Bratislava" helpers via Intl so users in
// Kyiv or Los Angeles still see the same day the feed uses.
function formatBaDate(d: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Bratislava",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);
  return `${findPart(parts, "year")}-${findPart(parts, "month")}-${findPart(parts, "day")}`;
}

function formatBaTime(d: Date): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Bratislava",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(d);
  return `${findPart(parts, "hour")}:${findPart(parts, "minute")}`;
}

function findPart(parts: ReadonlyArray<Intl.DateTimeFormatPart>, type: string): string {
  const p = parts.find(x => x.type === type);
  return p ? p.value : "00";
}
