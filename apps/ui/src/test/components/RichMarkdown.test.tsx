import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { RichMarkdown } from "@/components/markdown/RichMarkdown";

describe("RichMarkdown", () => {
  it("renders GFM tables in chat markdown", () => {
    render(
      <RichMarkdown
        variant="session"
        body={`Here is a table:\n\n| Name | Status |\n| --- | --- |\n| Inbox | Ready |\n| Ideas | Blocked |`}
      />,
    );

    const table = screen.getByRole("table");
    expect(table).toBeInTheDocument();
    expect(screen.getByText("Inbox")).toBeInTheDocument();
    expect(screen.getByText("Blocked")).toBeInTheDocument();
  });
});
