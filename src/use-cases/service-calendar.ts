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
