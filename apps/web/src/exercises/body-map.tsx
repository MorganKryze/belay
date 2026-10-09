import type { Muscle } from "@belay/shared/exercises/muscles";
import type { CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import { BACK, type BodyPart, FRONT } from "./body-paths";

export type View = "front" | "back";
// One outline of the figure and the muscle it draws (null: drawn at rest, never coloured).
export type Shape = { d: string; muscle: Muscle | null; clip?: "inner" | "outer" };

// The outlines' own names; the deltoid and "upper-back" are split below.
const SLUGS: Readonly<Record<string, Muscle>> = {
  chest: "chest",
  triceps: "triceps",
  biceps: "biceps",
  trapezius: "upper_back",
  "lower-back": "lower_back",
  forearm: "forearms",
  abs: "abs",
  obliques: "abs",
  quadriceps: "quads",
  gluteal: "glutes",
  adductors: "adductors",
  hamstring: "hamstrings",
  calves: "calves",
};
// The latissimus is drawn as part of "upper-back" on the back view: its second outline on the
// left, its third on the right (bodyBack.js of 3.2.0, three outlines a side; a test counts them).
export const LATS = { left: 1, right: 2 } as const;
// The deltoid is cut vertically where its outer 40 % begins (x measured on the outlines): the
// outer part is the side head; the inner part the front head (front view) or the rear head (back).
export const DELTOID_CUT = { front: { left: 228, right: 500 }, back: { left: 941, right: 1226 } };
export const VIEW_BOX = { front: "48 90 632 1256", back: "768 90 632 1256" } as const;
const GAP = 5; // a hairline between the two heads

export function shapesOf(view: View): Shape[] {
  const parts: readonly BodyPart[] = view === "front" ? FRONT : BACK;
  return parts.flatMap((p) =>
    (["common", "left", "right"] as const).flatMap((side) =>
      p[side].flatMap((d, i): Shape[] => {
        if (p.slug === "deltoids")
          return [
            { d, muscle: view === "front" ? "front_delts" : "rear_delts", clip: "inner" },
            { d, muscle: "side_delts", clip: "outer" },
          ];
        if (p.slug === "upper-back")
          return [{ d, muscle: side !== "common" && LATS[side] === i ? "lats" : "upper_back" }];
        return [{ d, muscle: SLUGS[p.slug] ?? null }];
      }),
    ),
  );
}

// Every outline reads its colour from a variable of its muscle, set on the <use> that draws the
// figure: one copy of the outlines in the page, any number of figures coloured differently.
export function muscleColors(primary: readonly Muscle[], secondary: readonly Muscle[]) {
  const vars: Record<string, string> = {};
  for (const m of secondary) vars[`--m-${m}`] = "var(--muscle-secondary)";
  for (const m of primary) vars[`--m-${m}`] = "var(--muscle-primary)";
  return vars as CSSProperties;
}

const fill = (muscle: Muscle | null) =>
  muscle ? `var(--m-${muscle}, var(--muscle-rest))` : "var(--muscle-rest)";

// The outlines, once per page that shows figures, out of sight and out of the accessibility tree.
export function BodySymbols() {
  return (
    <svg aria-hidden width="0" height="0" className="absolute" focusable="false">
      <defs>
        {(["front", "back"] as const).map((view) => {
          const cut = DELTOID_CUT[view];
          return (
            <g key={view} id={`body-${view}`}>
              <clipPath id={`body-${view}-outer`}>
                <rect x="0" y="0" width={cut.left - GAP} height="2000" />
                <rect x={cut.right + GAP} y="0" width="2000" height="2000" />
              </clipPath>
              <clipPath id={`body-${view}-inner`}>
                <rect
                  x={cut.left + GAP}
                  y="0"
                  width={cut.right - cut.left - 2 * GAP}
                  height="2000"
                />
              </clipPath>
              {shapesOf(view).map((s, i) => (
                <path
                  key={i}
                  d={s.d}
                  fill={fill(s.muscle)}
                  clipPath={s.clip ? `url(#body-${view}-${s.clip})` : undefined}
                />
              ))}
            </g>
          );
        })}
      </defs>
    </svg>
  );
}

function Figure({
  view,
  viewBox = VIEW_BOX[view],
  colors,
  className,
}: {
  view: View;
  viewBox?: string;
  colors: CSSProperties;
  className?: string;
}) {
  return (
    <svg aria-hidden viewBox={viewBox} className={className} focusable="false">
      <use href={`#body-${view}`} style={colors} />
    </svg>
  );
}

const BACK_FIRST: ReadonlySet<Muscle> = new Set([
  "lats",
  "upper_back",
  "rear_delts",
  "lower_back",
  "triceps",
  "glutes",
  "hamstrings",
  "calves",
]);
const LOWER: ReadonlySet<Muscle> = new Set([
  "quads",
  "glutes",
  "adductors",
  "hamstrings",
  "calves",
]);

// The 44 px thumbnail of a list row: the view and the part of the body where the primary muscle is.
export function thumbnailOf(primary: Muscle): { view: View; viewBox: string } {
  const view: View = BACK_FIRST.has(primary) ? "back" : "front";
  const y = primary === "glutes" || primary === "lower_back" ? 480 : LOWER.has(primary) ? 680 : 230;
  return { view, viewBox: `${view === "back" ? 864 : 144} ${y} 440 440` };
}

export function BodyThumb({ primary, secondary }: { primary: Muscle; secondary: Muscle[] }) {
  const { view, viewBox } = thumbnailOf(primary);
  return (
    <Figure
      view={view}
      viewBox={viewBox}
      colors={muscleColors([primary], secondary)}
      className="size-11 shrink-0 rounded-[10px] bg-track"
    />
  );
}

// Front and back, the primary muscles full, the secondary ones lighter, both always named in
// words next to it (colour never carries the meaning alone).
export function BodyMap({ primary, secondary }: { primary: Muscle[]; secondary: Muscle[] }) {
  const { t } = useTranslation();
  const names = (ms: Muscle[]) => ms.map((m) => t(`library.muscles.${m}`)).join(", ");
  const label =
    secondary.length > 0
      ? t("library.figure", { primary: names(primary), secondary: names(secondary) })
      : t("library.figureAlone", { primary: names(primary) });
  const colors = muscleColors(primary, secondary);
  return (
    <div className="flex flex-col gap-3">
      <div role="img" aria-label={label} className="flex justify-center gap-6">
        {(["front", "back"] as const).map((view) => (
          <figure key={view} className="flex flex-col items-center gap-1">
            <Figure view={view} colors={colors} className="h-56 w-auto" />
            <figcaption aria-hidden className="text-xs text-muted-foreground">
              {t(`library.views.${view}`)}
            </figcaption>
          </figure>
        ))}
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
        <dt className="flex items-center gap-2 text-muted-foreground">
          <i aria-hidden className="size-2.5 rounded-[3px] bg-muscle-primary" />
          {t("library.primary")}
        </dt>
        <dd className="font-semibold">{names(primary)}</dd>
        <dt className="flex items-center gap-2 text-muted-foreground">
          <i aria-hidden className="size-2.5 rounded-[3px] bg-muscle-secondary" />
          {t("library.secondary")}
        </dt>
        <dd className="font-semibold">{secondary.length > 0 ? names(secondary) : "—"}</dd>
      </dl>
    </div>
  );
}
