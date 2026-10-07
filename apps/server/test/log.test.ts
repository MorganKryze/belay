import { DrizzleQueryError } from "drizzle-orm/errors";
import { describe, expect, it } from "vitest";
import { describeError } from "../src/log";

describe("describeError", () => {
  it("prints a database error without its query or parameters", () => {
    const cause = Object.assign(new Error("duplicate key"), { code: "23505" });
    const err = new DrizzleQueryError(
      "insert into body_metrics values ($1, $2)",
      ["a-person-id", "81.5"],
      cause,
    );
    const text = describeError(err);
    expect(text).toBe("DrizzleQueryError (code 23505)");
    expect(text).not.toContain("81.5");
    expect(text).not.toContain("body_metrics");
  });

  it("prints any other error as name, message and code", () => {
    expect(describeError(Object.assign(new TypeError("bad"), { code: "E1" }))).toBe(
      "TypeError: bad (code E1)",
    );
    expect(describeError("nope")).toBe("unknown error");
  });
});
