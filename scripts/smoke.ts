// Smoke test: runs every tool against the live feed. Exits non-zero on any
// assertion failure so it can gate a prod deploy without a test framework.
import { loadGtfs } from "../src/adapters/gtfs-loader.js";
import { findConnection } from "../src/use-cases/find-connection.js";
import { findConnectionWithTransfer } from "../src/use-cases/find-connection-with-transfer.js";
import { getTimetable } from "../src/use-cases/get-timetable.js";
import { checkDelay } from "../src/use-cases/check-delay.js";
import { resolveAgencies } from "../src/use-cases/resolve-agency.js";

const ZSSK_NAME = "Železničná spoločnosť Slovensko, a.s.";
const REGIOJET_NAME = "RegioJet,a.s.";
const LEO_EXPRESS_CZ_NAME = "Leo Express s.r.o.";
const LEO_EXPRESS_SK_NAME = "Leo Express Slovensko s.r.o.";
const TREZKA_NAME = "Trenčianska elektrická železnica, n.o.";

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

  console.log("\n=== dataset ===");
  console.log({
    feedVersion: gtfs.feedVersion,
    stops: gtfs.stopsById.size,
    trips: gtfs.tripsById.size,
    routes: gtfs.routesById.size,
    agencies: gtfs.agenciesById.size,
    agencyNames: Array.from(gtfs.agenciesById.values()).map(a => a.agencyName),
    stopTimes,
    services: gtfs.servicesById.size,
    coldStartMs: coldMs,
  });

  const weekday = nextWeekdayIso();
  console.log(`\n=== find_connection  (Bratislava → Košice, ${weekday}) ===`);
  const direct = findConnection(gtfs, {
    from: "Bratislava hl.st.",
    to: "Košice",
    date: weekday,
    departureAfter: "00:00",
    operator: null,
  });
  console.log(JSON.stringify(direct, null, 2));
  assert(direct.status === "ok", `find_connection unexpected status: ${direct.status}`);
  assert(direct.connections.length > 0, `find_connection returned zero connections`);

  console.log(`\n=== find_connection (operator=ZSSK, Bratislava → Košice, ${weekday}) ===`);
  const zsskOnly = findConnection(gtfs, {
    from: "Bratislava hl.st.",
    to: "Košice",
    date: weekday,
    departureAfter: "00:00",
    operator: "ZSSK",
  });
  console.log(JSON.stringify(
    zsskOnly.status === "ok"
      ? { status: "ok", count: zsskOnly.connections.length, first: zsskOnly.connections[0] ?? null }
      : zsskOnly,
    null, 2,
  ));
  assert(zsskOnly.status === "ok", `find_connection(operator=ZSSK) status: ${zsskOnly.status}`);
  const zsskLeak = zsskOnly.connections.find(c => c.agency !== ZSSK_NAME);
  assert(
    zsskLeak === undefined,
    `ZSSK filter leaked non-ZSSK agency: ${zsskLeak?.agency ?? ""}`,
  );

  console.log(`\n=== find_connection_with_transfer  (Bratislava → Prešov, ${weekday}) ===`);
  const transfers = findConnectionWithTransfer(gtfs, {
    from: "Bratislava hl.st.",
    to: "Prešov",
    date: weekday,
    departureAfter: "06:00",
    operator: null,
  });
  if (transfers.status === "ok") {
    console.log(JSON.stringify(
      { status: "ok", count: transfers.itineraries.length, first: transfers.itineraries[0] ?? null },
      null, 2,
    ));
    if (transfers.itineraries.length > 0) {
      const first = transfers.itineraries[0];
      assert(first !== undefined, "itinerary[0] present");
      assert(first.transferWaitMinutes >= 5, `transfer wait under 5 min: ${first.transferWaitMinutes}`);
      assert(first.legs[0].tripId !== first.legs[1].tripId, `same trip used for both legs`);
    }
  } else {
    console.log(JSON.stringify(transfers, null, 2));
  }

  console.log(`\n=== get_timetable  (Žilina, ${todayIso()}, limit 5) ===`);
  const timetable = getTimetable(gtfs, {
    station: "Žilina",
    date: todayIso(),
    limit: 5,
    operator: null,
  });
  console.log(JSON.stringify(timetable, null, 2));
  assert(timetable.status === "ok", `get_timetable status: ${timetable.status}`);
  assert(timetable.departures.length >= 1, `get_timetable returned no departures`);

  console.log("\n=== get_timetable (operator=RegioJet, Žilina) ===");
  const rj = getTimetable(gtfs, {
    station: "Žilina",
    date: todayIso(),
    limit: 5,
    operator: "RegioJet",
  });
  console.log(JSON.stringify(
    rj.status === "ok"
      ? { status: "ok", count: rj.departures.length, sample: rj.departures.slice(0, 2) }
      : rj,
    null, 2,
  ));
  assert(rj.status === "ok", `get_timetable(operator=RegioJet) status: ${rj.status}`);
  const rjLeak = rj.departures.find(d => d.agency !== REGIOJET_NAME);
  assert(
    rjLeak === undefined,
    `RegioJet filter leaked non-RegioJet agency: ${rjLeak?.agency ?? ""}`,
  );

  console.log("\n=== find_connection (operator=NoSuchOp, error path) ===");
  const bogus = findConnection(gtfs, {
    from: "Bratislava hl.st.",
    to: "Košice",
    date: weekday,
    departureAfter: "00:00",
    operator: "NoSuchOperator",
  });
  console.log(JSON.stringify(bogus, null, 2));
  assert(bogus.status === "no_match_operator", `expected no_match_operator, got ${bogus.status}`);

  console.log("\n=== check_delay  (Ex 42) ===");
  console.log(JSON.stringify(checkDelay({ trainNumber: "Ex 42" }), null, 2));

  const warmStart = Date.now();
  await loadGtfs();
  console.log(`\n=== warm-cache reload: ${Date.now() - warmStart}ms ===`);
  console.log("\n[smoke] all assertions passed.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
