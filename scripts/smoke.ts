// Smoke test: runs every tool against the live feed. Exits non-zero on any
// assertion failure so it can gate a prod deploy without a test framework.
import { loadGtfs } from "../src/adapters/gtfs-loader.js";
import { findConnection } from "../src/use-cases/find-connection.js";
import { findConnectionWithTransfer } from "../src/use-cases/find-connection-with-transfer.js";
import { findTripByNumber } from "../src/use-cases/find-trip-by-number.js";
import { findStationsNearby } from "../src/use-cases/find-stations-nearby.js";
import { getTimetable } from "../src/use-cases/get-timetable.js";
import { checkDelay } from "../src/use-cases/check-delay.js";
import { resolveAgencies } from "../src/use-cases/resolve-agency.js";
import { trainCategory } from "../src/use-cases/train-category.js";
import { getFeedWarning } from "../src/use-cases/feed-status.js";

const ZSSK_NAME = "Železničná spoločnosť Slovensko, a.s.";
const REGIOJET_NAME = "RegioJet,a.s.";
const LEO_EXPRESS_CZ_NAME = "Leo Express s.r.o.";
const LEO_EXPRESS_SK_NAME = "Leo Express Slovensko s.r.o.";
const TREZKA_NAME = "Trenčianska elektrická železnica, n.o.";

// Approximate coordinates of Bratislava hl.st. — used for nearby search.
const BA_HL_ST_LAT = 48.1598;
const BA_HL_ST_LON = 17.1064;

function nextWeekdayIso(): string {
  const d = new Date();
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) {
    console.error(`[smoke] FAIL: ${msg}`);
    process.exit(1);
  }
}

function assertAliasResolvesTo(
  gtfs: Awaited<ReturnType<typeof loadGtfs>>,
  query: string,
  expectedNames: ReadonlyArray<string>,
): void {
  const match = resolveAgencies(query, gtfs.agenciesById);
  assert(match.kind === "matched", `alias "${query}" did not resolve`);
  const got = match.agencies.map(a => a.agencyName).sort();
  const want = [...expectedNames].sort();
  const same = got.length === want.length && got.every((n, i) => n === want[i]);
  assert(
    same,
    `alias "${query}" resolved to [${got.join(" | ")}], expected [${want.join(" | ")}]`,
  );
}

async function main(): Promise<void> {
  const coldStart = Date.now();
  const gtfs = await loadGtfs();
  const coldMs = Date.now() - coldStart;

  const stopTimes = Array.from(gtfs.stopTimesByTrip.values()).reduce((n, a) => n + a.length, 0);

  // Conservative floors: trip only on catastrophic feed breakage (missing
  // file, renamed column). Seasonal ±30% swings are normal — not gated here.
  assert(gtfs.stopsById.size > 100, `stops index too small: ${gtfs.stopsById.size}`);
  assert(gtfs.tripsById.size > 500, `trips index too small: ${gtfs.tripsById.size}`);
  assert(gtfs.routesById.size > 100, `routes index too small: ${gtfs.routesById.size}`);
  assert(gtfs.agenciesById.size > 0, `agencies index empty`);
  assert(stopTimes > 10000, `stop_times index too small: ${stopTimes}`);
  assert(gtfs.servicesById.size > 10, `services index too small: ${gtfs.servicesById.size}`);
  assert(/^\d{8}$/.test(gtfs.feedVersion), `feedVersion not YYYYMMDD: ${gtfs.feedVersion}`);
  assert(/^\d{8}$/.test(gtfs.feedStartDate), `feedStartDate not YYYYMMDD: ${gtfs.feedStartDate}`);
  assert(/^\d{8}$/.test(gtfs.feedEndDate), `feedEndDate not YYYYMMDD: ${gtfs.feedEndDate}`);
  assert(gtfs.feedEndDate > gtfs.feedStartDate, `feedEndDate not after feedStartDate`);

  // Regression guard: a too-loose alias (e.g. "slovensko") would leak across
  // "Železničná spoločnosť Slovensko" and "Leo Express Slovensko".
  assertAliasResolvesTo(gtfs, "ZSSK", [ZSSK_NAME]);
  assertAliasResolvesTo(gtfs, "zssk", [ZSSK_NAME]);
  assertAliasResolvesTo(gtfs, "Slovakrail", [ZSSK_NAME]);
  assertAliasResolvesTo(gtfs, "RegioJet", [REGIOJET_NAME]);
  assertAliasResolvesTo(gtfs, "RJ", [REGIOJET_NAME]);
  assertAliasResolvesTo(gtfs, "LE", [LEO_EXPRESS_CZ_NAME, LEO_EXPRESS_SK_NAME]);
  assertAliasResolvesTo(gtfs, "Leo Express", [LEO_EXPRESS_CZ_NAME, LEO_EXPRESS_SK_NAME]);
  assertAliasResolvesTo(gtfs, "Trezka", [TREZKA_NAME]);

  // Category parser — no surprises, first token is the category.
  assert(trainCategory("Ex 603") === "Ex", "trainCategory('Ex 603')");
  assert(trainCategory("R 681") === "R", "trainCategory('R 681')");
  assert(trainCategory("RJ 1046") === "RJ", "trainCategory('RJ 1046')");
  assert(trainCategory("REX 1954") === "REX", "trainCategory('REX 1954')");
  assert(trainCategory("Os 3960") === "Os", "trainCategory('Os 3960')");
  assert(trainCategory("") === null, "trainCategory('')");

  console.log("\n=== dataset ===");
  console.log({
    feedVersion: gtfs.feedVersion,
    feedValidity: `${gtfs.feedStartDate} → ${gtfs.feedEndDate}`,
    stops: gtfs.stopsById.size,
    trips: gtfs.tripsById.size,
    routes: gtfs.routesById.size,
    agencies: gtfs.agenciesById.size,
    agencyNames: Array.from(gtfs.agenciesById.values()).map(a => a.agencyName),
    stopTimes,
    services: gtfs.servicesById.size,
    coldStartMs: coldMs,
    feedWarning: getFeedWarning(gtfs),
  });

  const weekday = nextWeekdayIso();

  // === find_connection ===
  console.log(`\n=== find_connection  (Bratislava → Košice, ${weekday}) ===`);
  const direct = findConnection(gtfs, {
    from: "Bratislava hl.st.",
    to: "Košice",
    date: weekday,
    departureAfter: "00:00",
    operator: null,
    trainTypes: null,
  });
  assert(direct.status === "ok", `find_connection unexpected status: ${direct.status}`);
  assert(direct.connections.length > 0, `find_connection returned zero connections`);
  console.log(`count=${direct.connections.length}, first=${direct.connections[0]?.trainNumber} @ ${direct.connections[0]?.departureTime}`);

  // === operator filter (tight) ===
  const zsskOnly = findConnection(gtfs, {
    from: "Bratislava hl.st.",
    to: "Košice",
    date: weekday,
    departureAfter: "00:00",
    operator: "ZSSK",
    trainTypes: null,
  });
  assert(zsskOnly.status === "ok", `find_connection(operator=ZSSK) status: ${zsskOnly.status}`);
  const zsskLeak = zsskOnly.connections.find(c => c.agency !== ZSSK_NAME);
  assert(zsskLeak === undefined, `ZSSK filter leaked non-ZSSK agency: ${zsskLeak?.agency ?? ""}`);

  // === train_types filter (Ex only) ===
  console.log(`\n=== find_connection (train_types=["Ex"], Bratislava → Košice, ${weekday}) ===`);
  const exOnly = findConnection(gtfs, {
    from: "Bratislava hl.st.",
    to: "Košice",
    date: weekday,
    departureAfter: "00:00",
    operator: null,
    trainTypes: ["Ex"],
  });
  assert(exOnly.status === "ok", `find_connection(train_types=Ex) status: ${exOnly.status}`);
  assert(exOnly.connections.length > 0, `no Ex trains found between Bratislava and Košice`);
  const exLeak = exOnly.connections.find(c => !c.trainNumber.startsWith("Ex "));
  assert(exLeak === undefined, `Ex filter leaked: ${exLeak?.trainNumber ?? ""}`);
  console.log(`count=${exOnly.connections.length}, all start with "Ex ".`);

  // And confirm the filter actually prunes — unfiltered result is bigger.
  assert(
    exOnly.connections.length < direct.connections.length,
    `train_types filter did not shrink the result (unfiltered=${direct.connections.length}, Ex=${exOnly.connections.length})`,
  );

  // === find_connection_with_transfer ===
  console.log(`\n=== find_connection_with_transfer  (Bratislava → Prešov, ${weekday}) ===`);
  const transfers = findConnectionWithTransfer(gtfs, {
    from: "Bratislava hl.st.",
    to: "Prešov",
    date: weekday,
    departureAfter: "06:00",
    operator: null,
    trainTypes: null,
  });
  assert(transfers.status === "ok", `transfers status: ${transfers.status}`);
  if (transfers.itineraries.length > 0) {
    const first = transfers.itineraries[0];
    assert(first !== undefined, "itinerary[0] present");
    assert(first.transferWaitMinutes >= 5, `transfer wait under 5 min: ${first.transferWaitMinutes}`);
    assert(first.legs[0].tripId !== first.legs[1].tripId, `same trip used for both legs`);
    console.log(`count=${transfers.itineraries.length}, first via ${first.transferAt} (wait ${first.transferWaitMinutes} min, total ${first.totalDurationMinutes} min)`);
  }

  // === get_timetable ===
  console.log(`\n=== get_timetable  (Žilina, ${todayIso()}, limit 5) ===`);
  const timetable = getTimetable(gtfs, {
    station: "Žilina",
    date: todayIso(),
    limit: 5,
    operator: null,
    trainTypes: null,
  });
  assert(timetable.status === "ok", `get_timetable status: ${timetable.status}`);
  assert(timetable.departures.length >= 1, `get_timetable returned no departures`);

  // === operator filter on timetable ===
  const rj = getTimetable(gtfs, {
    station: "Žilina",
    date: todayIso(),
    limit: 5,
    operator: "RegioJet",
    trainTypes: null,
  });
  assert(rj.status === "ok", `get_timetable(operator=RegioJet) status: ${rj.status}`);
  const rjLeak = rj.departures.find(d => d.agency !== REGIOJET_NAME);
  assert(rjLeak === undefined, `RegioJet filter leaked non-RegioJet agency: ${rjLeak?.agency ?? ""}`);

  // === find_trip_by_number ===
  console.log(`\n=== find_trip_by_number  ("Ex 603", ${weekday}) ===`);
  const byNumber = findTripByNumber(gtfs, { trainNumber: "Ex 603", date: weekday });
  assert(byNumber.status === "ok", `find_trip_by_number status: ${byNumber.status}`);
  assert(byNumber.trips.length >= 1, `no trips for Ex 603`);
  const trip0 = byNumber.trips[0];
  assert(trip0 !== undefined, "trip[0] present");
  assert(trip0.trainNumber === "Ex 603", `wrong trainNumber: ${trip0.trainNumber}`);
  assert(trip0.stops.length >= 5, `Ex 603 has suspiciously few stops: ${trip0.stops.length}`);
  // Stop sequence must be monotonically increasing by construction.
  for (let i = 1; i < trip0.stops.length; i++) {
    const prev = trip0.stops[i - 1];
    const curr = trip0.stops[i];
    assert(prev !== undefined && curr !== undefined, "stops populated");
    assert(curr.stopSequence > prev.stopSequence, `stop sequence not monotonic at index ${i}`);
  }
  console.log(`trips=${byNumber.trips.length}, stops on trip[0]=${trip0.stops.length}: ${trip0.stops[0]?.stopName} → ${trip0.stops[trip0.stops.length - 1]?.stopName}`);

  // Unknown number → no_match
  const unknownTrip = findTripByNumber(gtfs, { trainNumber: "XX 99999", date: weekday });
  assert(unknownTrip.status === "no_match", `expected no_match, got ${unknownTrip.status}`);

  // === find_stations_nearby ===
  console.log(`\n=== find_stations_nearby  (Bratislava hl.st. ±5 km) ===`);
  const nearby = findStationsNearby(gtfs, {
    lat: BA_HL_ST_LAT,
    lon: BA_HL_ST_LON,
    radiusKm: 5,
  });
  assert(nearby.status === "ok", `find_stations_nearby status: ${nearby.status}`);
  assert(nearby.stations.length >= 1, `no stations within 5 km of BA hl.st.`);
  const closest = nearby.stations[0];
  assert(closest !== undefined, "closest present");
  assert(closest.stopName.toLowerCase().includes("bratislava"), `closest station not a Bratislava stop: ${closest.stopName}`);
  assert(closest.distanceKm < 0.5, `closest BA station further than 0.5 km: ${closest.distanceKm} km`);
  // Distances must be monotonically non-decreasing (sorted by distance asc).
  for (let i = 1; i < nearby.stations.length; i++) {
    const prev = nearby.stations[i - 1];
    const curr = nearby.stations[i];
    assert(prev !== undefined && curr !== undefined, "station pair populated");
    assert(curr.distanceKm >= prev.distanceKm, `stations not sorted by distance at index ${i}`);
  }
  console.log(`count=${nearby.stations.length}, closest=${closest.stopName} (${closest.distanceKm} km)`);

  // Invalid coordinates → invalid_coordinates
  const badCoords = findStationsNearby(gtfs, { lat: 999, lon: 0, radiusKm: 5 });
  assert(badCoords.status === "invalid_coordinates", `expected invalid_coordinates, got ${badCoords.status}`);

  // === check_delay (stub) ===
  const delay = checkDelay({ trainNumber: "Ex 42" });
  assert(delay.status === "not_implemented", `check_delay should be stubbed`);

  // === operator error path ===
  const bogus = findConnection(gtfs, {
    from: "Bratislava hl.st.",
    to: "Košice",
    date: weekday,
    departureAfter: "00:00",
    operator: "NoSuchOperator",
    trainTypes: null,
  });
  assert(bogus.status === "no_match_operator", `expected no_match_operator, got ${bogus.status}`);

  const warmStart = Date.now();
  await loadGtfs();
  console.log(`\n=== warm-cache reload: ${Date.now() - warmStart}ms ===`);
  console.log("\n[smoke] all assertions passed.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
