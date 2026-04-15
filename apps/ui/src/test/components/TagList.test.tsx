import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import TagList from "@/components/ui/TagList";

describe("TagList", () => {
  it("renders all tag items", () => {
    render(<TagList items={["react", "typescript", "vitest"]} />);
    expect(screen.getByText("react")).toBeInTheDocument();
    expect(screen.getByText("typescript")).toBeInTheDocument();
    expect(screen.getByText("vitest")).toBeInTheDocument();
  });

  it("renders nothing when items is empty and no empty text", () => {
    const { container } = render(<TagList items={[]} />);
    expect(container.innerHTML).toBe("");
  });

  it("renders empty text when items is empty and empty prop is provided", () => {
    render(<TagList items={[]} empty="No tags" />);
    expect(screen.getByText("No tags")).toBeInTheDocument();
  });

  it("applies expertise-tag class to each tag", () => {
    render(<TagList items={["alpha"]} />);
    const tag = screen.getByText("alpha");
    expect(tag).toHaveClass("expertise-tag");
  });
});
