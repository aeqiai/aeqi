import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { ImportMenu } from "@/components/blueprints/ImportMenu";

describe("ImportMenu", () => {
  it("keeps file import available but disables template imports for MVP", () => {
    const onMarkdownPicked = vi.fn();
    const onBlueprintSpawned = vi.fn();

    render(
      <MemoryRouter>
        <ImportMenu
          trustId="trust-1"
          parts={["ideas"]}
          blueprintTitle="Import ideas from a template"
          onMarkdownPicked={onMarkdownPicked}
          onBlueprintSpawned={onBlueprintSpawned}
        />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole("button", { name: /Import/i }));

    expect(screen.getByRole("menuitem", { name: "From markdown" })).toBeEnabled();
    expect(
      screen.getByRole("menuitem", {
        name: "Template imports after primitive bundle audit",
      }),
    ).toBeDisabled();
    expect(screen.queryByText("Import ideas from a template")).not.toBeInTheDocument();
  });
});
