import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { preference } from "./preference";

beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());

it("reads the default unless storage holds the other choice", () => {
  const [read, set] = preference("t.key", "a", "b");
  expect(read()).toBe("a");
  localStorage.setItem("t.key", "junk");
  expect(read()).toBe("a");
  set("b");
  expect(localStorage.getItem("t.key")).toBe("b");
  expect(read()).toBe("b");
});

it("keeps the choice in memory when storage refuses", () => {
  const [read, set] = preference("t.key", "a", "b");
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
    throw new Error("denied");
  });
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("denied");
  });
  expect(read()).toBe("a");
  set("b");
  expect(read()).toBe("b");
});

it("reads any of several other choices", () => {
  const [read, set] = preference("t.key", "a", "b", "c");
  set("c");
  expect(read()).toBe("c");
  set("b");
  expect(read()).toBe("b");
  localStorage.setItem("t.key", "d");
  expect(read()).toBe("a");
});
