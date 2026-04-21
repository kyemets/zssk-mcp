import type { GtfsIndex } from "../entities/gtfs-index.js";

// GTFS spec: calendar_dates exceptions fully override the weekly pattern.
export function serviceRunsOn(gtfs: GtfsIndex, serviceId: string, yyyymmdd: string): boolean {
  const svc = gtfs.servicesById.get(serviceId);
  if (!svc) return false;

  const exception = svc.dateExceptions.get(yyyymmdd);
  if (exception === 1) return true;
  if (exception === 2) return false;

  if (yyyymmdd < svc.startDate || yyyymmdd > svc.endDate) return false;
  const dow = mondayIndexedDayOfWeek(yyyymmdd);
  return svc.weekly[dow] ?? false;
}

// UTC deliberate: service day is a calendar label, not a clock timestamp —
// using local time would flip the weekday on hosts west of Europe/Bratislava.
function mondayIndexedDayOfWeek(yyyymmdd: string): number {
  const year = Number(yyyymmdd.slice(0, 4));
  const month = Number(yyyymmdd.slice(4, 6));
  const day = Number(yyyymmdd.slice(6, 8));
  const jsDay = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return (jsDay + 6) % 7;
}

export function toGtfsDate(isoDate: string): string {
  return isoDate.replaceAll("-", "");
}

export type DateRangeCheck =
  | Readonly<{ ok: true }>
  | Readonly<{ ok: false; feedStartDate: string; feedEndDate: string }>;

// Separates "date is outside the feed's validity window" (→ honest
// date_out_of_range to the caller) from "date is inside but no trains run
// that day" (→ empty results list).
export function checkDateInRange(gtfs: { feedStartDate: string; feedEndDate: string }, isoDate: string): DateRangeCheck {
  if (!gtfs.feedStartDate || !gtfs.feedEndDate) return { ok: true };
  const gtfsDate = toGtfsDate(isoDate);
  if (gtfsDate < gtfs.feedStartDate || gtfsDate > gtfs.feedEndDate) {
    return { ok: false, feedStartDate: gtfs.feedStartDate, feedEndDate: gtfs.feedEndDate };
  }
  return { ok: true };
}
