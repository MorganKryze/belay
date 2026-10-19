import { addDays, type ISODate } from "@belay/shared/body/dates";
import type { Weighing } from "@belay/shared/body/weighings";
import {
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { formatKg, formatShortDay, formatWeekday } from "@/lib/format";

// The drawing is as wide as the card, in screen pixels, so its text renders at its true size;
// 320 where nothing is laid out (unit tests). The right padding leaves room for the last average.
const FALLBACK_W = 320;
const H = 180;
const PAD = { left: 26, right: 34, top: 20, bottom: 24 };
// A tap this close to a dot (in screen pixels) opens that day's weigh-in.
const HIT_PX = 22;
// Rough width of an 11.5px semibold character, to keep the band's label inside the drawing.
const LABEL_EM = 6.4;
// Width of a 12px semibold character: a ceiling for Inter's widest letters, so a measured name is
// never narrower than the drawn one. Tests have no layout to measure text with.
const NAME_EM = 6.7;
// Free space kept between two names on the same level.
const NAME_GAP = 6;
// A name's tap box: its line of text, this tall above its baseline.
const NAME_BOX = 14;

const daysBetween = (a: ISODate, b: ISODate) =>
  Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

// Whole kilos, at most 6 lines: every kilo, or every 2, 5 or 10 on a wide range.
function yAxis(values: number[]) {
  const lo = Math.floor(Math.min(...values) - 0.5);
  const hi = Math.ceil(Math.max(...values) + 0.5);
  const step = [1, 2, 5, 10, 20, 50].find((s) => (hi - lo) / s <= 5) ?? 100;
  const ticks: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) ticks.push(v);
  return { lo, hi, ticks };
}

// A mark on the chart: a dashed line on its day, with its name under the curve.
export type ChartMark = { id: string; date: ISODate; label: string };

// Where each annotation's name goes: at the bottom of the plot when it clears the names before it,
// else in the strip above the plot (never over the dots), else nowhere (its dashed line stays).
export type PlacedName = {
  id: string;
  level: "bottom" | "top" | null;
  x0: number;
  x1: number;
  anchor: "start" | "end";
};
const overlaps = (a: { x0: number; x1: number }, b: { x0: number; x1: number }) =>
  a.x0 < b.x1 + NAME_GAP && b.x0 < a.x1 + NAME_GAP;
export function placeNames(
  names: readonly { id: string; x: number; label: string }[],
  bounds: { left: number; right: number },
  reserved: readonly { x0: number; x1: number }[],
): PlacedName[] {
  const bottom: PlacedName[] = [];
  const top: PlacedName[] = [];
  return names.map(({ id, x, label }) => {
    const width = label.length * NAME_EM;
    // Near the right edge the name ends at its line, on the line's left, unless that crosses the
    // plot's left edge.
    const end = x > bounds.right - 60 && x - 4 - width >= bounds.left;
    const box = end ? { x0: x - 4 - width, x1: x - 4 } : { x0: x + 4, x1: x + 4 + width };
    const placed: PlacedName = { id, level: null, ...box, anchor: end ? "end" : "start" };
    if (!bottom.some((b) => overlaps(b, box))) {
      placed.level = "bottom";
      bottom.push(placed);
    } else if (![...top, ...reserved].some((b) => overlaps(b, box))) {
      placed.level = "top";
      top.push(placed);
    }
    return placed;
  });
}

// Grey dots for the daily weigh-ins, an orange line for the 7-day average (D12, §8), and, in
// context only (D5): the first 14 days of each creatine course as a band, the annotations as
// named dashed lines. Pointer, touch or arrow keys move a crosshair over the nearest day; its
// values are read out politely. The weeks list and the history below are the data table, and
// the weeks' pills open the annotations from the keyboard.
export function WeightChart({
  weighings,
  averages,
  from,
  to,
  summary,
  onSelect,
  bands = [],
  bandLabel = "",
  marks = [],
  onSelectMark = () => {},
}: {
  weighings: readonly Weighing[];
  averages: readonly { date: ISODate; averageKg: number }[];
  from: ISODate;
  to: ISODate;
  summary: string;
  onSelect: (date: ISODate) => void;
  bands?: readonly { start: ISODate; end: ISODate }[];
  bandLabel?: string;
  marks?: readonly ChartMark[];
  onSelectMark?: (id: string) => void;
}) {
  const { t, i18n } = useTranslation();
  const hintId = useId();
  const svg = useRef<SVGSVGElement>(null);
  const [active, setActive] = useState<ISODate | null>(null);
  const [W, setW] = useState(FALLBACK_W);

  // Measured before paint, then followed as the card resizes, where the platform can tell.
  useLayoutEffect(() => {
    const el = svg.current!;
    const measure = () => setW(el.clientWidth || FALLBACK_W);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const span = Math.max(1, daysBetween(from, to));
  const x = (d: ISODate) => PAD.left + ((W - PAD.left - PAD.right) * daysBetween(from, d)) / span;
  const { lo, hi, ticks } = yAxis([
    ...weighings.map((w) => w.weightKg),
    ...averages.map((a) => a.averageKg),
  ]);
  const y = (kg: number) => PAD.top + ((H - PAD.top - PAD.bottom) * (hi - kg)) / (hi - lo);

  const byDate = new Map(weighings.map((w) => [w.date, w.weightKg]));
  const avgByDate = new Map(averages.map((a) => [a.date, a.averageKg]));
  const days = [...new Set([...byDate.keys(), ...avgByDate.keys()])].sort();

  // The line breaks where a day has no average, rather than bridging the gap.
  const segments: { date: ISODate; averageKg: number }[][] = [];
  for (const a of averages) {
    const last = segments.at(-1);
    if (last && addDays(last.at(-1)!.date, 1) === a.date) last.push(a);
    else segments.push([a]);
  }

  // The day under a screen point, as drawing units, and the nearest day that has something to show.
  const pointer = (clientX: number, clientY = 0) => {
    const box = svg.current!.getBoundingClientRect();
    const scale = box.width > 0 ? W / box.width : 1;
    return { at: (clientX - box.left) * scale, y: (clientY - box.top) * scale, scale };
  };
  // Inside the drawing, clipped to the period shown.
  const clip = (d: ISODate) => (d < from ? from : d > to ? to : d);
  const shownBands = bands.filter((b) => b.end >= from && b.start <= to);
  const shownMarks = marks.filter((m) => m.date >= from && m.date <= to);
  // The band's label sits in the strip above the plot, always written, kept inside the drawing.
  const bandLabels = shownBands.map((b) => {
    const x0 = Math.max(
      PAD.left,
      Math.min(x(clip(b.start)), W - PAD.right - bandLabel.length * LABEL_EM),
    );
    return { x0, x1: x0 + bandLabel.length * LABEL_EM };
  });
  // Each name's baseline: just above the dates, or in the strip above the plot.
  const baseline = { bottom: H - PAD.bottom - 6, top: PAD.top - 3 };
  const names = placeNames(
    shownMarks.map((m) => ({ id: m.id, x: x(m.date), label: m.label })),
    { left: PAD.left, right: W - PAD.right },
    bandLabels,
  );
  const nearest = (at: number) =>
    days.reduce<ISODate | null>(
      (best, d) => (best === null || Math.abs(x(d) - at) < Math.abs(x(best) - at) ? d : best),
      null,
    );

  const onPointerMove = (e: PointerEvent<SVGSVGElement>) =>
    setActive(nearest(pointer(e.clientX).at));
  const onClick = (e: MouseEvent<SVGSVGElement>) => {
    const { at, y, scale } = pointer(e.clientX, e.clientY);
    // A drawn name opens from its box, widened to its dashed line.
    const name = names.find((n, i) => {
      if (n.level === null) return false;
      const line = x(shownMarks[i]!.date);
      const b = baseline[n.level];
      return (
        at >= Math.min(n.x0, line) && at <= Math.max(n.x1, line) && y >= b - NAME_BOX && y <= b
      );
    });
    if (name) return onSelectMark(name.id);
    const day = nearest(at);
    setActive(day);
    if (day && byDate.has(day) && Math.abs(x(day) - at) <= HIT_PX * scale) onSelect(day);
  };
  const onKeyDown = (e: KeyboardEvent<SVGSVGElement>) => {
    const i = active ? days.indexOf(active) : days.length;
    const move = { ArrowLeft: -1, ArrowRight: 1, Home: -Infinity, End: Infinity }[e.key];
    if (move !== undefined) {
      e.preventDefault();
      setActive(days[Math.min(days.length - 1, Math.max(0, i + move))] ?? null);
    } else if (e.key === "Enter" && active && byDate.has(active)) {
      // Without this, the Enter keypress lands on the sheet's first button and closes it.
      e.preventDefault();
      onSelect(active);
    } else if (e.key === "Escape") {
      setActive(null);
    }
  };

  const kg = (v: number) => formatKg(v, i18n.language);
  const activeKg = active ? byDate.get(active) : undefined;
  const activeAvg = active ? avgByDate.get(active) : undefined;
  const labels = [from, addDays(from, Math.round(span / 2)), to];
  // The last 7-day average of the period, written at the end of its line.
  const last = averages.at(-1);
  // Smaller dots on longer periods, so they never cover the line.
  const dotR = span <= 31 ? 2.6 : span <= 91 ? 2 : 1.6;

  return (
    <div className="relative">
      <svg
        ref={svg}
        role="img"
        aria-label={summary}
        aria-describedby={hintId}
        tabIndex={0}
        viewBox={`0 0 ${W} ${H}`}
        className="block w-full touch-pan-y overflow-visible"
        onPointerMove={onPointerMove}
        onPointerLeave={(e) => e.pointerType === "mouse" && setActive(null)}
        onClick={onClick}
        onKeyDown={onKeyDown}
        onFocus={() => setActive((a) => a ?? days.at(-1) ?? null)}
        onBlur={() => setActive(null)}
      >
        {shownBands.map((b, i) => {
          const left = x(clip(b.start));
          // The band covers its last day whole: it ends where the next day starts.
          const right = Math.min(W - PAD.right, x(clip(b.end)) + (W - PAD.left - PAD.right) / span);
          return (
            <g key={b.start}>
              <rect
                x={left}
                y={PAD.top - 14}
                width={Math.max(0, right - left)}
                height={H - PAD.bottom - PAD.top + 14}
                className="fill-primary-soft"
              />
              {/* In the strip above the plot, kept inside it: never over the curve. */}
              <text
                data-slot="band-label"
                x={bandLabels[i]!.x0}
                y={baseline.top}
                className="fill-primary-ink text-[11.5px] font-semibold"
              >
                {bandLabel}
              </text>
            </g>
          );
        })}
        {ticks.map((v) => (
          <g key={v}>
            <line x1={PAD.left} x2={W - 4} y1={y(v)} y2={y(v)} className="stroke-border" />
            <text
              x={PAD.left - 6}
              y={y(v) + 4}
              textAnchor="end"
              className="fill-muted-foreground text-xs tabular-nums"
            >
              {v}
            </text>
          </g>
        ))}
        {labels.map((d, i) => (
          <text
            key={i}
            x={x(d)}
            y={H - 6}
            textAnchor={i === 0 ? "start" : i === 2 ? "end" : "middle"}
            className="fill-muted-foreground text-xs tabular-nums"
          >
            {formatShortDay(d, i18n.language, to)}
          </text>
        ))}
        {shownMarks.map((m, i) => {
          const name = names[i]!;
          return (
            <g key={m.id}>
              <line
                x1={x(m.date)}
                x2={x(m.date)}
                y1={PAD.top}
                y2={H - PAD.bottom}
                strokeDasharray="2 3"
                className="stroke-muted-foreground"
              />
              {name.level && (
                <text
                  data-level={name.level}
                  x={name.anchor === "end" ? name.x1 : name.x0}
                  y={baseline[name.level]}
                  textAnchor={name.anchor}
                  className="fill-foreground stroke-card text-xs font-semibold [paint-order:stroke] [stroke-width:3px]"
                >
                  {m.label}
                </text>
              )}
            </g>
          );
        })}
        {active && (
          <line
            x1={x(active)}
            x2={x(active)}
            y1={PAD.top - 2}
            y2={H - PAD.bottom}
            strokeDasharray="3 3"
            className="stroke-foreground opacity-50"
          />
        )}
        {weighings.map((w) =>
          w.date === active ? (
            <circle
              key={w.date}
              cx={x(w.date)}
              cy={y(w.weightKg)}
              r={5}
              strokeWidth={1.5}
              className="fill-chart-dot stroke-card"
            />
          ) : (
            <circle
              key={w.date}
              cx={x(w.date)}
              cy={y(w.weightKg)}
              r={dotR}
              className="fill-chart-dot"
            />
          ),
        )}
        {segments.map((seg) => (
          <polyline
            key={seg[0]!.date}
            points={seg.map((a) => `${x(a.date)},${y(a.averageKg)}`).join(" ")}
            fill="none"
            strokeWidth={2.5}
            strokeLinejoin="round"
            strokeLinecap="round"
            className="stroke-chart-line"
          />
        ))}
        {last && (
          <>
            <circle
              cx={x(last.date)}
              cy={y(last.averageKg)}
              r={4}
              strokeWidth={2}
              className="fill-chart-line stroke-card"
            />
            <text
              data-slot="last-average"
              x={x(last.date) + 7}
              y={y(last.averageKg) + 4}
              className="fill-chart-line text-xs font-bold tabular-nums"
            >
              {kg(last.averageKg)}
            </text>
          </>
        )}
        {active && activeAvg !== undefined && (
          <circle
            cx={x(active)}
            cy={y(activeAvg)}
            r={4.5}
            strokeWidth={2}
            className="fill-chart-line stroke-card"
          />
        )}
      </svg>
      <p id={hintId} className="sr-only">
        {t("chart.hint")}
      </p>
      {/* Mounted for good: the crosshair's day is read out as it moves. */}
      <div aria-live="polite" className="pointer-events-none absolute inset-x-0 top-0">
        {active && (
          <div
            className="absolute top-0 w-max max-w-[60%] -translate-x-1/2 rounded-chip bg-foreground px-2.5 py-1.5 text-xs leading-snug text-background shadow-md"
            style={{ left: `${Math.min(80, Math.max(20, (x(active) / W) * 100))}%` }}
          >
            <span className="block">{formatWeekday(active, i18n.language, to)}</span>
            {activeKg !== undefined && (
              <span className="block">{t("chart.weighIn", { value: kg(activeKg) })}</span>
            )}
            {activeAvg !== undefined && (
              <span className="block">{t("chart.movingAverage", { value: kg(activeAvg) })}</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
