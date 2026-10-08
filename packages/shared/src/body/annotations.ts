// A mark on the weight chart: a deload week, a diet break, or a free note.
export type AnnotationKind = "deload" | "diet_break" | "note";
export const ANNOTATION_KINDS: readonly AnnotationKind[] = ["deload", "diet_break", "note"];
export const ANNOTATION_LABEL_MAX = 80;

// Optional text, 80 characters at most, on one line.
export const isAnnotationLabel = (label: string | null) =>
  label === null || (label.length <= ANNOTATION_LABEL_MAX && !/[\r\n]/.test(label));
