import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ResultCard, ResultFigure } from "./result-card";

afterEach(cleanup);

const figure = (container: HTMLElement) =>
  container.querySelector<HTMLElement>("[data-slot='result-figure']")!;

describe("ResultCard", () => {
  it("names the card by its label and keeps it a polite live region before any result", () => {
    render(<ResultCard label="Your BMI">{null}</ResultCard>);
    const card = screen.getByRole("region", { name: "Your BMI" });
    expect(card.getAttribute("aria-live")).toBe("polite");
    expect(card.getAttribute("aria-atomic")).toBe("true");
    expect(card.textContent).toBe("Your BMI");
  });
});

describe("ResultFigure", () => {
  it("a large figure writes its unit after a no-break space", () => {
    const { container } = render(<ResultFigure value="116.5" unit="kg" />);
    const el = figure(container);
    expect(el.textContent).toBe("116.5 kg");
    expect(el.classList).toContain("text-figure");
    expect(el.classList).toContain("text-foreground");
    const unit = el.querySelector("span")!;
    expect(unit.textContent).toBe(" kg");
    expect(unit.classList).toContain("text-[17px]");
  });

  it("a medium figure, and a muted one", () => {
    const { container } = render(<ResultFigure value="2 450" unit="kcal" size="medium" muted />);
    const el = figure(container);
    expect(el.classList).toContain("text-figure-md");
    expect(el.classList).toContain("text-muted-foreground");
    expect(el.querySelector("span")!.classList).toContain("text-[14px]");
  });

  it("a percent follows the figure with the space it is given", () => {
    const { container, rerender } = render(<ResultFigure value="18,4" unit="%" unitSpace={" "} />);
    expect(figure(container).textContent).toBe("18,4 %");
    rerender(<ResultFigure value="18.4" unit="%" unitSpace="" />);
    expect(figure(container).textContent).toBe("18.4%");
    rerender(<ResultFigure value="24.2" />);
    expect(figure(container).textContent).toBe("24.2");
    expect(figure(container).querySelector("span")).toBeNull();
  });
});
