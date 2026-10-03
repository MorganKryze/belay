import { type IwfColor, iwfColor } from "@belay/shared/tools/plates";
import { useTranslation } from "react-i18next";
import { formatNumber } from "@/lib/format";

const FILL: Record<IwfColor | "grey", string> = {
  red: "fill-plate-red",
  blue: "fill-plate-blue",
  yellow: "fill-plate-yellow",
  green: "fill-plate-green",
  white: "fill-plate-white",
  grey: "fill-plate-grey",
};
const INK: Record<IwfColor | "grey", string> = {
  red: "fill-plate-ink-light",
  blue: "fill-plate-ink-light",
  green: "fill-plate-ink-light",
  yellow: "fill-plate-ink-dark",
  white: "fill-plate-ink-dark",
  grey: "fill-plate-ink-dark",
};

const PLATE_W = 15;
const GAP = 2;
const H = 104;
// Heavier plates draw taller, capped at the bar's full height.
const plateHeight = (kg: number) => Math.min(96, 20 + kg * 3.2);

// One side is drawn, mirrored for the other. Colour follows the IWF code; each plate also
// carries its weight in writing, so nothing depends on colour alone.
export function Barbell({ perSideKg, label }: { perSideKg: readonly number[]; label: string }) {
  const { i18n } = useTranslation();
  const side = perSideKg.length * (PLATE_W + GAP);
  const sleeve = Math.max(side + 10, 30);
  const shaft = 44;
  const collar = 5;
  const width = 2 * (sleeve + collar) + shaft;
  const mid = H / 2;
  const plates = (mirror: boolean) =>
    perSideKg.map((kg, i) => {
      const color = iwfColor(kg) ?? "grey";
      const h = plateHeight(kg);
      // Heaviest against the collar, lighter ones outwards.
      const left = sleeve - (i + 1) * PLATE_W - i * GAP;
      const x = mirror ? width - left - PLATE_W : left;
      return (
        <g key={`${mirror ? "r" : "l"}${i}`}>
          <rect
            x={x}
            y={mid - h / 2}
            width={PLATE_W}
            height={h}
            rx={4}
            className={`${FILL[color]} stroke-input`}
          />
          <text
            x={x + PLATE_W / 2}
            y={mid}
            transform={`rotate(-90 ${x + PLATE_W / 2} ${mid})`}
            textAnchor="middle"
            dominantBaseline="central"
            className={`${INK[color]} text-[9px] font-bold`}
          >
            {formatNumber(kg, i18n.language, { digits: 2 })}
          </text>
        </g>
      );
    });
  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`0 0 ${width} ${H}`}
      className="mx-auto h-[104px] max-w-full"
    >
      <rect x={0} y={mid - 5} width={sleeve} height={10} rx={2} className="fill-plate-grey" />
      <rect
        x={width - sleeve}
        y={mid - 5}
        width={sleeve}
        height={10}
        rx={2}
        className="fill-plate-grey"
      />
      <rect x={sleeve} y={mid - 11} width={collar} height={22} className="fill-muted-foreground" />
      <rect
        x={width - sleeve - collar}
        y={mid - 11}
        width={collar}
        height={22}
        className="fill-muted-foreground"
      />
      <rect
        x={sleeve + collar}
        y={mid - 3.5}
        width={shaft}
        height={7}
        className="fill-muted-foreground"
      />
      {plates(false)}
      {plates(true)}
    </svg>
  );
}
