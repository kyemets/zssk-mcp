import type { GtfsIndex } from "../entities/gtfs-index.js";

// Warn when the feed is within its last 14 days of validity so callers can
// surface "schedule expires soon" to users and operators can refresh the
// cache before the grafikon switchover.
const WARN_WINDOW_DAYS = 14;

export type FeedWarning = Readonly<{
  severity: "warning" | "expired";
  message: string;
  daysRemaining: number;
  feedEndDate: string;
}>;

export function getFeedWarning(
  gtfs: GtfsIndex,
  today: Date = new Date(),
): FeedWarning | null {
  if (!gtfs.feedEndDate || !/^\d{8}$/.test(gtfs.feedEndDate)) return null;
  const endYear = Number(gtfs.feedEndDate.slice(0, 4));
  const endMonth = Number(gtfs.feedEndDate.slice(4, 6));
  const endDay = Number(gtfs.feedEndDate.slice(6, 8));
  const endMs = Date.UTC(endYear, endMonth - 1, endDay);
  const todayMs = Date.UTC(
    today.getUTCFullYear(),
    today.getUTCMonth(),
    today.getUTCDate(),
  );
  const daysRemaining = Math.floor((endMs - todayMs) / (24 * 60 * 60 * 1000));

  if (daysRemaining < 0) {
    return {
      severity: "expired",
      message: `GTFS feed expired on ${formatDate(gtfs.feedEndDate)}. Data shown may no longer reflect the current timetable.`,
      daysRemaining,
      feedEndDate: gtfs.feedEndDate,
    };
  }
  if (daysRemaining <= WARN_WINDOW_DAYS) {
    return {
      severity: "warning",
      message: `GTFS feed validity ends on ${formatDate(gtfs.feedEndDate)} (${daysRemaining} day${daysRemaining === 1 ? "" : "s"} left). Refresh with ZSSK_GTFS_REFRESH=1 near the grafikon change.`,
      daysRemaining,
      feedEndDate: gtfs.feedEndDate,
    };
  }
  return null;
}

function formatDate(yyyymmdd: string): string {
  return `${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6, 8)}`;
}

// Snapshot of the loaded feed. Used by both the zssk://feed/info MCP resource
// and smoke tests, so it lives with the rest of the feed-status logic instead
// of in the adapter.
export type FeedInfoSnapshot = Readonly<{
  feedVersion: string;
  feedStartDate: string;
  feedEndDate: string;
  agencies: ReadonlyArray<{ agencyId: string; agencyName: string }>;
  counts: Readonly<{
    stops: number;
    trips: number;
    routes: number;
    services: number;
    stopTimes: number;
  }>;
  warning: FeedWarning | null;
}>;

export function buildFeedInfo(gtfs: GtfsIndex): FeedInfoSnapshot {
  const stopTimes = Array.from(gtfs.stopTimesByTrip.values()).reduce(
    (n, a) => n + a.length,
    0,
  );
  return {
    feedVersion: gtfs.feedVersion,
    feedStartDate: gtfs.feedStartDate,
    feedEndDate: gtfs.feedEndDate,
    agencies: Array.from(gtfs.agenciesById.values()).map((a) => ({
      agencyId: a.agencyId,
      agencyName: a.agencyName,
    })),
    counts: {
      stops: gtfs.stopsById.size,
      trips: gtfs.tripsById.size,
      routes: gtfs.routesById.size,
      services: gtfs.servicesById.size,
      stopTimes,
    },
    warning: getFeedWarning(gtfs),
  };
}
