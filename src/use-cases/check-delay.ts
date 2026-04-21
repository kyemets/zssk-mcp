export type CheckDelayInput = Readonly<{ trainNumber: string }>;

export type CheckDelayResult = Readonly<{
  status: "not_implemented";
  trainNumber: string;
  note: string;
}>;

// Stub body — the contract is exposed from v1 so clients can start depending
// on it before a real-time source (GTFS-RT) is wired up.
export function checkDelay(input: CheckDelayInput): CheckDelayResult {
  return {
    status: "not_implemented",
    trainNumber: input.trainNumber,
    note: "Real-time delays require a separate data source. Planned for v2.",
  };
}
