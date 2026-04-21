// Minimal station projection used by use-cases. GTFS has many more columns —
// only the ones the MCP tools actually read are carried here.
export type Station = Readonly<{
  stopId: string;
  stopName: string;
  stopLat: number;
  stopLon: number;
  platformCode: string | null;
  locationType: number;
}>;
