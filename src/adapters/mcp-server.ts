import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import type { GtfsIndex } from "../entities/gtfs-index.js";
import { findConnection } from "../use-cases/find-connection.js";
import { findConnectionWithTransfer } from "../use-cases/find-connection-with-transfer.js";
import { findTripByNumber } from "../use-cases/find-trip-by-number.js";
import { findStationsNearby } from "../use-cases/find-stations-nearby.js";
import { searchStations } from "../use-cases/search-stations.js";
import { exportIcs } from "../use-cases/export-ics.js";
import { renderTripRoute } from "../use-cases/render-trip-route.js";
import { renderServiceCalendar } from "../use-cases/render-service-calendar.js";
import { renderTimetableChart } from "../use-cases/render-timetable-chart.js";
import { nextDeparturesFrom } from "../use-cases/next-departures-from.js";
import { getTripGeojson } from "../use-cases/get-trip-geojson.js";
import { compareTrips } from "../use-cases/compare-trips.js";
import { findReachableStations } from "../use-cases/find-reachable-stations.js";
import { getTimetable } from "../use-cases/get-timetable.js";
import { checkDelay } from "../use-cases/check-delay.js";
import { getFeedWarning, buildFeedInfo } from "../use-cases/feed-status.js";

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const TIME_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/;
const SORT_BY_VALUES = [
  "earliest_departure",
  "earliest_arrival",
  "shortest_trip",
] as const;

const OPERATOR_DESCRIPTION =
  "Optional operator filter. Accepts agency name substring or short code: " +
  "'ZSSK', 'RegioJet' (or 'RJ'), 'Leo Express' (or 'LE'), 'Trezka'. " +
  "If given and unknown, the tool returns a no_match_operator response " +
  "with the list of available agencies.";

const TRAIN_TYPES_DESCRIPTION =
  "Optional train-category filter. ZSSK categories: 'Os' (local), 'R' " +
  "(rýchlik), 'REX' (regional express), 'Ex' (expres), 'IC', 'EC', plus " +
  "private carriers 'RJ' (RegioJet), 'LE' (Leo Express). Case-insensitive. " +
  "Omit or pass [] to include all categories.";

const VIA_DESCRIPTION =
  "Optional intermediate station the journey must pass through, e.g. 'Žilina'. " +
  "Fuzzy-matched like from/to. For direct search the trip must visit this " +
  "station strictly between from and to. For transfer search the via may be " +
  "the interchange itself or an intermediate of either leg.";

const ARRIVE_BY_DESCRIPTION =
  "Optional latest arrival time HH:MM (24h) at the destination. Filters out " +
  "connections that arrive after this time.";

const WHEELCHAIR_DESCRIPTION =
  "Optional accessibility filter. When true, only trips explicitly marked " +
  "wheelchair-accessible in the feed (wheelchair_accessible=1) are returned. " +
  "Trips with unknown status (0) are excluded. Default false.";

const SORT_BY_DESCRIPTION =
  "How to sort results. 'earliest_departure' (default) sorts by departure " +
  "time ascending. 'earliest_arrival' sorts by when you land at the " +
  "destination. 'shortest_trip' sorts by total travel duration.";

const READ_ONLY_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

export function createMcpServer(gtfs: GtfsIndex): McpServer {
  const server = new McpServer({ name: "zssk-mcp", version: "0.7.0" });

  server.registerTool(
    "find_connection",
    {
      title: "Find direct train connection",
      description:
        "Find DIRECT train connections between two Slovak railway stations on a given " +
        "date. Station names are fuzzy-matched (case- and diacritic-insensitive). " +
        "For trips that require a change, use find_connection_with_transfer.",
      annotations: READ_ONLY_ANNOTATIONS,
      inputSchema: {
        from: z
          .string()
          .min(1)
          .describe("Departure station name, e.g. 'Bratislava' or 'Žilina'."),
        to: z.string().min(1).describe("Arrival station name."),
        date: z
          .string()
          .regex(DATE_REGEX)
          .describe("Travel date in YYYY-MM-DD format."),
        departure_after: z
          .string()
          .regex(TIME_REGEX)
          .optional()
          .describe("Earliest departure time HH:MM (24h). Defaults to 00:00."),
        arrive_by: z
          .string()
          .regex(TIME_REGEX)
          .optional()
          .describe(ARRIVE_BY_DESCRIPTION),
        operator: z.string().min(1).optional().describe(OPERATOR_DESCRIPTION),
        train_types: z
          .array(z.string().min(1))
          .optional()
          .describe(TRAIN_TYPES_DESCRIPTION),
        via: z.string().min(1).optional().describe(VIA_DESCRIPTION),
        wheelchair_only: z
          .boolean()
          .optional()
          .describe(WHEELCHAIR_DESCRIPTION),
        sort_by: z
          .enum(SORT_BY_VALUES)
          .optional()
          .describe(SORT_BY_DESCRIPTION),
      },
    },
    async (args) =>
      respond(
        gtfs,
        findConnection(gtfs, {
          from: args.from,
          to: args.to,
          date: args.date,
          departureAfter: args.departure_after ?? "00:00",
          arriveBy: args.arrive_by ?? null,
          operator: args.operator ?? null,
          trainTypes: args.train_types ?? null,
          via: args.via ?? null,
          wheelchairOnly: args.wheelchair_only ?? false,
          sortBy: args.sort_by ?? "earliest_departure",
        }),
      ),
  );

  server.registerTool(
    "find_connection_with_transfer",
    {
      title: "Find train connection with one transfer",
      description:
        "Find two-leg train connections between two Slovak stations via a single " +
        "transfer. Enforces a 5-minute minimum and 180-minute maximum wait at the " +
        "interchange, and excludes trips that already reach the destination " +
        "directly (those are served by find_connection).",
      annotations: READ_ONLY_ANNOTATIONS,
      inputSchema: {
        from: z.string().min(1).describe("Departure station name."),
        to: z.string().min(1).describe("Arrival station name."),
        date: z.string().regex(DATE_REGEX).describe("Travel date YYYY-MM-DD."),
        departure_after: z
          .string()
          .regex(TIME_REGEX)
          .optional()
          .describe("Earliest departure time HH:MM (24h). Defaults to 00:00."),
        arrive_by: z
          .string()
          .regex(TIME_REGEX)
          .optional()
          .describe(ARRIVE_BY_DESCRIPTION),
        operator: z.string().min(1).optional().describe(OPERATOR_DESCRIPTION),
        train_types: z
          .array(z.string().min(1))
          .optional()
          .describe(TRAIN_TYPES_DESCRIPTION),
        via: z.string().min(1).optional().describe(VIA_DESCRIPTION),
        wheelchair_only: z
          .boolean()
          .optional()
          .describe(WHEELCHAIR_DESCRIPTION),
        sort_by: z
          .enum(SORT_BY_VALUES)
          .optional()
          .describe(SORT_BY_DESCRIPTION),
      },
    },
    async (args) =>
      respond(
        gtfs,
        findConnectionWithTransfer(gtfs, {
          from: args.from,
          to: args.to,
          date: args.date,
          departureAfter: args.departure_after ?? "00:00",
          arriveBy: args.arrive_by ?? null,
          operator: args.operator ?? null,
          trainTypes: args.train_types ?? null,
          via: args.via ?? null,
          wheelchairOnly: args.wheelchair_only ?? false,
          sortBy: args.sort_by ?? "earliest_departure",
        }),
      ),
  );

  server.registerTool(
    "get_timetable",
    {
      title: "Station timetable",
      description:
        "List departures from a Slovak railway station on a given date, sorted by time.",
      annotations: READ_ONLY_ANNOTATIONS,
      inputSchema: {
        station: z.string().min(1).describe("Station name (fuzzy matched)."),
        date: z
          .string()
          .regex(DATE_REGEX)
          .describe("Date in YYYY-MM-DD format."),
        limit: z
          .number()
          .int()
          .min(1)
          .max(200)
          .optional()
          .describe("Max rows to return. Default 20."),
        operator: z.string().min(1).optional().describe(OPERATOR_DESCRIPTION),
        train_types: z
          .array(z.string().min(1))
          .optional()
          .describe(TRAIN_TYPES_DESCRIPTION),
        wheelchair_only: z
          .boolean()
          .optional()
          .describe(WHEELCHAIR_DESCRIPTION),
      },
    },
    async (args) =>
      respond(
        gtfs,
        getTimetable(gtfs, {
          station: args.station,
          date: args.date,
          limit: args.limit ?? 20,
          operator: args.operator ?? null,
          trainTypes: args.train_types ?? null,
          wheelchairOnly: args.wheelchair_only ?? false,
        }),
      ),
  );

  server.registerTool(
    "find_trip_by_number",
    {
      title: "Look up a trip by train number",
      description:
        "Return the full stop list for one or more trips matching a human train " +
        "number (e.g. 'Ex 603', 'R 681', 'RJ 1046') on a given date. Matches against " +
        "both route_short_name and trip_short_name so either form works.",
      annotations: READ_ONLY_ANNOTATIONS,
      inputSchema: {
        train_number: z
          .string()
          .min(1)
          .describe(
            "Train number as printed on the ticket, e.g. 'Ex 603' or just '603'.",
          ),
        date: z.string().regex(DATE_REGEX).describe("Service date YYYY-MM-DD."),
        wheelchair_only: z
          .boolean()
          .optional()
          .describe(WHEELCHAIR_DESCRIPTION),
      },
    },
    async (args) =>
      respond(
        gtfs,
        findTripByNumber(gtfs, {
          trainNumber: args.train_number,
          date: args.date,
          wheelchairOnly: args.wheelchair_only ?? false,
        }),
      ),
  );

  server.registerTool(
    "find_stations_nearby",
    {
      title: "Find stations near a coordinate",
      description:
        "Return stations within a given radius of a lat/lon, sorted by distance. " +
        "Uses haversine on station coordinates from stops.txt. Stations with unknown " +
        "coordinates in the feed are skipped.",
      annotations: READ_ONLY_ANNOTATIONS,
      inputSchema: {
        lat: z
          .number()
          .min(-90)
          .max(90)
          .describe("Latitude in decimal degrees (WGS-84)."),
        lon: z
          .number()
          .min(-180)
          .max(180)
          .describe("Longitude in decimal degrees (WGS-84)."),
        radius_km: z
          .number()
          .positive()
          .max(500)
          .optional()
          .describe("Search radius in km. Default 10, max 500."),
      },
    },
    async (args) =>
      respond(
        gtfs,
        findStationsNearby(gtfs, {
          lat: args.lat,
          lon: args.lon,
          radiusKm: args.radius_km ?? 10,
        }),
      ),
  );

  server.registerTool(
    "search_stations",
    {
      title: "Search stations by name",
      description:
        "Autocomplete-style search. Returns every station whose normalized name " +
        "matches the query (exact > prefix > substring), up to `limit`. Use this " +
        "to browse candidates before picking a from/to/via value.",
      annotations: READ_ONLY_ANNOTATIONS,
      inputSchema: {
        query: z
          .string()
          .min(1)
          .describe("Query string, case- and diacritic-insensitive."),
        limit: z
          .number()
          .int()
          .min(1)
          .max(100)
          .optional()
          .describe("Max rows. Default 20."),
      },
    },
    async (args) =>
      respond(
        gtfs,
        searchStations(args.query, gtfs.stopsById, args.limit ?? 20),
      ),
  );

  server.registerTool(
    "export_connection_as_ics",
    {
      title: "Export trip as iCal (.ics)",
      description:
        "Return an RFC-5545 VEVENT block for a trip_id + date so the user can " +
        "drop it into Google Calendar / Apple Calendar / Outlook. Handles GTFS " +
        "post-midnight times (>= 24:00) by bumping the calendar date.",
      annotations: READ_ONLY_ANNOTATIONS,
      inputSchema: {
        trip_id: z
          .string()
          .min(1)
          .describe(
            "The GTFS trip_id — take this from a previous find_connection / find_trip_by_number result.",
          ),
        date: z.string().regex(DATE_REGEX).describe("Service date YYYY-MM-DD."),
      },
    },
    async (args) =>
      respond(gtfs, exportIcs(gtfs, { tripId: args.trip_id, date: args.date })),
  );

  server.registerTool(
    "get_feed_info",
    {
      title: "GTFS feed metadata",
      description:
        "Return the loaded feed's version, validity window, agency list, dataset " +
        "counts, and any expiry warning. Identical payload to the zssk://feed/info " +
        "resource — provided as a tool so agents without MCP-resource support can " +
        "still access it.",
      annotations: READ_ONLY_ANNOTATIONS,
      inputSchema: {},
    },
    async () => respond(gtfs, buildFeedInfo(gtfs)),
  );

  server.registerTool(
    "render_trip_route",
    {
      title: "ASCII timeline of a trip's stops",
      description:
        "Return a multi-line fixed-width block showing the full stop list of a trip: " +
        "header line with train number/route/date, meta line with duration and badges, " +
        "then one line per stop with time and a ● marker connected by │. Intended for " +
        "direct rendering in a chat message. Structured `summary` preserved alongside.",
      annotations: READ_ONLY_ANNOTATIONS,
      inputSchema: {
        trip_id: z
          .string()
          .min(1)
          .describe("The GTFS trip_id (from a find_connection / find_trip_by_number result)."),
        date: z.string().regex(DATE_REGEX).describe("Service date YYYY-MM-DD."),
      },
    },
    async (args) => respond(gtfs, renderTripRoute(gtfs, { tripId: args.trip_id, date: args.date })),
  );

  server.registerTool(
    "render_service_calendar",
    {
      title: "Monthly calendar of when a train runs",
      description:
        "Render a month grid (Mo–Su columns, weeks as rows) marking each day with ● if " +
        "the train runs or · if not. Matches train number against route_short_name / " +
        "trip_short_name. Handy to ask 'does Ex 603 run on Sundays?' at a glance.",
      annotations: READ_ONLY_ANNOTATIONS,
      inputSchema: {
        train_number: z
          .string()
          .min(1)
          .describe("Human train number, e.g. 'Ex 603', 'R 681', 'RJ 1046'."),
        month: z
          .string()
          .regex(/^\d{4}-\d{2}$/)
          .describe("Month as YYYY-MM, e.g. '2026-04'."),
      },
    },
    async (args) => respond(gtfs, renderServiceCalendar(gtfs, {
      trainNumber: args.train_number,
      month: args.month,
    })),
  );

  server.registerTool(
    "render_timetable_chart",
    {
      title: "Hourly histogram of station departures",
      description:
        "Visualize the density of departures from a station across 24 hours as a " +
        "fixed-width chart (`HH ●●●●● (N)`). Skips terminus rows (pure arrivals). " +
        "Post-midnight GTFS times (>= 24:00) keep their bucket so the chart reflects " +
        "actual same-service-day operations.",
      annotations: READ_ONLY_ANNOTATIONS,
      inputSchema: {
        station: z.string().min(1).describe("Station name (fuzzy matched)."),
        date: z.string().regex(DATE_REGEX).describe("Date YYYY-MM-DD."),
      },
    },
    async (args) => respond(gtfs, renderTimetableChart(gtfs, {
      station: args.station,
      date: args.date,
    })),
  );

  server.registerTool(
    "next_departures_from",
    {
      title: "Next departures from a station (right now)",
      description:
        "Convenience wrapper over get_timetable. Uses 'now' in Europe/Bratislava to " +
        "pick today's date and the current HH:MM, then returns the next `limit` " +
        "departures from a fuzzy-matched station. Useful for 'what's next at Žilina?'.",
      annotations: READ_ONLY_ANNOTATIONS,
      inputSchema: {
        station: z.string().min(1).describe("Station name (fuzzy matched)."),
        limit: z.number().int().min(1).max(50).optional().describe("Max rows. Default 10."),
      },
    },
    async (args) => respond(gtfs, nextDeparturesFrom(gtfs, {
      station: args.station,
      limit: args.limit ?? 10,
    })),
  );

  server.registerTool(
    "get_trip_geojson",
    {
      title: "Trip path as GeoJSON",
      description:
        "Return an RFC-7946 GeoJSON Feature with a LineString geometry tracing the " +
        "trip's stop coordinates (lon/lat). Stops missing coordinates in the feed " +
        "are skipped and reported in `skippedStops`. Drop the `feature` object into " +
        "any Leaflet/Mapbox/etc layer to draw the route on a map.",
      annotations: READ_ONLY_ANNOTATIONS,
      inputSchema: {
        trip_id: z.string().min(1).describe("GTFS trip_id (from a prior connection/trip result)."),
        date: z.string().regex(DATE_REGEX).describe("Service date YYYY-MM-DD."),
      },
    },
    async (args) => respond(gtfs, getTripGeojson(gtfs, { tripId: args.trip_id, date: args.date })),
  );

  server.registerTool(
    "compare_trips",
    {
      title: "Side-by-side comparison of 2-5 trips",
      description:
        "Take 2 to 5 trip_ids and one date, return a structured array with the full " +
        "metadata per trip (train number, duration, stops, operator, accessibility, " +
        "international flag, booking link, badges). Individual trips can come back " +
        "as `trip_not_found` or `not_running` without aborting the whole comparison. " +
        "Does NOT rank — returns numbers, leaves the judgment to the caller.",
      annotations: READ_ONLY_ANNOTATIONS,
      inputSchema: {
        trip_ids: z.array(z.string().min(1)).min(2).max(5).describe("Between 2 and 5 GTFS trip_ids."),
        date: z.string().regex(DATE_REGEX).describe("Service date YYYY-MM-DD."),
      },
    },
    async (args) => respond(gtfs, compareTrips(gtfs, { tripIds: args.trip_ids, date: args.date })),
  );

  server.registerTool(
    "find_reachable_stations",
    {
      title: "Stations reachable within N minutes",
      description:
        "Return every station reachable from `from` on `date` starting after " +
        "`departure_after`, with total travel time ≤ `within_minutes`. Direct-only " +
        "by default (`max_transfers=0`); set `max_transfers=1` to include one " +
        "interchange (5-min minimum wait). Results sorted by shortest duration, " +
        "capped at 200 stations.",
      annotations: READ_ONLY_ANNOTATIONS,
      inputSchema: {
        from: z.string().min(1).describe("Departure station name (fuzzy matched)."),
        date: z.string().regex(DATE_REGEX).describe("Date YYYY-MM-DD."),
        departure_after: z.string().regex(TIME_REGEX).optional().describe("Earliest departure HH:MM (24h). Default 00:00."),
        within_minutes: z.number().int().min(10).max(480).optional().describe("Travel-time budget in minutes. Default 120, max 480 (8h)."),
        max_transfers: z.union([z.literal(0), z.literal(1)]).optional().describe("0 = direct only (default), 1 = allow one change."),
      },
    },
    async (args) => respond(gtfs, findReachableStations(gtfs, {
      from: args.from,
      date: args.date,
      departureAfter: args.departure_after ?? "00:00",
      withinMinutes: args.within_minutes ?? 120,
      maxTransfers: args.max_transfers ?? 0,
    })),
  );

  server.registerTool(
    "check_delay",
    {
      title: "Check train delay (stub)",
      description:
        "Stub endpoint. Real-time delay information is not yet wired up — returns a " +
        "not_implemented payload so the tool contract is public from v1.",
      annotations: READ_ONLY_ANNOTATIONS,
      inputSchema: {
        train_number: z
          .string()
          .min(1)
          .describe("Train number, e.g. 'R 605' or 'Ex 42'."),
      },
    },
    async (args) =>
      respond(gtfs, checkDelay({ trainNumber: args.train_number })),
  );

  server.registerResource(
    "feed-info",
    "zssk://feed/info",
    {
      title: "GTFS feed metadata",
      description:
        "Feed version, validity, agencies, dataset sizes, expiry warning.",
      mimeType: "application/json",
    },
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: "application/json",
          text: JSON.stringify(buildFeedInfo(gtfs), null, 2),
        },
      ],
    }),
  );

  return server;
}

function respond(gtfs: GtfsIndex, result: object) {
  const warning = getFeedWarning(gtfs);
  const payload = warning ? { ...result, _feed_warning: warning } : result;
  return {
    content: [
      { type: "text" as const, text: JSON.stringify(payload, null, 2) },
    ],
  };
}

export async function startStdio(server: McpServer): Promise<void> {
  await server.connect(new StdioServerTransport());
}
