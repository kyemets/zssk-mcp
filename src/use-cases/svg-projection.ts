// Shared projection helpers for SVG renderers. Equirectangular with a
// cos(lat) correction — enough accuracy for a country the size of Slovakia
// (~5° east-west, ~2° north-south) without pulling in a projection library.

export type LatLon = Readonly<{ lat: number; lon: number }>;
export type Point = Readonly<{ x: number; y: number }>;

export type ViewBox = Readonly<{
  width: number;
  height: number;
  padding: number;
}>;

export type Projector = Readonly<{
  project: (p: LatLon) => Point;
  bounds: Readonly<{ minLat: number; maxLat: number; minLon: number; maxLon: number }>;
  viewBox: string;
}>;

export function makeProjector(points: ReadonlyArray<LatLon>, view: ViewBox): Projector {
  if (points.length === 0) {
    throw new Error("makeProjector: at least one point required");
  }

  let minLat = Number.POSITIVE_INFINITY;
  let maxLat = Number.NEGATIVE_INFINITY;
  let minLon = Number.POSITIVE_INFINITY;
  let maxLon = Number.NEGATIVE_INFINITY;
  for (const p of points) {
    if (p.lat < minLat) minLat = p.lat;
    if (p.lat > maxLat) maxLat = p.lat;
    if (p.lon < minLon) minLon = p.lon;
    if (p.lon > maxLon) maxLon = p.lon;
  }

  // Pad the geographic bounds a little so circles near the edges don't clip.
  const latSpan = Math.max(0.05, maxLat - minLat);
  const lonSpan = Math.max(0.05, maxLon - minLon);
  minLat -= latSpan * 0.05;
  maxLat += latSpan * 0.05;
  minLon -= lonSpan * 0.05;
  maxLon += lonSpan * 0.05;

  const midLat = (minLat + maxLat) / 2;
  const cosLat = Math.cos((midLat * Math.PI) / 180);

  const rangeLonScaled = (maxLon - minLon) * cosLat;
  const rangeLat = maxLat - minLat;

  const innerWidth = view.width - 2 * view.padding;
  const innerHeight = view.height - 2 * view.padding;
  const scale = Math.min(innerWidth / rangeLonScaled, innerHeight / rangeLat);

  // Center the projection inside the inner drawing box.
  const usedWidth = rangeLonScaled * scale;
  const usedHeight = rangeLat * scale;
  const offsetX = view.padding + (innerWidth - usedWidth) / 2;
  const offsetY = view.padding + (innerHeight - usedHeight) / 2;

  return {
    bounds: { minLat, maxLat, minLon, maxLon },
    viewBox: `0 0 ${view.width} ${view.height}`,
    project(p: LatLon): Point {
      const x = offsetX + (p.lon - minLon) * cosLat * scale;
      // SVG y grows downward; flip so higher lat appears higher on the page.
      const y = offsetY + (maxLat - p.lat) * scale;
      return { x, y };
    },
  };
}

// SVG allows `&`, `<`, `>`, `"`, `'` inside text nodes only when escaped.
// This is a defensive escape for any user-supplied string (station names,
// headsigns) that ends up in an SVG attribute or text element.
export function svgEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
