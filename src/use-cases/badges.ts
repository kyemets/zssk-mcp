import { trainCategory } from "./train-category.js";

// Compact, client-renderable indicators. Symbols are single Unicode chars
// (not full emoji sequences) so both plain-text and emoji-aware clients
// display them reasonably. Kinds are machine-readable; UIs can ignore
// `symbol` and render a chip from `kind` + `label` instead.
export type Badge = Readonly<{
  kind: "accessibility" | "international" | "express" | "regional" | "private_operator";
  symbol: string;
  label: string;
}>;

export type BadgeInput = Readonly<{
  wheelchairAccessible?: 0 | 1 | 2;
  international?: boolean;
  borderCountries?: ReadonlyArray<string>;
  trainNumber?: string;
}>;

export function buildBadges(input: BadgeInput): ReadonlyArray<Badge> {
  const out: Badge[] = [];

  if (input.wheelchairAccessible === 1) {
    out.push({ kind: "accessibility", symbol: "♿", label: "Wheelchair accessible" });
  }

  if (input.international && input.borderCountries && input.borderCountries.length > 0) {
    out.push({
      kind: "international",
      symbol: "⇄",
      label: `International · ${input.borderCountries.join(", ")}`,
    });
  }

  if (input.trainNumber) {
    const cat = trainCategory(input.trainNumber);
    if (cat === "Ex" || cat === "IC" || cat === "EC") {
      out.push({ kind: "express", symbol: "»", label: "Express" });
    } else if (cat === "RJ" || cat === "LE") {
      out.push({ kind: "private_operator", symbol: "»", label: "Private operator" });
    } else if (cat === "Os") {
      out.push({ kind: "regional", symbol: "·", label: "Regional (Os)" });
    } else if (cat === "R" || cat === "REX") {
      out.push({ kind: "regional", symbol: "·", label: `${cat} (regional fast)` });
    }
  }

  return out;
}
