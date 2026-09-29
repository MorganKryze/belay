import { v7 } from "uuid";

export type ID = string;

// UUID v7: time-ordered, generated offline on any device, safe as a sync key.
export const newId = (): ID => v7();
