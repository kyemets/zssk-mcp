import type { GtfsIndex } from "../entities/gtfs-index.js";
import { resolveStation } from "./resolve-station.js";
import { serviceRunsOn, toGtfsDate, checkDateInRange, toMinutesGtfs } from "./service-calendar.js";

export type RenderTimetableChartInput = Readonly<{
  station: string;
  date: string;
}>;

export type RenderTimetableChartResult =
  | Readonly<{
      status: "ok";
      station: string;
      date: string;
      chart: string;
      totalDepartures: number;
      byHour: ReadonlyArray<number>;
    }>
  | Readonly<{ status: "ambiguous"; candidates: ReadonlyArray<Readonly<{ stopId: string; stopName: string }>> }>
  | Readonly<{ status: "no_match" }>
  | Readonly<{ status: "date_out_of_range"; date: string; feedStartDate: string; feedEndDate: string }>;

// 24-bucket hourly histogram of departures from a station on one date.
// Each row: `HH ●●●●●        (N)`. Hours with zero departures are shown
// too (blank bar) so the rhythm of the day is visible without skipping.
export function renderTimetableChart(
  gtfs: GtfsIndex,
  input: RenderTimetableChartInput,
): RenderTimetableChartResult {
  const dateCheck = checkDateInRange(gtfs, input.date);
  if (!dateCheck.ok) {
    return {
      status: "date_out_of_range",
      date: input.date,
      feedStartDate: dateCheck.feedStartDate,
      feedEndDate: dateCheck.feedEndDate,
    };
  }

  const match = resolveStation(input.station, gtfs.stopsById);
  if (match.kind === "none") return { status: "no_match" };
  if (match.kind === "ambiguous") {
    return {
      status: "ambiguous",
      candidates: match.candidates.map(s => ({ stopId: s.stopId, stopName: s.stopName })),
    };
  }

  const gtfsDate = toGtfsDate(input.date);
  const stopTimes = gtfs.stopTimesByStop.get(match.station.stopId) ?? [];
  // Keep 25 buckets so GTFS post-midnight departures (e.g. 25:xx) don't wrap
  // back into hour 1 and garble the picture.
  const buckets: number[] = Array.from({ length: 26 }, () => 0);
  let total = 0;

  for (const st of stopTimes) {
    const trip = gtfs.tripsById.get(st.tripId);
    if (!trip) continue;
    if (!serviceRunsOn(gtfs, trip.serviceId, gtfsDate)) continue;

    // Terminus rows: arrival == departure, no real departure.
    const tripStops = gtfs.stopTimesByTrip.get(st.tripId);
    const lastStop = tripStops?.[tripStops.length - 1];
    if (lastStop && st.stopSequence === lastStop.stopSequence) continue;

    const hourBucket = Math.floor(toMinutesGtfs(st.departureTime) / 60);
    const clamped = Math.max(0, Math.min(hourBucket, buckets.length - 1));
    const currentCount = buckets[clamped] ?? 0;
    buckets[clamped] = currentCount + 1;
    total += 1;
  }

  // Trim trailing empty post-midnight buckets (24, 25) if unused so the
  // chart doesn't show two empty rows for most stations.
  let lastNonZero = 23;
  for (let i = buckets.length - 1; i > 23; i -= 1) {
    if ((buckets[i] ?? 0) > 0) { lastNonZero = i; break; }
  }

  const lines: string[] = [];
  lines.push(`${match.station.stopName} · ${input.date} · ${total} departures`);
  lines.push("");
  for (let h = 0; h <= lastNonZero; h += 1) {
    const count = buckets[h] ?? 0;
    const bar = "●".repeat(Math.min(count, 30));
    const overflow = count > 30 ? ` +${count - 30}` : "";
    const suffix = count > 0 ? ` (${count})` : "";
    lines.push(`${pad2(h)} ${bar}${overflow}${suffix}`);
  }
  lines.push("");
  lines.push("Each ● = 1 departure");

  return {
    status: "ok",
    station: match.station.stopName,
    date: input.date,
    chart: lines.join("\n"),
    totalDepartures: total,
    byHour: buckets.slice(0, lastNonZero + 1),
  };
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}
