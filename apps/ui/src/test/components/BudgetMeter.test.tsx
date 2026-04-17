import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import BudgetMeter from "@/components/BudgetMeter";

describe("BudgetMeter", () => {
  it("shows `$spent / $cap` when a cap is set", () => {
    const { container } = render(<BudgetMeter spent={1.2} cap={10} />);
    // Both numbers render; order is spent first then cap.
    expect(screen.getByText("$1.20")).toBeInTheDocument();
    expect(screen.getByText("$10.00")).toBeInTheDocument();
    // Fill bar reflects the ratio as an inline width %.
    const fill = container.querySelector(".budget-meter-fill") as HTMLElement;
    expect(fill).not.toBeNull();
    expect(fill.style.width).toBe("12%");
  });

  it("falls back to `$spent today` when no cap is configured", () => {
    render(<BudgetMeter spent={0.42} cap={0} />);
    expect(screen.getByText("$0.42")).toBeInTheDocument();
    expect(screen.getByText("today")).toBeInTheDocument();
  });

  it("clamps fill width at 100% even when spend exceeds the cap", () => {
    const { container } = render(<BudgetMeter spent={15} cap={10} />);
    const fill = container.querySelector(".budget-meter-fill") as HTMLElement;
    expect(fill.style.width).toBe("100%");
  });

  it("applies a warn modifier once spend reaches 80% of the cap", () => {
    const { container } = render(<BudgetMeter spent={8} cap={10} />);
    expect(container.querySelector(".budget-meter--warn")).not.toBeNull();
    expect(container.querySelector(".budget-meter--over")).toBeNull();
  });

  it("applies an over modifier once spend reaches the cap", () => {
    const { container } = render(<BudgetMeter spent={10} cap={10} />);
    expect(container.querySelector(".budget-meter--over")).not.toBeNull();
  });

  it("drops decimals on amounts ≥ $100 to keep the readout compact", () => {
    render(<BudgetMeter spent={42.5} cap={250} />);
    // $42.50 keeps decimals because it's < $100; $250 drops them.
    expect(screen.getByText("$42.50")).toBeInTheDocument();
    expect(screen.getByText("$250")).toBeInTheDocument();
  });

  it("exposes a tooltip describing spent vs cap", () => {
    const { container } = render(<BudgetMeter spent={2} cap={10} />);
    const meter = container.querySelector(".budget-meter") as HTMLElement;
    expect(meter.title).toMatch(/\$2\.00 spent of \$10\.00/);
  });
});
