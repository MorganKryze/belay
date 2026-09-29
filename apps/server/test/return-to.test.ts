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
    // dot segments normalise to "//host": the output is validated, not just the input
    ["/.//evil.example", "/"],
    ["/a/..//evil.example", "/"],
    ["/%2e//evil.example", "/"],
    ["/.\\\\evil.example", "/"],
    // the URL parser strips the tab and then chokes on "//[": it must not throw
    ["/\t/[", "/"],
  ])("%s → %s", (input, expected) => {
    expect(safeReturnTo(input)).toBe(expected);
  });

  it("caps the length: 2048 characters pass, one more falls back to /", () => {
    const fits = "/" + "a".repeat(2047);
    expect(safeReturnTo(fits)).toBe(fits);
    expect(safeReturnTo(fits + "a")).toBe("/");
    // 1501 characters going in, 2501 coming out ("a b" becomes "a%20b")
    expect(safeReturnTo("/" + "a b".repeat(500))).toBe("/");
  });
});
