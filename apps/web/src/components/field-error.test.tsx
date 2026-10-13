import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { expectTokensOnly } from "@/test/design-rules";
import { FieldError } from "./field-error";

afterEach(cleanup);

describe("FieldError", () => {
  it("reads the error as an alert with its icon, never red", () => {
    render(<FieldError id="waist-error">Your waist must be larger than your neck.</FieldError>);
    const alert = screen.getByRole("alert");
    expect(alert.id).toBe("waist-error");
    expect(alert.textContent).toBe("Your waist must be larger than your neck.");
    expect(alert.className).toContain("text-foreground");
    expect(alert.className).toContain("text-secondary");
    const icon = alert.querySelector("svg")!;
    expect(icon.getAttribute("aria-hidden")).toBe("true");
    expect(icon.getAttribute("class")).toContain("size-4");
    expect(icon.getAttribute("class")).toContain("text-primary-ink");
    expect(alert.outerHTML).not.toMatch(/destructive|red/);
    expectTokensOnly("components/field-error.tsx");
  });
});
