// GTFS time strings may legitimately exceed 24:00:00 (e.g. 25:30:00 for trips
// that cross midnight within the same service day). Keep them as strings so
// lexical ordering stays correct.
export type StopTime = Readonly<{
  tripId: string;
  stopId: string;
  stopSequence: number;
  arrivalTime: string;
  departureTime: string;
}>;
