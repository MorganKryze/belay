// The kit's surfaces as plain class strings. Nothing here has a side effect on import, so Accueil
// can use them without pulling in the grouped list and its links.

// A card that stands alone, as a session card: a soft shadow and a faint ring in light, a border
// in dark.
export const cardSurface = "rounded-card bg-card shadow-card dark:border dark:border-border";
// The card alone, for content that is not a list of rows and so takes no hairlines.
export const groupSurface =
  "overflow-hidden rounded-group bg-surface shadow-card dark:border dark:border-border";
export const groupCard = `divide-y divide-border ${groupSurface}`;
export const sectionLabel = "px-4 text-section text-muted-foreground";
