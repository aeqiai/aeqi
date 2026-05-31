import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { PrimitivePageHeader } from "@/components/ui";
import { PINNED_VIEWS_STORAGE_KEY, useUIStore } from "@/store/ui";

describe("PrimitivePageHeader", () => {
  beforeEach(() => {
    window.localStorage.removeItem(PINNED_VIEWS_STORAGE_KEY);
    window.history.pushState({}, "", "/");
    useUIStore.setState({ activeEntity: "root-1", pinnedViews: [] });
  });

  it("uses a plain title for page identity by default", () => {
    render(<PrimitivePageHeader title="Agents" aria-label="Agent controls" />);

    const header = screen.getByLabelText("Agent controls");
    expect(header).toHaveAttribute("data-title-variant", "plain");
    expect(header).toHaveAttribute("data-pin-placement", "utilities");
    expect(screen.getByRole("heading", { name: "Agents" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Pin current view" })).toBeInTheDocument();
  });

  it("keeps the chip variant available for selected object or scope context", () => {
    render(
      <PrimitivePageHeader title="Chief of Staff" titleVariant="chip" aria-label="Agent context" />,
    );

    expect(screen.getByLabelText("Agent context")).toHaveAttribute("data-title-variant", "chip");
  });

  it("can place the pin control in the utility rail before primary actions", () => {
    render(
      <PrimitivePageHeader
        title="Agents"
        aria-label="Agent controls"
        pinPlacement="utilities"
        actions={<button type="button">New agent</button>}
      >
        <input aria-label="Search agents" />
      </PrimitivePageHeader>,
    );

    const header = screen.getByLabelText("Agent controls");
    const search = screen.getByLabelText("Search agents");
    const pin = screen.getByRole("button", { name: "Pin current view" });
    const action = screen.getByRole("button", { name: "New agent" });

    expect(header).toHaveAttribute("data-pin-placement", "utilities");
    expect(search.compareDocumentPosition(pin)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(pin.compareDocumentPosition(action)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it("saves the current route as a pinned view", () => {
    window.history.pushState({}, "", "/trust/root-1/quests?status=open");
    render(<PrimitivePageHeader title="Quests" aria-label="Quest controls" />);

    fireEvent.click(screen.getByRole("button", { name: "Pin current view" }));
    const input = screen.getByLabelText("Name");
    expect(input).toHaveValue("Quests");

    fireEvent.change(input, { target: { value: "Open quests" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(useUIStore.getState().pinnedViews[0]).toMatchObject({
      label: "Open quests",
      path: "/trust/root-1/quests",
      search: "?status=open",
      trustId: "root-1",
    });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
