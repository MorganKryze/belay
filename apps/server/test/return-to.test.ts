import { describe, expect, it } from "vitest";
import { safeReturnTo } from "../src/auth/return-to";

describe("safeReturnTo", () => {
  it.each([
    ["/settings", "/settings"],
    ["/a/b?x=1#h", "/a/b?x=1#h"],
    [undefined, "/"],
    ["", "/"],
    ["settings", "/"],
    ["//evil.example", "/"],
    ["/\\evil.example", "/"],
    ["https://evil.example", "/"],
    ["/%2F%2Fevil.example", "/%2F%2Fevil.example"],
  ])("%s → %s", (input, expected) => {
    expect(safeReturnTo(input)).toBe(expected);
  });
});
