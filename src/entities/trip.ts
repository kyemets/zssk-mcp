// GTFS wheelchair_accessible values per spec:
//   0 or empty = no info
//   1          = wheelchair accessible
//   2          = explicitly not accessible
export type WheelchairAccessibility = 0 | 1 | 2;

export type Trip = Readonly<{
  tripId: string;
  routeId: string;
  serviceId: string;
  headsign: string;
  shortName: string;
  directionId: string;
  wheelchairAccessible: WheelchairAccessibility;
}>;
