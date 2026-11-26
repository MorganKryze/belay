import { MAX_BODY_BYTES, MAX_CHANGES } from "./limits";

const encoder = new TextEncoder();
const bytes = (value: unknown) => encoder.encode(JSON.stringify(value)).length;

// The oldest entries whose request `{"account","cursor","changes"}`, as JSON.stringify writes it,
// fits both of the server's limits: at most `max` changes and MAX_BODY_BYTES bytes. At least one:
// a single change is bounded far below the limit by its own schema (a plan holds 16 KiB, a note
// 500 characters), so a queue always moves.
export function fitBatch<T>(
  entries: readonly T[],
  changeOf: (entry: T) => unknown,
  envelope: { account: string; cursor: string },
  max = MAX_CHANGES,
): T[] {
  let size = bytes({ ...envelope, changes: [] });
  const out: T[] = [];
  for (const entry of entries) {
    if (out.length === max) break;
    const next = size + bytes(changeOf(entry)) + (out.length > 0 ? 1 : 0);
    if (out.length > 0 && next > MAX_BODY_BYTES) break;
    size = next;
    out.push(entry);
  }
  return out;
}
