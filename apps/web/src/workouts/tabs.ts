// The segments of the Sessions tab, in the URL (?tab=) and remembered on the device.
export const WORKOUT_TABS = ["program", "exercises"] as const;
export type WorkoutTab = (typeof WORKOUT_TABS)[number];
export const isWorkoutTab = (v: unknown): v is WorkoutTab =>
  (WORKOUT_TABS as readonly unknown[]).includes(v);
