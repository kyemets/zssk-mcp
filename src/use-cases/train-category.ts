import type { Route } from "../entities/route.js";

// ZSSK / ŽSR route_short_name is always "<category> <number>" (e.g. "Ex 603",
// "R 681", "Os 3960", "RJ 1046", "REX 1954") when a category is set. Trip-only
// specials without a category collapse to the whole short name.
export function trainCategory(shortName: string): string | null {
  const trimmed = shortName.trim();
  if (!trimmed) return null;
  const firstSpace = trimmed.indexOf(" ");
  return firstSpace >= 0 ? trimmed.slice(0, firstSpace) : trimmed;
}

// null/[] = no filter. Empty allowed set is treated as "no filter" rather than
// "reject everything" so callers can pass through optional args without branching.
export function matchesTrainTypes(
  route: Route | undefined,
  allowedLower: ReadonlySet<string> | null,
): boolean {
  if (!allowedLower || allowedLower.size === 0) return true;
  if (!route) return false;
  const cat = trainCategory(route.shortName);
  return cat !== null && allowedLower.has(cat.toLowerCase());
}

export function normalizeTrainTypes(
  types: ReadonlyArray<string> | null,
): ReadonlySet<string> | null {
  if (!types || types.length === 0) return null;
  return new Set(
    types.map((t) => t.trim().toLowerCase()).filter((t) => t.length > 0),
  );
}
