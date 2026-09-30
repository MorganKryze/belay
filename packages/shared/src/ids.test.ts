import { describe, expect, it } from "vitest";
import { newId } from "./ids";

describe("newId", () => {
  it("returns a version 7 UUID", () => {
    expect(newId()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it("sorts in creation order, even within the same millisecond", () => {
    const ids = Array.from({ length: 1000 }, newId);
    expect([...ids].sort()).toEqual(ids);
  });
});
