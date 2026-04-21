import type { GtfsIndex } from "../entities/gtfs-index.js";
import { findReachableStations, type FindReachableInput } from "./find-reachable-stations.js";
import { resolveStation } from "./resolve-station.js";
import { makeProjector, svgEscape, type LatLon } from "./svg-projection.js";

export type RenderReachableMapInput = Readonly<FindReachableInput>;

export type RenderReachableMapResult =
  | Readonly<{
      status: "ok";
      from: string;
      date: string;
      svg: string;
      summary: Readonly<{
        reachable: number;
        withinMinutes: number;
        maxTransfers: 0 | 1;
        plotted: number;
        unplottable: number;
      }>;
    }>
  | Readonly<{ status: "ambiguous"; which: "from"; candidates: ReadonlyArray<Readonly<{ stopId: string; stopName: string }>> }>
  | Readonly<{ status: "no_match"; which: "from" }>
  | Readonly<{ status: "date_out_of_range"; date: string; feedStartDate: string; feedEndDate: string }>;

// Isochrone-style map: origin highlighted, every reachable station as a dot
// colored from green (fast) to red (slow). No route lines — this is a
// reach-from-here picture, not a route plan.
const VIEW_WIDTH = 960;
const VIEW_HEIGHT = 540;
const PADDING = 60;
const BG_FILL = "#F7F8FA";
const ORIGIN_COLOR = "#111827";
const LABEL_DARK = "#1F2937";
const LABEL_MUTED = "#6B7280";

export function renderReachableMap(
  gtfs: GtfsIndex,
  input: RenderReachableMapInput,
): RenderReachableMapResult {
  const reach = findReachableStations(gtfs, input);
  if (reach.status !== "ok") return reach;

  const originStation = resolveStation(input.from, gtfs.stopsById);
  // Defensive: findReachableStations already accepted this, so unique kind.
  if (originStation.kind !== "unique") {
    return { status: "no_match", which: "from" };
  }
  const origin = originStation.station;

  type Dot = Readonly<{
    stopName: string;
    lat: number;
    lon: number;
    durationMinutes: number;
    viaTransfer: string | null;
  }>;
  const dots: Dot[] = [];
  let unplottable = 0;
  for (const s of reach.stations) {
    const station = gtfs.stopsById.get(s.stopId);
    if (!station || (station.stopLat === 0 && station.stopLon === 0)) {
      unplottable += 1;
      continue;
    }
    dots.push({
      stopName: s.stopName,
      lat: station.stopLat,
      lon: station.stopLon,
      durationMinutes: s.durationMinutes,
      viaTransfer: s.viaTransfer,
    });
  }

  // Always include the origin so the projector bounds cover it too.
  const allPoints: LatLon[] = [
    { lat: origin.stopLat, lon: origin.stopLon },
    ...dots.map(d => ({ lat: d.lat, lon: d.lon })),
  ];
  const projector = makeProjector(allPoints, {
    width: VIEW_WIDTH,
    height: VIEW_HEIGHT,
    padding: PADDING,
  });

  const svg = buildSvg({
    origin,
    dots,
    projector,
    withinMinutes: input.withinMinutes,
    maxTransfers: input.maxTransfers,
    date: input.date,
  });

  return {
    status: "ok",
    from: origin.stopName,
    date: input.date,
    svg,
    summary: {
      reachable: reach.stations.length,
      withinMinutes: input.withinMinutes,
      maxTransfers: input.maxTransfers,
      plotted: dots.length,
      unplottable,
    },
  };
}

type BuildInput = Readonly<{
  origin: Readonly<{ stopName: string; stopLat: number; stopLon: number }>;
  dots: ReadonlyArray<Readonly<{
    stopName: string;
    lat: number;
    lon: number;
    durationMinutes: number;
    viaTransfer: string | null;
  }>>;
  projector: ReturnType<typeof makeProjector>;
  withinMinutes: number;
  maxTransfers: 0 | 1;
  date: string;
}>;

function buildSvg(input: BuildInput): string {
  const { projector, dots, origin, withinMinutes } = input;

  const originPoint = projector.project({ lat: origin.stopLat, lon: origin.stopLon });

  // Draw dots first, then origin on top so it's never covered by a dense
  // cluster of nearby reachable stations.
  const dotElements = dots
    .map(d => {
      const p = projector.project({ lat: d.lat, lon: d.lon });
      const color = colorForDuration(d.durationMinutes, withinMinutes);
      const marker = d.viaTransfer ? "◇" : "●";
      return (
        `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="4" fill="${color}" opacity="0.85">`
        + `<title>${svgEscape(`${marker} ${d.stopName} · ${d.durationMinutes} min`
          + (d.viaTransfer ? ` · via ${d.viaTransfer}` : ""))}</title>`
        + `</circle>`
      );
    })
    .join("");

  const headerLine = `Reach from ${origin.stopName}`;
  const subLine = `${input.date} · within ${withinMinutes} min · ${input.maxTransfers === 0 ? "direct only" : "up to 1 transfer"} · ${dots.length} stations plotted`;

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${projector.viewBox}" `
    + `preserveAspectRatio="xMidYMid meet" role="img" `
    + `aria-label="${svgEscape(`${headerLine}: ${subLine}`)}">`
    + `<title>${svgEscape(`${headerLine} · ${subLine}`)}</title>`
    + `<rect width="100%" height="100%" fill="${BG_FILL}"/>`
    + `<text x="24" y="32" font-family="system-ui,sans-serif" font-size="18" font-weight="700" fill="${LABEL_DARK}">${svgEscape(headerLine)}</text>`
    + `<text x="24" y="54" font-family="system-ui,sans-serif" font-size="12" fill="${LABEL_MUTED}">${svgEscape(subLine)}</text>`
    + dotElements
    // Origin: larger ring with inner fill so it reads as "you are here" at
    // any zoom level.
    + `<circle cx="${originPoint.x.toFixed(1)}" cy="${originPoint.y.toFixed(1)}" r="10" fill="none" stroke="${ORIGIN_COLOR}" stroke-width="2"/>`
    + `<circle cx="${originPoint.x.toFixed(1)}" cy="${originPoint.y.toFixed(1)}" r="5" fill="${ORIGIN_COLOR}"/>`
    + `<text x="${(originPoint.x + 14).toFixed(1)}" y="${(originPoint.y + 4).toFixed(1)}" font-family="system-ui,sans-serif" font-size="12" font-weight="700" fill="${LABEL_DARK}">${svgEscape(origin.stopName)}</text>`
    + renderLegend(withinMinutes)
    + `</svg>`
  );
}

// HSL interpolation green→red. Hue 120=green, 0=red. Keeps saturation and
// lightness fixed so the scale reads consistently on light backgrounds.
function colorForDuration(minutes: number, maxMinutes: number): string {
  const t = Math.min(1, Math.max(0, minutes / maxMinutes));
  const hue = 120 * (1 - t);
  return `hsl(${hue.toFixed(0)}, 70%, 45%)`;
}

function renderLegend(maxMinutes: number): string {
  // Fixed 200×18 legend strip in the bottom-right corner with tick labels.
  const barX = VIEW_WIDTH - PADDING - 220;
  const barY = VIEW_HEIGHT - 30;
  const barWidth = 180;
  const gradientId = "reach-legend";
  return (
    `<defs>`
    + `<linearGradient id="${gradientId}" x1="0" x2="1" y1="0" y2="0">`
    + `<stop offset="0%" stop-color="hsl(120,70%,45%)"/>`
    + `<stop offset="50%" stop-color="hsl(60,70%,45%)"/>`
    + `<stop offset="100%" stop-color="hsl(0,70%,45%)"/>`
    + `</linearGradient>`
    + `</defs>`
    + `<rect x="${barX}" y="${barY}" width="${barWidth}" height="10" rx="2" fill="url(#${gradientId})" stroke="#E5E7EB"/>`
    + `<text x="${barX}" y="${barY - 4}" font-family="system-ui,sans-serif" font-size="10" fill="${LABEL_MUTED}">0 min</text>`
    + `<text x="${barX + barWidth}" y="${barY - 4}" text-anchor="end" font-family="system-ui,sans-serif" font-size="10" fill="${LABEL_MUTED}">${maxMinutes} min</text>`
  );
}
