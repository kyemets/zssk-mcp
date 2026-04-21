import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import AdmZip from "adm-zip";
import { parse as parseCsv } from "csv-parse/sync";

import type { GtfsIndex } from "../entities/gtfs-index.js";
import type { Station } from "../entities/station.js";
import type { Trip } from "../entities/trip.js";
import type { StopTime } from "../entities/stop-time.js";
import type { Service } from "../entities/service.js";
import type { Route } from "../entities/route.js";
import type { Agency } from "../entities/agency.js";

// The ŽSR national feed covers every passenger-rail operator in Slovakia
// (ZSSK, RegioJet, Leo Express, …), not just ZSSK.
const FEED_URL = "https://www.zsr.sk/files/pre-cestujucich/cestovny-poriadok/gtfs/gtfs.zip";

// Anchor to the script location, not process.cwd: MCP hosts spawn this
// binary with cwd="/", so a relative ".cache" path fails on mkdir.
const CACHE_DIR = resolve(
  process.env.ZSSK_CACHE_DIR ??
    join(dirname(fileURLToPath(import.meta.url)), "..", "..", ".cache"),
);
const ZIP_PATH = join(CACHE_DIR, "zssk-gtfs.zip");
const EXTRACT_DIR = join(CACHE_DIR, "zssk-gtfs");
const EXTRACT_MARKER = join(EXTRACT_DIR, ".extracted-from-mtime");
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

type CsvRow = Record<string, string>;

async function ensureZipDownloaded(forceRefresh: boolean): Promise<void> {
  if (!existsSync(CACHE_DIR)) mkdirSync(CACHE_DIR, { recursive: true });
  const stale = existsSync(ZIP_PATH) && Date.now() - statSync(ZIP_PATH).mtimeMs > CACHE_TTL_MS;
  const needsDownload = forceRefresh || !existsSync(ZIP_PATH) || stale;
  if (!needsDownload) return;

  console.error(`[gtfs] downloading ${FEED_URL}`);
  const res = await fetch(FEED_URL);
  if (!res.ok) throw new Error(`GTFS download failed: ${res.status} ${res.statusText}`);
  const buf = new Uint8Array(await res.arrayBuffer());
  writeFileSync(ZIP_PATH, buf);
}

function ensureExtracted(): void {
  const zipMtime = String(statSync(ZIP_PATH).mtimeMs);
  if (existsSync(EXTRACT_MARKER) && readFileSync(EXTRACT_MARKER, "utf8") === zipMtime) return;
  console.error(`[gtfs] extracting to ${EXTRACT_DIR}`);
  new AdmZip(ZIP_PATH).extractAllTo(EXTRACT_DIR, true);
  writeFileSync(EXTRACT_MARKER, zipMtime);
}

function readCsv(filename: string): CsvRow[] {
  const raw = readFileSync(join(EXTRACT_DIR, filename), "utf8");
  return parseCsv(raw, { columns: true, skip_empty_lines: true, trim: true, bom: true });
}

function required(row: CsvRow, field: string, file: string): string {
  const v = row[field];
  if (!v) throw new Error(`Malformed ${file}: missing "${field}" in ${JSON.stringify(row)}`);
  return v;
}

function parseStops(): Map<string, Station> {
  const rows = readCsv("stops.txt");
  const map = new Map<string, Station>();
  for (const r of rows) {
    const stopId = required(r, "stop_id", "stops.txt");
    map.set(stopId, {
      stopId,
      stopName: required(r, "stop_name", "stops.txt"),
      stopLat: r.stop_lat ? Number(r.stop_lat) : 0,
      stopLon: r.stop_lon ? Number(r.stop_lon) : 0,
      platformCode: r.platform_code ? r.platform_code : null,
      locationType: r.location_type ? Number(r.location_type) : 0,
    });
  }
  return map;
}

function parseTrips(): Map<string, Trip> {
  const rows = readCsv("trips.txt");
  const map = new Map<string, Trip>();
  for (const r of rows) {
    const tripId = required(r, "trip_id", "trips.txt");
    map.set(tripId, {
      tripId,
      routeId: required(r, "route_id", "trips.txt"),
      serviceId: required(r, "service_id", "trips.txt"),
      headsign: r.trip_headsign ?? "",
      shortName: r.trip_short_name ?? "",
      directionId: r.direction_id ?? "",
    });
  }
  return map;
}

function parseAgencies(): Map<string, Agency> {
  const rows = readCsv("agency.txt");
  const map = new Map<string, Agency>();
  for (const r of rows) {
    const agencyId = required(r, "agency_id", "agency.txt");
    map.set(agencyId, {
      agencyId,
      agencyName: required(r, "agency_name", "agency.txt"),
      agencyUrl: r.agency_url ?? "",
      agencyTimezone: r.agency_timezone ?? "",
    });
  }
  return map;
}

function parseRoutes(): Map<string, Route> {
  const rows = readCsv("routes.txt");
  const map = new Map<string, Route>();
  for (const r of rows) {
    const routeId = required(r, "route_id", "routes.txt");
    map.set(routeId, {
      routeId,
      agencyId: r.agency_id ?? "",
      shortName: r.route_short_name ?? "",
      longName: r.route_long_name ?? "",
      type: r.route_type ?? "",
    });
  }
  return map;
}

// Invariant: each byTrip bucket is sorted by stop_sequence — downstream code
// relies on array order without re-sorting.
function parseStopTimes(): {
  byTrip: Map<string, StopTime[]>;
  byStop: Map<string, StopTime[]>;
} {
  const rows = readCsv("stop_times.txt");
  const byTrip = new Map<string, StopTime[]>();
  const byStop = new Map<string, StopTime[]>();
  for (const r of rows) {
    const tripId = required(r, "trip_id", "stop_times.txt");
    const stopId = required(r, "stop_id", "stop_times.txt");
    const st: StopTime = {
      tripId,
      stopId,
      stopSequence: Number(required(r, "stop_sequence", "stop_times.txt")),
      arrivalTime: r.arrival_time ?? "",
      departureTime: r.departure_time ?? "",
    };
    let tripBucket = byTrip.get(tripId);
    if (!tripBucket) { tripBucket = []; byTrip.set(tripId, tripBucket); }
    tripBucket.push(st);
    let stopBucket = byStop.get(stopId);
    if (!stopBucket) { stopBucket = []; byStop.set(stopId, stopBucket); }
    stopBucket.push(st);
  }
  for (const arr of byTrip.values()) arr.sort((a, b) => a.stopSequence - b.stopSequence);
  return { byTrip, byStop };
}

function parseServices(): Map<string, Service> {
  const exceptionRows = readCsv("calendar_dates.txt");
  const exceptionsByService = new Map<string, Map<string, 1 | 2>>();
  for (const r of exceptionRows) {
    const serviceId = required(r, "service_id", "calendar_dates.txt");
    const date = required(r, "date", "calendar_dates.txt");
    const type = Number(required(r, "exception_type", "calendar_dates.txt"));
    if (type !== 1 && type !== 2) {
      throw new Error(`calendar_dates.txt: invalid exception_type=${type} for ${serviceId} on ${date}`);
    }
    let inner = exceptionsByService.get(serviceId);
    if (!inner) { inner = new Map(); exceptionsByService.set(serviceId, inner); }
    inner.set(date, type);
  }

  const calendarRows = readCsv("calendar.txt");
  const services = new Map<string, Service>();
  for (const r of calendarRows) {
    const serviceId = required(r, "service_id", "calendar.txt");
    services.set(serviceId, {
      serviceId,
      weekly: [
        r.monday === "1",
        r.tuesday === "1",
        r.wednesday === "1",
        r.thursday === "1",
        r.friday === "1",
        r.saturday === "1",
        r.sunday === "1",
      ],
      startDate: required(r, "start_date", "calendar.txt"),
      endDate: required(r, "end_date", "calendar.txt"),
      dateExceptions: exceptionsByService.get(serviceId) ?? new Map(),
    });
  }

  // GTFS spec: a service_id may exist only in calendar_dates.txt with no
  // weekly base. Synthesize a zero-week service so such trips still resolve.
  for (const [serviceId, exc] of exceptionsByService) {
    if (services.has(serviceId)) continue;
    services.set(serviceId, {
      serviceId,
      weekly: [false, false, false, false, false, false, false],
      startDate: "00000000",
      endDate: "99999999",
      dateExceptions: exc,
    });
  }
  return services;
}

function parseFeedVersion(): string {
  const path = join(EXTRACT_DIR, "feed_info.txt");
  if (!existsSync(path)) return "unknown";
  const rows = parseCsv(readFileSync(path, "utf8"), {
    columns: true, skip_empty_lines: true, trim: true, bom: true,
  }) as CsvRow[];
  return rows[0]?.feed_version ?? "unknown";
}

export async function loadGtfs(): Promise<GtfsIndex> {
  const forceRefresh = process.env.ZSSK_GTFS_REFRESH === "1";
  await ensureZipDownloaded(forceRefresh);
  ensureExtracted();

  const stopsById = parseStops();
  const tripsById = parseTrips();
  const routesById = parseRoutes();
  const agenciesById = parseAgencies();
  const { byTrip, byStop } = parseStopTimes();
  const servicesById = parseServices();
  const feedVersion = parseFeedVersion();

  const stopTimeCount = Array.from(byTrip.values()).reduce((n, a) => n + a.length, 0);
  console.error(
    `[gtfs] loaded: stops=${stopsById.size} trips=${tripsById.size} ` +
    `routes=${routesById.size} agencies=${agenciesById.size} ` +
    `stopTimes=${stopTimeCount} services=${servicesById.size} ` +
    `feedVersion=${feedVersion}`,
  );

  return {
    stopsById,
    tripsById,
    routesById,
    agenciesById,
    stopTimesByTrip: byTrip,
    stopTimesByStop: byStop,
    servicesById,
    feedVersion,
  };
}
