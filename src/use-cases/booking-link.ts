import type { Agency } from "../entities/agency.js";

export type BookingLink = Readonly<{
  provider: string;
  url: string;
  note: string;
}>;

// Portal URLs per operator. Query params are best-effort — each booking
// site may ignore unknown keys and just land the user on the pre-filled
// search page, or on the root. We document this as a deep-link *hint*,
// not a contract, so callers don't treat it as guaranteed auto-fill.
const BEST_EFFORT_NOTE =
  "Best-effort deep-link. The booking portal may ignore query params and " +
  "land on its homepage — in that case fill the form manually.";

export function buildBookingLink(
  agency: Agency | undefined,
  journey: Readonly<{
    from: string;
    to: string;
    date: string;
    departureTime: string;
  }>,
): BookingLink {
  const qs = new URLSearchParams({
    from: journey.from,
    to: journey.to,
    date: journey.date,
    time: journey.departureTime,
  }).toString();

  const agencyId = agency?.agencyId ?? "";
  if (agencyId === "1") {
    return {
      provider: "RegioJet",
      url: `https://www.regiojet.com/?${qs}`,
      note: BEST_EFFORT_NOTE,
    };
  }
  if (agencyId === "2" || agencyId === "4") {
    return {
      provider: "Leo Express",
      url: `https://www.leoexpress.com/?${qs}`,
      note: BEST_EFFORT_NOTE,
    };
  }
  // ZSSK (agency_id "0") and anyone else (incl. Trezka which has no online
  // booking) fall back to the ZSSK portal.
  return {
    provider: "ZSSK",
    url: `https://ik.zssk.sk/?${qs}`,
    note: BEST_EFFORT_NOTE,
  };
}
