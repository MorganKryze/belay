import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import i18n from "../i18n";
import { NumberStepper, type NumberStepperProps } from "./number-stepper";

afterEach(async () => {
  cleanup();
  await i18n.changeLanguage("en");
});

// A controlled stepper, as the pages use it, with a spy on every committed value.
function Harness(props: Partial<NumberStepperProps> & { initial?: number | null }) {
  const { initial = 100, onChange, ...rest } = props;
  const [value, setValue] = useState<number | null>(initial);
  return (
    <NumberStepper
      label="Load"
      unit="kg"
      min={20}
      max={300}
      step={2.5}
      {...rest}
      value={value}
      onChange={(v) => {
        onChange?.(v);
        setValue(v);
      }}
    />
  );
}

const input = () => screen.getByRole("textbox", { name: "Load" });

describe("NumberStepper", () => {
  it("labels the field and both buttons", () => {
    render(<Harness />);
    expect(input()).toBeTruthy();
    expect(screen.getByRole("button", { name: "Decrease Load" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Increase Load" })).toBeTruthy();
  });

  it("steps with the buttons and the arrow keys", () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Increase Load" }));
    expect(onChange).toHaveBeenLastCalledWith(102.5);
    fireEvent.keyDown(input(), { key: "ArrowDown" });
    fireEvent.keyDown(input(), { key: "ArrowDown" });
    expect(onChange).toHaveBeenLastCalledWith(97.5);
    expect((input() as HTMLInputElement).value).toBe("97.5");
  });

  it("stops at the bounds and disables the button there", () => {
    const onChange = vi.fn();
    render(<Harness initial={297.5} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Increase Load" }));
    expect(onChange).toHaveBeenLastCalledWith(300);
    expect(
      (screen.getByRole("button", { name: "Increase Load" }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("clamps a typed value to the bounds on blur", () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    fireEvent.change(input(), { target: { value: "999" } });
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.blur(input());
    expect(onChange).toHaveBeenLastCalledWith(300);
    expect((input() as HTMLInputElement).value).toBe("300");
  });

  it("restores the last value when the text is not a number", () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    fireEvent.change(input(), { target: { value: "abc" } });
    fireEvent.blur(input());
    expect(onChange).not.toHaveBeenCalled();
    expect((input() as HTMLInputElement).value).toBe("100");
  });

  it("reads and writes the French decimal comma", async () => {
    await i18n.changeLanguage("fr");
    const onChange = vi.fn();
    render(<Harness initial={72.5} onChange={onChange} label="Charge" />);
    const field = screen.getByRole("textbox", { name: "Charge" }) as HTMLInputElement;
    expect(field.value).toBe("72,5");
    fireEvent.change(field, { target: { value: "80,5" } });
    expect(onChange).toHaveBeenLastCalledWith(80.5);
  });

  it("lets an optional field be emptied", () => {
    const onChange = vi.fn();
    render(<Harness optional onChange={onChange} />);
    fireEvent.change(input(), { target: { value: "" } });
    fireEvent.blur(input());
    expect(onChange).toHaveBeenLastCalledWith(null);
    expect((input() as HTMLInputElement).value).toBe("");
  });

  it("ties an error message to the field", () => {
    render(<Harness error="Your waist must be larger than your neck." />);
    expect(input().getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByText("Your waist must be larger than your neck.").id).toBe(
      input().getAttribute("aria-describedby")?.split(" ").at(-1),
    );
  });
});
