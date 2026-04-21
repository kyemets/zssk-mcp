export type Route = Readonly<{
  routeId: string;
  agencyId: string;
  shortName: string;
  longName: string;
  type: string;
  // Six-hex RGB without leading `#`, or null when the feed omits it. ZSSK's
  // TATRAN / KRIVÁŇ lines do set these (e.g. "FF671F" for Ex-class), which
  // the SVG renderer picks up to keep each line visually distinct.
  color: string | null;
  textColor: string | null;
}>;
