import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import type { GtfsIndex } from "../entities/gtfs-index.js";
import { findConnection } from "../use-cases/find-connection.js";
import { findConnectionWithTransfer } from "../use-cases/find-connection-with-transfer.js";
import { getTimetable } from "../use-cases/get-timetable.js";
import { checkDelay } from "../use-cases/check-delay.js";

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const TIME_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/;

const OPERATOR_DESCRIPTION =
  "Optional operator filter. Accepts agency name substring or short code: " +
  "'ZSSK', 'RegioJet' (or 'RJ'), 'Leo Express' (or 'LE'), 'Trezka'. " +
  "If given and unknown, the tool returns a no_match_operator response " +
  "with the list of available agencies.";

// The zod `.describe()` strings below are rendered into JSON-schema and
// shown to the LLM client — they are the tool's public contract.
export function createMcpServer(gtfs: GtfsIndex): McpServer {
  const server = new McpServer({ name: "zssk-mcp", version: "0.2.0" });

  server.registerTool(
    "find_connection",
    {
      title: "Find direct train connection",
      description:
        "Find DIRECT train connections between two Slovak railway stations on a given " +
        "date. Station names are fuzzy-matched (case- and diacritic-insensitive). " +
        "For trips that require a change, use find_connection_with_transfer.",
      inputSchema: {
        from: z.string().min(1).describe("Departure station name, e.g. 'Bratislava' or 'Žilina'."),
        to: z.string().min(1).describe("Arrival station name."),
        date: z.string().regex(DATE_REGEX).describe("Travel date in YYYY-MM-DD format."),
        departure_after: z
          .string()
          .regex(TIME_REGEX)
          .optional()
          .describe("Earliest departure time HH:MM (24h). Defaults to 00:00."),
        operator: z.string().min(1).optional().describe(OPERATOR_DESCRIPTION),
      },
    },
    async (args) => {
      const result = findConnection(gtfs, {
        from: args.from,
        to: args.to,
        date: args.date,
        departureAfter: args.departure_after ?? "00:00",
        operator: args.operator ?? null,
      });
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    },
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
      inputSchema: {
        from: z.string().min(1).describe("Departure station name."),
        to: z.string().min(1).describe("Arrival station name."),
        date: z.string().regex(DATE_REGEX).describe("Travel date YYYY-MM-DD."),
        departure_after: z
          .string()
          .regex(TIME_REGEX)
          .optional()
          .describe("Earliest departure time HH:MM (24h). Defaults to 00:00."),
        operator: z.string().min(1).optional().describe(OPERATOR_DESCRIPTION),
      },
    },
    async (args) => {
      const result = findConnectionWithTransfer(gtfs, {
        from: args.from,
        to: args.to,
        date: args.date,
        departureAfter: args.departure_after ?? "00:00",
        operator: args.operator ?? null,
      });
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    },
  );

  server.registerTool(
    "get_timetable",
    {
      title: "Station timetable",
      description:
        "List departures from a Slovak railway station on a given date, sorted by time.",
      inputSchema: {
        station: z.string().min(1).describe("Station name (fuzzy matched)."),
        date: z.string().regex(DATE_REGEX).describe("Date in YYYY-MM-DD format."),
        limit: z
          .number()
          .int()
          .min(1)
          .max(200)
          .optional()
          .describe("Max rows to return. Default 20."),
        operator: z.string().min(1).optional().describe(OPERATOR_DESCRIPTION),
      },
    },
    async (args) => {
      const result = getTimetable(gtfs, {
        station: args.station,
        date: args.date,
        limit: args.limit ?? 20,
        operator: args.operator ?? null,
      });
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    },
  );

  server.registerTool(
    "check_delay",
    {
      title: "Check train delay (stub)",
      description:
        "Stub endpoint. Real-time delay information is not yet wired up — returns a " +
        "not_implemented payload so the tool contract is public from v1.",
      inputSchema: {
        train_number: z.string().min(1).describe("Train number, e.g. 'R 605' or 'Ex 42'."),
      },
    },
    async (args) => {
      const result = checkDelay({ trainNumber: args.train_number });
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    },
  );

  return server;
}

export async function startStdio(server: McpServer): Promise<void> {
  await server.connect(new StdioServerTransport());
}
