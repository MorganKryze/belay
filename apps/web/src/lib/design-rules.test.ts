import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { arbitraryScale, rawColours, sourceFiles } from "@/test/design-rules";

describe("design rules", () => {
  it("no component code carries a raw colour", () => {
    const files = sourceFiles();
    expect(files.length).toBeGreaterThan(20);
    const found = files.flatMap((file) =>
      rawColours(readFileSync(file, "utf8")).map((colour) => `${file}: ${colour}`),
    );
    expect(found).toEqual([]);
  });

  it("finds hex, functional and palette colours", () => {
    expect(
      rawColours(
        'a = "#facc15"; b = "#fff"; c = "rgba(0, 0, 0, 0.5)"; d = "hsl(10 20% 30%)"; e = "oklch(0.7 0.1 40)"; f = "bg-white text-red-600"',
      ),
    ).toEqual([
      "#facc15",
      "#fff",
      "rgba(0, 0, 0, 0.5)",
      "hsl(10 20% 30%)",
      "oklch(0.7 0.1 40)",
      "bg-white",
      "text-red-600",
    ]);
  });

  it("leaves tokens alone", () => {
    expect(
      rawColours('className="bg-primary text-muted-foreground" fill="var(--hold-red)"'),
    ).toEqual([]);
  });

  it("finds arbitrary sizes outside the scales", () => {
    expect(
      arbitraryScale(
        'className="text-[15px] rounded-[7px] leading-[1.4] tracking-[-0.02em] rounded-[calc(var(--radius-card)-4px)] text-[var(--x)]"',
      ),
    ).toEqual(["text-[15px]", "rounded-[7px]", "leading-[1.4]", "tracking-[-0.02em]"]);
  });
});
