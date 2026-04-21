import type { Agency } from "../entities/agency.js";

// Keys: user-facing short codes (already normalized). Values: a substring
// that uniquely selects the intended agency(ies).
// Invariant: values MUST NOT loosely match unrelated agencies —
// e.g. "slovensko" would leak into both "Železničná spoločnosť Slovensko"
// and "Leo Express Slovensko".
const AGENCY_ALIASES: ReadonlyMap<string, string> = new Map([
  ["zssk", "zeleznicna spolocnost"],
  ["zs", "zeleznicna spolocnost"],
  ["slovakrail", "zeleznicna spolocnost"],
  ["regiojet", "regiojet"],
  ["rj", "regiojet"],
  ["leoexpress", "leo express"],
  ["le", "leo express"],
  ["trezka", "trencianska"],
  ["te", "trencianska"],
]);

export type AgencyMatch =
  | Readonly<{ kind: "matched"; agencies: ReadonlyArray<Agency> }>
  | Readonly<{ kind: "none"; available: ReadonlyArray<string> }>;

export function resolveAgencies(
  query: string,
  agencies: ReadonlyMap<string, Agency>,
): AgencyMatch {
  const q = normalize(query);
  if (!q) {
    return { kind: "matched", agencies: [] };
  }
  const effective = AGENCY_ALIASES.get(q) ?? q;
  const hits: Agency[] = [];
  for (const agency of agencies.values()) {
    if (normalize(agency.agencyName).includes(effective)) hits.push(agency);
  }
  if (hits.length > 0) return { kind: "matched", agencies: hits };
  return {
    kind: "none",
    available: Array.from(agencies.values()).map(a => a.agencyName),
  };
}

function normalize(s: string): string {
  return s.normalize("NFKD").replace(/\p{Diacritic}/gu, "").toLowerCase().trim();
}
