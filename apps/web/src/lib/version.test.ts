import { describe, expect, it } from "vitest";
import { releaseUrl } from "./version";

describe("releaseUrl", () => {
  it("has no page for a build outside a release", () => {
    expect(releaseUrl("dev")).toBeNull();
  });
  it("points a release at its notes", () => {
    expect(releaseUrl("0.3.0-rc.2")).toBe(
      "https://github.com/MorganKryze/belay/releases/tag/v0.3.0-rc.2",
    );
  });
});
