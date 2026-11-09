// The mark's one geometry, on a 100-unit grid: an open ring whose two ends are the feet of a
// mountain with a shoulder and a summit. Every drawing of the mark reads these numbers.
export const MARK_VIEWBOX = "0 0 100 100";
export const RING_D = "M28.6 78.8 A37 37 0 1 1 71.4 78.8";
export const MOUNTAIN_D = "M28.6 78.8 L39 58 L45 64 L56 44 L71.4 78.8";
// Both paths sit one unit lower, which centres the drawn mark on the grid.
export const MARK_SHIFT = { x: 0, y: 1 };
export const STROKE = 11;
// Below 24 px the strokes thicken so the ring, its opening and the summit stay apart.
export const STROKE_SMALL = 14;
// The logotype's A as a peak, in a 186.6 by 137.6 box at the capitals' height.
export const PEAK_D = "M0 137.6 L31 71 L45 83 L95 -3 L186 137.6 L138 137.6 L95 72.6 L50 137.6 Z";
// The app icon's tile sets the mark at 66 % of its side, centred.
export const TILE_MARK = { offset: 17, scale: 0.66 };
