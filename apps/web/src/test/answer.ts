import type { SyncResponse } from "@belay/shared/sync/schema";

// A server answer with nothing in it but what a test sets.
export const answer = (patch: Partial<SyncResponse> = {}): SyncResponse => ({
  cursor: "1",
  weights: [],
  measures: [],
  intake: [],
  supplements: [],
  supplementLogs: [],
  annotations: [],
  workouts: [],
  sets: [],
  target: null,
  profile: null,
  rejected: [],
  hasMore: false,
  ...patch,
});
