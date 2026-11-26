import { describe, expect, it } from "vitest";
import { fitBatch } from "./batch";
import { MAX_BODY_BYTES, MAX_CHANGES } from "./limits";

const envelope = { account: "01a2186a-db17-768d-9240-cf576e59974e", cursor: "123" };
const body = (changes: unknown[]) =>
  new TextEncoder().encode(JSON.stringify({ ...envelope, changes })).length;
const note = (text: string) => ({ kind: "workout", field: "note", value: text });
const id = <T>(x: T) => x;

describe("fitBatch", () => {
  it("keeps every change of a small queue, up to the count limit", () => {
    const queue = Array.from({ length: MAX_CHANGES + 20 }, (_, i) => note(`n${i}`));
    expect(fitBatch(queue, id, envelope)).toEqual(queue.slice(0, MAX_CHANGES));
    expect(fitBatch(queue, id, envelope, 3)).toEqual(queue.slice(0, 3));
  });

  it("cuts where the next change would pass the byte limit, and a body at the limit is kept", () => {
    const big = note("x".repeat(20_000));
    const queue = Array.from({ length: 40 }, () => big);
    const kept = fitBatch(queue, id, envelope);
    expect(body(kept)).toBeLessThanOrEqual(MAX_BODY_BYTES);
    expect(body([...kept, big])).toBeGreaterThan(MAX_BODY_BYTES);
    // Exactly at the limit: the last change is padded to land on the last byte.
    const head = kept.slice(0, -1);
    const room = MAX_BODY_BYTES - body([...head, note("")]);
    const exact = [...head, note("y".repeat(room))];
    expect(body(exact)).toBe(MAX_BODY_BYTES);
    expect(fitBatch([...exact, note("z")], id, envelope)).toEqual(exact);
    // One byte over, the comma before the last change included: that change waits.
    const over = [...head, note("y".repeat(room + 1))];
    expect(body(over)).toBe(MAX_BODY_BYTES + 1);
    expect(fitBatch(over, id, envelope)).toEqual(head);
  });

  it("counts bytes, not characters", () => {
    const wide = note("é".repeat(15_000)); // 2 bytes each in UTF-8
    const kept = fitBatch(
      Array.from({ length: 20 }, () => wide),
      id,
      envelope,
    );
    expect(kept.length).toBe(
      Math.floor((MAX_BODY_BYTES - body([])) / (body([wide]) - body([]) + 1)),
    );
    expect(body(kept)).toBeLessThanOrEqual(MAX_BODY_BYTES);
  });

  it("always sends the oldest change, in order, and never an empty batch for a queue", () => {
    const queue = [note("a"), note("b")];
    expect(fitBatch(queue, id, envelope, 1)).toEqual([queue[0]]);
    expect(fitBatch([], id, envelope)).toEqual([]);
  });
});
