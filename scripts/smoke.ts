// Smoke test: runs every tool against the live feed. Exits non-zero on any
// assertion failure so it can gate a prod deploy without a test framework.
import { loadGtfs } from "../src/adapters/gtfs-loader.js";
import {
  findConnection,
  type SortBy,
} from "../src/use-cases/find-connection.js";
import { findConnectionWithTransfer } from "../src/use-cases/find-connection-with-transfer.js";
import { findTripByNumber } from "../src/use-cases/find-trip-by-number.js";
import { findStationsNearby } from "../src/use-cases/find-stations-nearby.js";
import { searchStations } from "../src/use-cases/search-stations.js";
import { exportIcs } from "../src/use-cases/export-ics.js";
import { renderTripRoute } from "../src/use-cases/render-trip-route.js";
import { renderServiceCalendar } from "../src/use-cases/render-service-calendar.js";
import { renderTimetableChart } from "../src/use-cases/render-timetable-chart.js";
import { getTimetable } from "../src/use-cases/get-timetable.js";
import { checkDelay } from "../src/use-cases/check-delay.js";
import { resolveAgencies } from "../src/use-cases/resolve-agency.js";
import { trainCategory } from "../src/use-cases/train-category.js";
import { getFeedWarning, buildFeedInfo } from "../src/use-cases/feed-status.js";

const ZSSK_NAME = "Železničná spoločnosť Slovensko, a.s.";
const REGIOJET_NAME = "RegioJet,a.s.";
const LEO_EXPRESS_CZ_NAME = "Leo Express s.r.o.";
const LEO_EXPRESS_SK_NAME = "Leo Express Slovensko s.r.o.";
const TREZKA_NAME = "Trenčianska elektrická železnica, n.o.";

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
  const got = match.agencies.map((a) => a.agencyName).sort();
  const want = [...expectedNames].sort();
  const same = got.length === want.length && got.every((n, i) => n === want[i]);
  assert(
    same,
    `alias "${query}" resolved to [${got.join(" | ")}], expected [${want.join(" | ")}]`,
  );
}

type FcInput = Parameters<typeof findConnection>[1];

// Tiny builder to keep the dozen-ish findConnection() calls below readable —
// only the fields that vary are passed as overrides.
function fc(
  overrides: Partial<FcInput> & Pick<FcInput, "from" | "to" | "date">,
): FcInput {
  return {
    departureAfter: "00:00",
    arriveBy: null,
    operator: null,
    trainTypes: null,
    via: null,
    wheelchairOnly: false,
    sortBy: "earliest_departure" as SortBy,
    ...overrides,
  };
}

async function main(): Promise<void> {
  const coldStart = Date.now();
  const gtfs = await loadGtfs();
  const coldMs = Date.now() - coldStart;

  const stopTimes = Array.from(gtfs.stopTimesByTrip.values()).reduce(
    (n, a) => n + a.length,
    0,
  );

  // Conservative floors: trip only on catastrophic feed breakage.
  assert(
    gtfs.stopsById.size > 100,
    `stops index too small: ${gtfs.stopsById.size}`,
  );
  assert(
    gtfs.tripsById.size > 500,
    `trips index too small: ${gtfs.tripsById.size}`,
  );
  assert(
    gtfs.routesById.size > 100,
    `routes index too small: ${gtfs.routesById.size}`,
  );
  assert(gtfs.agenciesById.size > 0, `agencies index empty`);
  assert(stopTimes > 10000, `stop_times index too small: ${stopTimes}`);
  assert(
    gtfs.servicesById.size > 10,
    `services index too small: ${gtfs.servicesById.size}`,
  );
  assert(
    /^\d{8}$/.test(gtfs.feedVersion),
    `feedVersion not YYYYMMDD: ${gtfs.feedVersion}`,
  );
  assert(
    /^\d{8}$/.test(gtfs.feedStartDate),
    `feedStartDate not YYYYMMDD: ${gtfs.feedStartDate}`,
  );
  assert(
    /^\d{8}$/.test(gtfs.feedEndDate),
    `feedEndDate not YYYYMMDD: ${gtfs.feedEndDate}`,
  );
  assert(
    gtfs.feedEndDate > gtfs.feedStartDate,
    `feedEndDate not after feedStartDate`,
  );

  assertAliasResolvesTo(gtfs, "ZSSK", [ZSSK_NAME]);
  assertAliasResolvesTo(gtfs, "zssk", [ZSSK_NAME]);
  assertAliasResolvesTo(gtfs, "Slovakrail", [ZSSK_NAME]);
  assertAliasResolvesTo(gtfs, "RegioJet", [REGIOJET_NAME]);
  assertAliasResolvesTo(gtfs, "RJ", [REGIOJET_NAME]);
  assertAliasResolvesTo(gtfs, "LE", [LEO_EXPRESS_CZ_NAME, LEO_EXPRESS_SK_NAME]);
  assertAliasResolvesTo(gtfs, "Leo Express", [
    LEO_EXPRESS_CZ_NAME,
    LEO_EXPRESS_SK_NAME,
  ]);
  assertAliasResolvesTo(gtfs, "Trezka", [TREZKA_NAME]);

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
    stopTimes,
    services: gtfs.servicesById.size,
    coldStartMs: coldMs,
    feedWarning: getFeedWarning(gtfs),
  });

  const weekday = nextWeekdayIso();

  // === find_connection ===
  console.log(`\n=== find_connection  (Bratislava → Košice, ${weekday}) ===`);
  const direct = findConnection(
    gtfs,
    fc({ from: "Bratislava hl.st.", to: "Košice", date: weekday }),
  );
  assert(
    direct.status === "ok",
    `find_connection unexpected status: ${direct.status}`,
  );
  assert(
    direct.connections.length > 0,
    `find_connection returned zero connections`,
  );
  const first = direct.connections[0];
  assert(first !== undefined, "connections[0] defined");
  assert(
    first.durationMinutes > 0,
    `durationMinutes missing: ${first.durationMinutes}`,
  );
  assert(
    typeof first.international === "boolean",
    `international field missing`,
  );
  assert(Array.isArray(first.borderCountries), `borderCountries field missing`);
  assert(first.booking.url.startsWith("https://"), `booking URL missing`);
  console.log(
    `count=${direct.connections.length}, first=${first.trainNumber} @ ${first.departureTime} (${first.durationMinutes} min, booking=${first.booking.provider})`,
  );

  // v0.2: operator filter (tight)
  const zsskOnly = findConnection(
    gtfs,
    fc({
      from: "Bratislava hl.st.",
      to: "Košice",
      date: weekday,
      operator: "ZSSK",
    }),
  );
  assert(
    zsskOnly.status === "ok",
    `find_connection(operator=ZSSK) status: ${zsskOnly.status}`,
  );
  const zsskLeak = zsskOnly.connections.find((c) => c.agency !== ZSSK_NAME);
  assert(
    zsskLeak === undefined,
    `ZSSK filter leaked non-ZSSK agency: ${zsskLeak?.agency ?? ""}`,
  );

  // v0.3: train_types filter
  const exOnly = findConnection(
    gtfs,
    fc({
      from: "Bratislava hl.st.",
      to: "Košice",
      date: weekday,
      trainTypes: ["Ex"],
    }),
  );
  assert(
    exOnly.status === "ok",
    `find_connection(train_types=Ex) status: ${exOnly.status}`,
  );
  assert(
    exOnly.connections.length > 0,
    `no Ex trains found between Bratislava and Košice`,
  );
  const exLeak = exOnly.connections.find(
    (c) => !c.trainNumber.startsWith("Ex "),
  );
  assert(
    exLeak === undefined,
    `Ex filter leaked: ${exLeak?.trainNumber ?? ""}`,
  );
  assert(
    exOnly.connections.length < direct.connections.length,
    `train_types filter did not shrink the result`,
  );

  // v0.4: via filter
  const viaZilina = findConnection(
    gtfs,
    fc({
      from: "Bratislava hl.st.",
      to: "Košice",
      date: weekday,
      via: "Žilina",
    }),
  );
  assert(viaZilina.status === "ok", `via status: ${viaZilina.status}`);
  assert(viaZilina.via !== null, `via name not echoed`);
  assert(
    viaZilina.connections.length > 0,
    `via=Žilina: expected ≥1 connection`,
  );
  assert(
    viaZilina.connections.length <= direct.connections.length,
    `via filter did not shrink or equal`,
  );

  const viaTypo = findConnection(
    gtfs,
    fc({
      from: "Bratislava hl.st.",
      to: "Košice",
      date: weekday,
      via: "Atlantida",
    }),
  );
  assert(
    viaTypo.status === "no_match" && viaTypo.which === "via",
    `expected no_match/via, got ${viaTypo.status}`,
  );

  // v0.4: arrive_by gate
  const arriveEarly = findConnection(
    gtfs,
    fc({
      from: "Bratislava hl.st.",
      to: "Košice",
      date: weekday,
      arriveBy: "12:00",
    }),
  );
  assert(
    arriveEarly.status === "ok",
    `arrive_by status: ${arriveEarly.status}`,
  );
  const lateArrival = arriveEarly.connections.find(
    (c) => c.arrivalTime > "12:00",
  );
  assert(
    lateArrival === undefined,
    `arrive_by=12:00 leaked ${lateArrival?.arrivalTime ?? ""}`,
  );
  assert(
    arriveEarly.connections.length < direct.connections.length,
    `arrive_by did not shrink result`,
  );

  // === v0.5: sort_by produces different orderings ===
  console.log(
    `\n=== find_connection sort_by variants (Bratislava → Košice, ${weekday}) ===`,
  );
  const byDep = findConnection(
    gtfs,
    fc({
      from: "Bratislava hl.st.",
      to: "Košice",
      date: weekday,
      sortBy: "earliest_departure",
    }),
  );
  const byArr = findConnection(
    gtfs,
    fc({
      from: "Bratislava hl.st.",
      to: "Košice",
      date: weekday,
      sortBy: "earliest_arrival",
    }),
  );
  const byDur = findConnection(
    gtfs,
    fc({
      from: "Bratislava hl.st.",
      to: "Košice",
      date: weekday,
      sortBy: "shortest_trip",
    }),
  );
  assert(
    byDep.status === "ok" && byArr.status === "ok" && byDur.status === "ok",
    "all sort variants ok",
  );

  // Monotonicity of each sort.
  for (let i = 1; i < byDep.connections.length; i++) {
    const prev = byDep.connections[i - 1];
    const curr = byDep.connections[i];
    assert(prev !== undefined && curr !== undefined, "dep pair");
    assert(
      curr.departureTime >= prev.departureTime,
      `earliest_departure not monotonic at ${i}`,
    );
  }
  for (let i = 1; i < byArr.connections.length; i++) {
    const prev = byArr.connections[i - 1];
    const curr = byArr.connections[i];
    assert(prev !== undefined && curr !== undefined, "arr pair");
    assert(
      curr.arrivalTime >= prev.arrivalTime,
      `earliest_arrival not monotonic at ${i}`,
    );
  }
  for (let i = 1; i < byDur.connections.length; i++) {
    const prev = byDur.connections[i - 1];
    const curr = byDur.connections[i];
    assert(prev !== undefined && curr !== undefined, "dur pair");
    assert(
      curr.durationMinutes >= prev.durationMinutes,
      `shortest_trip not monotonic at ${i}`,
    );
  }

  const durationsDep = byDep.connections.map((c) => c.durationMinutes);
  const durationsDur = byDur.connections.map((c) => c.durationMinutes);
  // shortest_trip's first element must have duration ≤ any other ordering's first element.
  const firstByDep = byDep.connections[0];
  const firstByDur = byDur.connections[0];
  assert(
    firstByDep !== undefined && firstByDur !== undefined,
    "first elements defined",
  );
  assert(
    firstByDur.durationMinutes <= firstByDep.durationMinutes,
    `shortest_trip did not prioritise short trips`,
  );
  console.log(`  earliest_departure: first duration=${durationsDep[0]} min`);
  console.log(`  shortest_trip:      first duration=${durationsDur[0]} min`);

  // === v0.5: international / booking on cross-border RJ to Prague ===
  console.log(`\n=== international + booking on RJ Žilina → Praha ===`);
  const rjToPrague = findConnection(
    gtfs,
    fc({
      from: "Žilina",
      to: "Praha hl.n.",
      date: weekday,
      operator: "RegioJet",
    }),
  );
  if (rjToPrague.status === "ok" && rjToPrague.connections.length > 0) {
    const intlFirst = rjToPrague.connections[0];
    assert(intlFirst !== undefined, "intl first");
    assert(
      intlFirst.international === true,
      `expected international=true for Žilina → Praha, got false`,
    );
    assert(
      intlFirst.borderCountries.includes("CZ"),
      `expected CZ in borderCountries, got [${intlFirst.borderCountries.join(",")}]`,
    );
    assert(
      intlFirst.booking.provider === "RegioJet",
      `expected RegioJet booking provider, got ${intlFirst.booking.provider}`,
    );
    console.log(
      `  first: ${intlFirst.trainNumber}, countries=[${intlFirst.borderCountries.join(",")}], booking=${intlFirst.booking.provider} ${intlFirst.booking.url}`,
    );
  } else {
    // Non-fatal — Žilina→Praha RJ services may not run every day.
    console.log(`  skipped: no RJ to Praha on ${weekday}`);
  }

  // === wheelchair_only, date_out_of_range — same shape as v0.4 ===
  const wheelchairSet = getTimetable(gtfs, {
    station: "Bratislava hl.st.",
    date: weekday,
    limit: 50,
    operator: null,
    trainTypes: null,
    wheelchairOnly: true,
  });
  assert(
    wheelchairSet.status === "ok",
    `wheelchair_only status: ${wheelchairSet.status}`,
  );
  const wcLeak = wheelchairSet.departures.find(
    (d) => d.wheelchairAccessible !== 1,
  );
  assert(
    wcLeak === undefined,
    `wheelchair_only leaked trip with wheelchairAccessible=${wcLeak?.wheelchairAccessible ?? "?"}`,
  );

  const farPast = "2020-01-01";
  const farFuture = "2030-01-01";
  const dateOoR = findConnection(
    gtfs,
    fc({ from: "Bratislava hl.st.", to: "Košice", date: farPast }),
  );
  assert(
    dateOoR.status === "date_out_of_range",
    `far-past direct: got ${dateOoR.status}`,
  );
  const dateOoRTT = getTimetable(gtfs, {
    station: "Žilina",
    date: farFuture,
    limit: 5,
    operator: null,
    trainTypes: null,
    wheelchairOnly: false,
  });
  assert(
    dateOoRTT.status === "date_out_of_range",
    `far-future timetable: got ${dateOoRTT.status}`,
  );

  // === find_connection_with_transfer ===
  console.log(
    `\n=== find_connection_with_transfer  (Bratislava → Prešov, ${weekday}) ===`,
  );
  const transfers = findConnectionWithTransfer(gtfs, {
    from: "Bratislava hl.st.",
    to: "Prešov",
    date: weekday,
    departureAfter: "06:00",
    arriveBy: null,
    operator: null,
    trainTypes: null,
    via: null,
    wheelchairOnly: false,
    sortBy: "earliest_arrival",
  });
  assert(transfers.status === "ok", `transfers status: ${transfers.status}`);
  if (transfers.itineraries.length > 0) {
    const firstItin = transfers.itineraries[0];
    assert(firstItin !== undefined, "itinerary[0] present");
    assert(
      firstItin.transferWaitMinutes >= 5,
      `transfer wait under 5 min: ${firstItin.transferWaitMinutes}`,
    );
    assert(
      firstItin.legs[0].tripId !== firstItin.legs[1].tripId,
      `same trip used for both legs`,
    );
    assert(
      firstItin.legs[0].booking.url.startsWith("https://"),
      `leg1 booking missing`,
    );
    assert(firstItin.legs[0].durationMinutes > 0, `leg1 duration missing`);
    console.log(
      `count=${transfers.itineraries.length}, first via ${firstItin.transferAt} (wait ${firstItin.transferWaitMinutes} min, total ${firstItin.totalDurationMinutes} min)`,
    );
  }

  // === find_trip_by_number (enriched) ===
  console.log(`\n=== find_trip_by_number  ("Ex 603", ${weekday}) ===`);
  const byNumber = findTripByNumber(gtfs, {
    trainNumber: "Ex 603",
    date: weekday,
    wheelchairOnly: false,
  });
  assert(
    byNumber.status === "ok",
    `find_trip_by_number status: ${byNumber.status}`,
  );
  assert(byNumber.trips.length >= 1, `no trips for Ex 603`);
  const trip0 = byNumber.trips[0];
  assert(trip0 !== undefined, "trip[0] present");
  assert(trip0.durationMinutes > 0, `trip durationMinutes missing`);
  assert(
    trip0.booking.provider === "ZSSK",
    `Ex 603 booking should be ZSSK, got ${trip0.booking.provider}`,
  );
  for (let i = 1; i < trip0.stops.length; i++) {
    const prev = trip0.stops[i - 1];
    const curr = trip0.stops[i];
    assert(prev !== undefined && curr !== undefined, "stops populated");
    assert(
      curr.stopSequence > prev.stopSequence,
      `stop sequence not monotonic at index ${i}`,
    );
  }
  console.log(
    `trips=${byNumber.trips.length}, duration=${trip0.durationMinutes} min, booking=${trip0.booking.provider}`,
  );

  // === v0.5: search_stations ===
  console.log(`\n=== search_stations  ("Bratislava", limit 10) ===`);
  const stationHits = searchStations("Bratislava", gtfs.stopsById, 10);
  assert(
    stationHits.matches.length > 1,
    `expected multiple Bratislava-named stations, got ${stationHits.matches.length}`,
  );
  // Sorted by score desc, then alphabetical within tier.
  for (let i = 1; i < stationHits.matches.length; i++) {
    const prev = stationHits.matches[i - 1];
    const curr = stationHits.matches[i];
    assert(prev !== undefined && curr !== undefined, "hit pair");
    assert(
      prev.score > curr.score ||
        (prev.score === curr.score &&
          prev.stopName.localeCompare(curr.stopName) <= 0),
      `search_stations out of order at ${i}: ${prev.stopName}(${prev.score}) vs ${curr.stopName}(${curr.score})`,
    );
  }
  const topHit = stationHits.matches[0];
  assert(topHit !== undefined, "top hit present");
  console.log(
    `count=${stationHits.matches.length}, top=${topHit.stopName} (score ${topHit.score})`,
  );

  // Diacritic-insensitive.
  const zilinaHits = searchStations("Zilina", gtfs.stopsById, 5);
  assert(zilinaHits.matches.length > 0, `diacritic-free 'Zilina' should match`);

  // === v0.5: export_connection_as_ics ===
  console.log(`\n=== export_connection_as_ics  (Ex 603 trip) ===`);
  const ex603TripId = trip0.tripId;
  const ics = exportIcs(gtfs, { tripId: ex603TripId, date: weekday });
  assert(ics.status === "ok", `export_ics status: ${ics.status}`);
  assert(ics.ics.includes("BEGIN:VCALENDAR"), `missing VCALENDAR header`);
  assert(ics.ics.includes("BEGIN:VEVENT"), `missing VEVENT block`);
  assert(ics.ics.includes("END:VEVENT"), `missing VEVENT close`);
  assert(
    ics.ics.includes("DTSTART;TZID=Europe/Bratislava:"),
    `missing DTSTART with TZID`,
  );
  assert(
    ics.ics.includes("DTEND;TZID=Europe/Bratislava:"),
    `missing DTEND with TZID`,
  );
  assert(
    ics.ics.includes("SUMMARY:Ex 603"),
    `SUMMARY does not start with Ex 603`,
  );
  console.log(`ics bytes=${ics.ics.length}, TZID=Europe/Bratislava embedded`);

  const icsUnknown = exportIcs(gtfs, { tripId: "99999999", date: weekday });
  assert(
    icsUnknown.status === "trip_not_found",
    `unknown trip should return trip_not_found, got ${icsUnknown.status}`,
  );

  const icsPast = exportIcs(gtfs, { tripId: ex603TripId, date: farPast });
  assert(
    icsPast.status === "date_out_of_range",
    `past date export: got ${icsPast.status}`,
  );

  // === find_stations_nearby ===
  console.log(`\n=== find_stations_nearby  (Bratislava hl.st. ±5 km) ===`);
  const nearby = findStationsNearby(gtfs, {
    lat: BA_HL_ST_LAT,
    lon: BA_HL_ST_LON,
    radiusKm: 5,
  });
  assert(
    nearby.status === "ok",
    `find_stations_nearby status: ${nearby.status}`,
  );
  assert(nearby.stations.length >= 1, `no stations within 5 km of BA hl.st.`);
  const closest = nearby.stations[0];
  assert(closest !== undefined, "closest present");
  assert(
    closest.stopName.toLowerCase().includes("bratislava"),
    `closest station not a Bratislava stop: ${closest.stopName}`,
  );
  assert(
    closest.distanceKm < 0.5,
    `closest BA station further than 0.5 km: ${closest.distanceKm} km`,
  );

  // === feed-info snapshot ===
  const info = buildFeedInfo(gtfs);
  assert(info.feedVersion === gtfs.feedVersion, `feedInfo.version mismatch`);
  assert(
    info.agencies.length === gtfs.agenciesById.size,
    `feedInfo agency count mismatch`,
  );
  assert(
    info.counts.stops === gtfs.stopsById.size,
    `feedInfo counts.stops mismatch`,
  );
  console.log(
    `\n=== feed-info snapshot: version=${info.feedVersion}, agencies=${info.agencies.length}, warning=${info.warning?.severity ?? "none"} ===`,
  );

  // === check_delay (stub) ===
  const delay = checkDelay({ trainNumber: "Ex 42" });
  assert(delay.status === "not_implemented", `check_delay should be stubbed`);

  // === v0.6: badges present on enriched results ===
  assert(Array.isArray(first.badges), `connection.badges missing`);
  // Ex 603 is an express, so at minimum we expect an express badge.
  const hasExpressBadge = first.badges.some(b => b.kind === "express");
  assert(hasExpressBadge, `expected Express badge on Ex 603, got [${first.badges.map(b => b.kind).join(",")}]`);

  // === v0.6: render_trip_route ===
  console.log(`\n=== render_trip_route  (Ex 603 trip, ${weekday}) ===`);
  const rendered = renderTripRoute(gtfs, { tripId: trip0.tripId, date: weekday });
  assert(rendered.status === "ok", `render_trip_route status: ${rendered.status}`);
  assert(rendered.route.includes("●"), `route missing stop marker`);
  assert(rendered.route.includes("│"), `route missing connector`);
  assert(rendered.route.includes("→"), `header missing arrow`);
  assert(rendered.route.includes("Bratislava hl.st."), `route missing origin`);
  assert(rendered.route.includes("Košice"), `route missing destination`);
  assert(rendered.summary.stops >= 10, `summary.stops=${rendered.summary.stops}`);
  console.log(rendered.route.split("\n").slice(0, 6).join("\n"));
  console.log("  … (truncated)");

  const unknownTripRender = renderTripRoute(gtfs, { tripId: "99999999", date: weekday });
  assert(unknownTripRender.status === "trip_not_found", `expected trip_not_found, got ${unknownTripRender.status}`);

  // === v0.6: render_service_calendar ===
  const month = `${weekday.slice(0, 7)}`;
  console.log(`\n=== render_service_calendar  (Ex 603, ${month}) ===`);
  const cal = renderServiceCalendar(gtfs, { trainNumber: "Ex 603", month });
  assert(cal.status === "ok", `render_service_calendar status: ${cal.status}`);
  assert(cal.calendar.includes("Mo Tu We Th Fr Sa Su"), `calendar missing header row`);
  assert(cal.calendar.includes("●"), `calendar missing runs glyph`);
  assert(cal.totalRunningDays > 0, `Ex 603 should run on some days in ${month}`);
  console.log(cal.calendar);

  const badMonth = renderServiceCalendar(gtfs, { trainNumber: "Ex 603", month: "2026-13" });
  assert(badMonth.status === "invalid_month", `expected invalid_month, got ${badMonth.status}`);

  const unknownTrain = renderServiceCalendar(gtfs, { trainNumber: "XX 99999", month });
  assert(unknownTrain.status === "no_match", `expected no_match, got ${unknownTrain.status}`);

  // === v0.6: render_timetable_chart ===
  console.log(`\n=== render_timetable_chart  (Žilina, ${weekday}) ===`);
  const chart = renderTimetableChart(gtfs, { station: "Žilina", date: weekday });
  assert(chart.status === "ok", `render_timetable_chart status: ${chart.status}`);
  assert(chart.chart.includes("●"), `chart missing bar glyph`);
  assert(chart.totalDepartures > 10, `Žilina should have > 10 departures, got ${chart.totalDepartures}`);
  // Chart contains 24 hour buckets at minimum.
  const hourLines = chart.chart.split("\n").filter(l => /^\d{2} /.test(l));
  assert(hourLines.length >= 24, `chart should have 24 hour rows, got ${hourLines.length}`);
  console.log(chart.chart.split("\n").slice(0, 14).join("\n"));
  console.log("  …");

  // === operator error path ===
  const bogus = findConnection(
    gtfs,
    fc({
      from: "Bratislava hl.st.",
      to: "Košice",
      date: weekday,
      operator: "NoSuchOperator",
    }),
  );
  assert(
    bogus.status === "no_match_operator",
    `expected no_match_operator, got ${bogus.status}`,
  );

  const warmStart = Date.now();
  await loadGtfs();
  console.log(`\n=== warm-cache reload: ${Date.now() - warmStart}ms ===`);
  console.log("\n[smoke] all assertions passed.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
