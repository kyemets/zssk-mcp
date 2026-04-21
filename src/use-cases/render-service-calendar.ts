import type { GtfsIndex } from "../entities/gtfs-index.js";
import { serviceRunsOn } from "./service-calendar.js";

export type RenderServiceCalendarInput = Readonly<{
  trainNumber: string;
  month: string;
}>;

export type RenderServiceCalendarResult =
  | Readonly<{
      status: "ok";
      trainNumber: string;
      month: string;
      calendar: string;
      runningDays: ReadonlyArray<string>;
      totalRunningDays: number;
      matchedTripIds: ReadonlyArray<string>;
    }>
  | Readonly<{ status: "no_match"; trainNumber: string }>
  | Readonly<{ status: "invalid_month"; month: string }>
  | Readonly<{ status: "month_out_of_range"; month: string; feedStartDate: string; feedEndDate: string }>;

// Month-grid showing which days a train actually runs. Produces a compact
// fixed-width text block the client can drop into a chat message.
// Symbols:
//   ●   = runs on this day
//   ·   = doesn't run
//   _   = day outside the feed's validity window (we can't answer)
//   <space> = placeholder (month doesn't start on Monday)
export function renderServiceCalendar(
  gtfs: GtfsIndex,
  input: RenderServiceCalendarInput,
): RenderServiceCalendarResult {
  if (!/^\d{4}-\d{2}$/.test(input.month)) {
    return { status: "invalid_month", month: input.month };
  }

  const year = Number(input.month.slice(0, 4));
  const monthIdx = Number(input.month.slice(5, 7)) - 1;
  if (monthIdx < 0 || monthIdx > 11) {
    return { status: "invalid_month", month: input.month };
  }

  const monthStart = `${pad4(year)}${pad2(monthIdx + 1)}01`;
  const daysInMonth = new Date(Date.UTC(year, monthIdx + 1, 0)).getUTCDate();
  const monthEnd = `${pad4(year)}${pad2(monthIdx + 1)}${pad2(daysInMonth)}`;

  // If the whole requested month is fully outside the feed window, the answer
  // is genuinely unknown — bail with an explicit status rather than rendering
  // a grid of underscores.
  if (gtfs.feedEndDate && monthStart > gtfs.feedEndDate) {
    return { status: "month_out_of_range", month: input.month, feedStartDate: gtfs.feedStartDate, feedEndDate: gtfs.feedEndDate };
  }
  if (gtfs.feedStartDate && monthEnd < gtfs.feedStartDate) {
    return { status: "month_out_of_range", month: input.month, feedStartDate: gtfs.feedStartDate, feedEndDate: gtfs.feedEndDate };
  }

  const query = normalizeNumber(input.trainNumber);
  const matchedServiceIds = new Set<string>();
  const matchedTripIds: string[] = [];
  for (const trip of gtfs.tripsById.values()) {
    const route = gtfs.routesById.get(trip.routeId);
    const routeShort = normalizeNumber(route?.shortName ?? "");
    const tripShort = normalizeNumber(trip.shortName);
    if (routeShort !== query && tripShort !== query) continue;
    matchedServiceIds.add(trip.serviceId);
    matchedTripIds.push(trip.tripId);
  }
  if (matchedServiceIds.size === 0) {
    return { status: "no_match", trainNumber: input.trainNumber };
  }

  const runningDays: string[] = [];
  const glyphByDay: string[] = [];
  for (let day = 1; day <= daysInMonth; day += 1) {
    const iso = `${pad4(year)}-${pad2(monthIdx + 1)}-${pad2(day)}`;
    const gtfsDate = `${pad4(year)}${pad2(monthIdx + 1)}${pad2(day)}`;
    if (
      (gtfs.feedStartDate && gtfsDate < gtfs.feedStartDate)
      || (gtfs.feedEndDate && gtfsDate > gtfs.feedEndDate)
    ) {
      glyphByDay.push("_");
      continue;
    }
    const runs = Array.from(matchedServiceIds).some(sid => serviceRunsOn(gtfs, sid, gtfsDate));
    glyphByDay.push(runs ? "●" : "·");
    if (runs) runningDays.push(iso);
  }

  const calendar = renderGrid(year, monthIdx, glyphByDay);
  return {
    status: "ok",
    trainNumber: input.trainNumber,
    month: input.month,
    calendar,
    runningDays,
    totalRunningDays: runningDays.length,
    matchedTripIds,
  };
}

function renderGrid(year: number, monthIdx: number, glyphs: ReadonlyArray<string>): string {
  const lines: string[] = [];
  lines.push(`${MONTH_NAMES[monthIdx]} ${year}`);
  lines.push("Mo Tu We Th Fr Sa Su");

  // JS getUTCDay(): 0=Sun..6=Sat. Shift so Monday=0.
  const firstDay = new Date(Date.UTC(year, monthIdx, 1)).getUTCDay();
  const mondayIndexed = (firstDay + 6) % 7;
  const cells: string[] = Array.from({ length: mondayIndexed }, () => "  ");
  for (const g of glyphs) cells.push(` ${g}`);

  for (let i = 0; i < cells.length; i += 7) {
    lines.push(cells.slice(i, i + 7).join(" ").trimEnd());
  }

  lines.push("");
  lines.push("Legend: ● runs · doesn't run _ outside feed");
  return lines.join("\n");
}

function normalizeNumber(s: string): string {
  return s.trim().toLowerCase().replaceAll(/\s+/g, " ");
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function pad4(n: number): string {
  return n < 1000 ? `0${pad2(Math.floor(n / 100))}${pad2(n % 100)}` : String(n);
}

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
] as const;
