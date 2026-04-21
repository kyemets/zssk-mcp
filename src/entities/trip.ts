export type Trip = Readonly<{
  tripId: string;
  routeId: string;
  serviceId: string;
  headsign: string;
  shortName: string;
  directionId: string;
}>;
