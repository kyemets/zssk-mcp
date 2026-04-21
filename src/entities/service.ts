// Calendar representation: a weekly mask (Mon..Sun) plus a validity window, with
// per-date exceptions that override the mask (1=added, 2=removed per GTFS spec).
export type Service = Readonly<{
  serviceId: string;
  weekly: ReadonlyArray<boolean>;
  startDate: string;
  endDate: string;
  dateExceptions: ReadonlyMap<string, 1 | 2>;
}>;
