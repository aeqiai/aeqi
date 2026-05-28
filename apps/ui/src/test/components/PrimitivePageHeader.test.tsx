import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PrimitivePageHeader } from "@/components/ui";

describe("PrimitivePageHeader", () => {
  it("uses a plain title for page identity by default", () => {
    render(<PrimitivePageHeader title="Agents" aria-label="Agent controls" />);

    const header = screen.getByLabelText("Agent controls");
    expect(header).toHaveAttribute("data-title-variant", "plain");
    expect(screen.getByRole("heading", { name: "Agents" })).toBeInTheDocument();
  });

  it("keeps the chip variant available for selected object or scope context", () => {
    render(
      <PrimitivePageHeader title="Chief of Staff" titleVariant="chip" aria-label="Agent context" />,
    );

    expect(screen.getByLabelText("Agent context")).toHaveAttribute("data-title-variant", "chip");
  });
});
