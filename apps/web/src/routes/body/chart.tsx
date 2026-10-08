import { addDays, type ISODate } from "@belay/shared/body/dates";
import type { Weighing } from "@belay/shared/body/weighings";
import {
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  useId,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { formatKg, formatShortDay, formatWeekday } from "@/lib/format";

// Drawing units; the SVG scales to the card's width.
const W = 320;
const H = 170;
const PAD = { left: 28, right: 8, top: 8, bottom: 22 };
// A tap this close to a dot (in screen pixels) opens that day's weigh-in.
const HIT_PX = 22;

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

// Grey dots for the daily weigh-ins, an orange line for the 7-day average (D12, §8). Pointer,
// touch or arrow keys move a crosshair over the nearest day; its values are read out politely.
// The weeks list and the history below are the data table.
export function WeightChart({
  weighings,
  averages,
  from,
  to,
  summary,
  onSelect,
}: {
  weighings: readonly Weighing[];
  averages: readonly { date: ISODate; averageKg: number }[];
  from: ISODate;
  to: ISODate;
  summary: string;
  onSelect: (date: ISODate) => void;
}) {
  const { t, i18n } = useTranslation();
  const hintId = useId();
  const svg = useRef<SVGSVGElement>(null);
  const [active, setActive] = useState<ISODate | null>(null);

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

  // The day under a screen x, as a drawing x, and the nearest day that has something to show.
  const pointer = (clientX: number) => {
    const box = svg.current!.getBoundingClientRect();
    const scale = box.width > 0 ? W / box.width : 1;
    return { at: (clientX - box.left) * scale, scale };
  };
  const nearest = (at: number) =>
    days.reduce<ISODate | null>(
      (best, d) => (best === null || Math.abs(x(d) - at) < Math.abs(x(best) - at) ? d : best),
      null,
    );

  const onPointerMove = (e: PointerEvent<SVGSVGElement>) =>
    setActive(nearest(pointer(e.clientX).at));
  const onClick = (e: MouseEvent<SVGSVGElement>) => {
    const { at, scale } = pointer(e.clientX);
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
        {ticks.map((v) => (
          <g key={v}>
            <line x1={PAD.left} x2={W - 4} y1={y(v)} y2={y(v)} className="stroke-border" />
            <text
              x={PAD.left - 5}
              y={y(v) + 3.5}
              textAnchor="end"
              className="fill-muted-foreground text-[10px]"
            >
              {v}
            </text>
          </g>
        ))}
        {labels.map((d, i) => (
          <text
            key={i}
            x={x(d)}
            y={H - 4}
            textAnchor={i === 0 ? "start" : i === 2 ? "end" : "middle"}
            className="fill-muted-foreground text-[10px]"
          >
            {formatShortDay(d, i18n.language, to)}
          </text>
        ))}
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
        {weighings.map((w) => (
          <circle
            key={w.date}
            cx={x(w.date)}
            cy={y(w.weightKg)}
            r={w.date === active ? 5 : 3.2}
            strokeWidth={1.5}
            className="fill-chart-dot stroke-card"
          />
        ))}
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
