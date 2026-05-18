import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Loading } from "@/components/ui/Loading";

describe("Loading", () => {
  it("exposes role=status for screen readers", () => {
    render(<Loading label="Loading agents" />);
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("uses the label as the accessible name", () => {
    render(<Loading label="Loading quests" />);
    expect(screen.getByRole("status")).toHaveAttribute("aria-label", "Loading quests");
  });

  it("can show a visible inline label", () => {
    render(<Loading label="Loading billing" showLabel />);
    expect(screen.getByText("Loading billing")).toBeInTheDocument();
  });

  it("renders every variant without crashing", () => {
    const { rerender } = render(<Loading variant="inline" size="sm" />);
    expect(screen.getByRole("status")).toBeInTheDocument();
    rerender(<Loading variant="section" size="md" />);
    expect(screen.getByRole("status")).toBeInTheDocument();
    rerender(<Loading variant="page" size="lg" />);
    expect(screen.getByRole("status")).toBeInTheDocument();
  });
});
