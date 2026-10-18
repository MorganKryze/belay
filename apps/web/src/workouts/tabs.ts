import { starterProgram } from "@belay/shared/training/program";

// The segments of the Sessions tab, in the URL (?tab=) and remembered on the device.
export const WORKOUT_TABS = ["history", "program", "exercises"] as const;
export type WorkoutTab = (typeof WORKOUT_TABS)[number];
export const isWorkoutTab = (v: unknown): v is WorkoutTab =>
  (WORKOUT_TABS as readonly unknown[]).includes(v);

// The sessions opened with See on the Programme, in the URL (?see=B,C), so Back from one of their
// exercises finds them open. Known codes only, in the program's order, once each.
export function parseSee(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const asked = value.split(",");
  const codes = starterProgram.map((s) => s.code).filter((code) => asked.includes(code));
  return codes.length > 0 ? codes.join(",") : undefined;
}

export const seeList = (see: string | undefined): string[] => (see ? see.split(",") : []);

export function toggleSee(
  see: string | undefined,
  code: string,
  open: boolean,
): string | undefined {
  const others = seeList(see).filter((c) => c !== code);
  return parseSee((open ? [...others, code] : others).join(","));
}
