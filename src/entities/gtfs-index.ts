import type { Station } from "./station.js";
import type { Trip } from "./trip.js";
import type { StopTime } from "./stop-time.js";
import type { Service } from "./service.js";
import type { Route } from "./route.js";
import type { Agency } from "./agency.js";

// The read-only, in-memory projection of one GTFS feed. Use-cases depend only
// on this shape; the concrete loader lives in adapters/.
export type GtfsIndex = Readonly<{
  stopsById: ReadonlyMap<string, Station>;
  tripsById: ReadonlyMap<string, Trip>;
  routesById: ReadonlyMap<string, Route>;
  agenciesById: ReadonlyMap<string, Agency>;
  stopTimesByTrip: ReadonlyMap<string, ReadonlyArray<StopTime>>;
  stopTimesByStop: ReadonlyMap<string, ReadonlyArray<StopTime>>;
  servicesById: ReadonlyMap<string, Service>;
  feedVersion: string;
  feedStartDate: string;
  feedEndDate: string;
}>;
