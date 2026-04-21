import type { GtfsIndex } from "../entities/gtfs-index.js";
import { serviceRunsOn, toGtfsDate, checkDateInRange, toMinutesGtfs } from "./service-calendar.js";
import { detectBorderCrossing } from "./border-crossing.js";
import { makeProjector, svgEscape, type LatLon } from "./svg-projection.js";

export type RenderTripMapInput = Readonly<{
  tripId: string;
  date: string;
}>;

export type RenderTripMapResult =
  | Readonly<{
      status: "ok";
      tripId: string;
      date: string;
      svg: string;
      summary: Readonly<{
        trainNumber: string;
        trainName: string | null;
        agency: string;
        from: string;
        to: string;
        durationMinutes: number;
        stops: number;
        routeColor: string | null;
        international: boolean;
        borderCountries: ReadonlyArray<string>;
      }>;
    }>
  | Readonly<{ status: "trip_not_found"; tripId: string }>
  | Readonly<{ status: "not_running"; tripId: string; date: string }>
  | Readonly<{ status: "no_coordinates"; tripId: string }>
  | Readonly<{ status: "date_out_of_range"; date: string; feedStartDate: string; feedEndDate: string }>;

// Visual style constants — kept together so the whole map look-and-feel is
// tweakable from one place.
const VIEW_WIDTH = 960;
const VIEW_HEIGHT = 540;
const PADDING = 60;
const BG_FILL = "#F7F8FA";
const LINE_DEFAULT = "#2D6CDF";
const LABEL_DARK = "#1F2937";
const LABEL_MUTED = "#6B7280";
const ENDPOINT_RADIUS = 7;
const STOP_RADIUS = 4;

export function renderTripMap(gtfs: GtfsIndex, input: RenderTripMapInput): RenderTripMapResult {
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
  if (!serviceRunsOn(gtfs, trip.serviceId, toGtfsDate(input.date))) {
    return { status: "not_running", tripId: input.tripId, date: input.date };
  }

  const stopTimes = gtfs.stopTimesByTrip.get(input.tripId);
  if (!stopTimes || stopTimes.length < 2) {
    return { status: "trip_not_found", tripId: input.tripId };
  }

  // Collect stops with known coordinates; we silently drop stops with
  // missing lat/lon from the geometry but keep them in the narrative.
  type PlottedStop = Readonly<{
    lat: number;
    lon: number;
    stopName: string;
    arrivalTime: string;
    departureTime: string;
  }>;
  const plotted: PlottedStop[] = [];
  for (const st of stopTimes) {
    const station = gtfs.stopsById.get(st.stopId);
    if (!station) continue;
    if (station.stopLat === 0 && station.stopLon === 0) continue;
    plotted.push({
      lat: station.stopLat,
      lon: station.stopLon,
      stopName: station.stopName,
      arrivalTime: st.arrivalTime.slice(0, 5),
      departureTime: st.departureTime.slice(0, 5),
    });
  }

  if (plotted.length < 2) {
    return { status: "no_coordinates", tripId: input.tripId };
  }

  const first = stopTimes[0];
  const last = stopTimes[stopTimes.length - 1];
  if (!first || !last) return { status: "trip_not_found", tripId: input.tripId };

  const route = gtfs.routesById.get(trip.routeId);
  const trainNumber = (route?.shortName || trip.shortName || trip.tripId).trim();
  const trainName = route?.longName ? route.longName : null;
  const agency = route ? gtfs.agenciesById.get(route.agencyId) : undefined;
  const agencyName = agency?.agencyName ?? "";
  const fromName = gtfs.stopsById.get(first.stopId)?.stopName ?? first.stopId;
  const toName = gtfs.stopsById.get(last.stopId)?.stopName ?? last.stopId;
  const duration = toMinutesGtfs(last.arrivalTime) - toMinutesGtfs(first.departureTime);
  const border = detectBorderCrossing(stopTimes, trip.headsign, gtfs);

  const routeColor = route?.color ? `#${route.color}` : LINE_DEFAULT;
  const projector = makeProjector(plotted as ReadonlyArray<LatLon>, {
    width: VIEW_WIDTH,
    height: VIEW_HEIGHT,
    padding: PADDING,
  });

  const svg = buildSvg({
    trainNumber,
    trainName,
    agencyName,
    fromName,
    toName,
    duration,
    totalStops: stopTimes.length,
    plottedStops: plotted,
    projector,
    routeColor,
    international: border.international,
    borderCountries: border.countries,
    date: input.date,
  });

  return {
    status: "ok",
    tripId: input.tripId,
    date: input.date,
    svg,
    summary: {
      trainNumber,
      trainName,
      agency: agencyName,
      from: fromName,
      to: toName,
      durationMinutes: duration,
      stops: stopTimes.length,
      routeColor: route?.color ?? null,
      international: border.international,
      borderCountries: border.countries,
    },
  };
}

type BuildInput = Readonly<{
  trainNumber: string;
  trainName: string | null;
  agencyName: string;
  fromName: string;
  toName: string;
  duration: number;
  totalStops: number;
  plottedStops: ReadonlyArray<Readonly<{
    lat: number;
    lon: number;
    stopName: string;
    arrivalTime: string;
    departureTime: string;
  }>>;
  projector: ReturnType<typeof makeProjector>;
  routeColor: string;
  international: boolean;
  borderCountries: ReadonlyArray<string>;
  date: string;
}>;

function buildSvg(input: BuildInput): string {
  const { projector, plottedStops, routeColor } = input;

  // Pre-compute projected points — we reference them multiple times (line,
  // circles, labels).
  const points = plottedStops.map(s => ({
    ...s,
    ...projector.project({ lat: s.lat, lon: s.lon }),
  }));

  const polyline = points.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");

  const headerLine = input.trainName
    ? `${input.trainNumber} ${input.trainName}`
    : input.trainNumber;
  const subLine = `${input.fromName} → ${input.toName} · ${input.date} · ${formatDuration(input.duration)} · ${input.totalStops} stops`;
  const footerBits = [
    input.agencyName,
    input.international ? `international · ${input.borderCountries.join(", ")}` : null,
  ].filter((x): x is string => x !== null);
  const footerLine = footerBits.join("  ·  ");

  const endpointsSet = new Set([0, points.length - 1]);

  const stopCircles = points
    .map((p, i) => {
      const r = endpointsSet.has(i) ? ENDPOINT_RADIUS : STOP_RADIUS;
      return (
        `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${r}" `
        + `fill="${routeColor}" stroke="#FFFFFF" stroke-width="2">`
        + `<title>${svgEscape(p.stopName)} · ${svgEscape(p.arrivalTime)}</title>`
        + `</circle>`
      );
    })
    .join("");

  const stopLabels = points
    .map((p, i) => renderLabel(p, i, points.length))
    .join("");

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${projector.viewBox}" `
    + `preserveAspectRatio="xMidYMid meet" role="img" `
    + `aria-label="${svgEscape(`${headerLine}: ${subLine}`)}">`
    + `<title>${svgEscape(`${headerLine} · ${subLine}`)}</title>`
    + `<rect width="100%" height="100%" fill="${BG_FILL}"/>`
    + `<text x="24" y="32" font-family="system-ui,sans-serif" font-size="18" font-weight="700" fill="${LABEL_DARK}">${svgEscape(headerLine)}</text>`
    + `<text x="24" y="54" font-family="system-ui,sans-serif" font-size="12" fill="${LABEL_MUTED}">${svgEscape(subLine)}</text>`
    + `<polyline points="${polyline}" fill="none" stroke="${routeColor}" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round" opacity="0.9"/>`
    + stopCircles
    + stopLabels
    + (footerLine
      ? `<text x="24" y="${VIEW_HEIGHT - 18}" font-family="system-ui,sans-serif" font-size="11" fill="${LABEL_MUTED}">${svgEscape(footerLine)}</text>`
      : "")
    + `</svg>`
  );
}

function renderLabel(
  p: Readonly<{ x: number; y: number; stopName: string; arrivalTime: string; departureTime: string }>,
  index: number,
  total: number,
): string {
  const isFirst = index === 0;
  const isLast = index === total - 1;
  const isEndpoint = isFirst || isLast;

  // Endpoint labels: full station name + time, bold.
  if (isEndpoint) {
    const anchor = isFirst ? "start" : "end";
    const offsetX = isFirst ? 12 : -12;
    const offsetY = -14;
    const time = isFirst ? p.departureTime : p.arrivalTime;
    return (
      `<g>`
      + `<text x="${(p.x + offsetX).toFixed(1)}" y="${(p.y + offsetY).toFixed(1)}" `
      + `text-anchor="${anchor}" font-family="system-ui,sans-serif" `
      + `font-size="12" font-weight="700" fill="${LABEL_DARK}">`
      + `${svgEscape(p.stopName)}</text>`
      + `<text x="${(p.x + offsetX).toFixed(1)}" y="${(p.y + offsetY + 14).toFixed(1)}" `
      + `text-anchor="${anchor}" font-family="system-ui,sans-serif" `
      + `font-size="11" fill="${LABEL_MUTED}">${svgEscape(time)}</text>`
      + `</g>`
    );
  }

  // Intermediate stops: stagger labels above/below the line so they don't
  // stack on top of each other. Only the time; the station name is in the
  // circle's <title> tooltip to keep the map uncluttered.
  const above = index % 2 === 0;
  const offsetY = above ? -10 : 22;
  return (
    `<text x="${p.x.toFixed(1)}" y="${(p.y + offsetY).toFixed(1)}" `
    + `text-anchor="middle" font-family="system-ui,sans-serif" `
    + `font-size="9" fill="${LABEL_MUTED}">${svgEscape(p.arrivalTime)}</text>`
  );
}

function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}
