import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { ReactNode } from "react";
import { SegmentRenderer } from "@/components/session/SegmentRenderer";
import type { MessageSegment } from "@/components/session/types";
import { useDaemonStore } from "@/store/daemon";

function renderInCompanyRoute(ui: ReactNode) {
  useDaemonStore.setState({
    entities: [
      {
        id: "company-1",
        name: "Company",
        type: "company",
        status: "active",
        company_address: "company-slug",
        created_at: "2026-05-23T00:00:00.000Z",
      },
    ],
    agents: [{ id: "agent-1", name: "Builder", status: "active" }],
    quests: [
      {
        id: "ae-096",
        idea: { id: "idea-quest", name: "Reference primitive work", content: "", tags: [] },
        status: "in_progress",
        priority: "normal",
        cost_usd: 0,
        created_at: "2026-05-23T00:00:00.000Z",
      },
    ],
  });

  return render(
    <MemoryRouter initialEntries={["/company/company-slug"]}>
      <Routes>
        <Route path="/company/:companyAddress" element={ui} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("FileChangedChip", () => {
  it("renders a created chip with op label and filename", () => {
    const segments: MessageSegment[] = [
      {
        kind: "file_changed",
        event: { path: "/workspace/src/main.rs", operation: "created", bytes: 2457 },
      },
    ];
    render(<SegmentRenderer segments={segments} />);
    expect(screen.getByText("wrote")).toBeInTheDocument();
    expect(screen.getByText("main.rs")).toBeInTheDocument();
    // Byte size formatted
    expect(screen.getByText("(2.4 KB)")).toBeInTheDocument();
  });

  it("renders a modified chip with op label and filename", () => {
    const segments: MessageSegment[] = [
      {
        kind: "file_changed",
        event: { path: "src/lib.rs", operation: "modified", bytes: 512 },
      },
    ];
    render(<SegmentRenderer segments={segments} />);
    expect(screen.getByText("edited")).toBeInTheDocument();
    expect(screen.getByText("lib.rs")).toBeInTheDocument();
    expect(screen.getByText("(512 B)")).toBeInTheDocument();
  });

  it("uses --created CSS modifier for created operation", () => {
    const segments: MessageSegment[] = [
      {
        kind: "file_changed",
        event: { path: "foo.ts", operation: "created", bytes: 100 },
      },
    ];
    const { container } = render(<SegmentRenderer segments={segments} />);
    expect(container.querySelector(".asv-file-chip--created")).not.toBeNull();
    expect(container.querySelector(".asv-file-chip--modified")).toBeNull();
  });

  it("uses --modified CSS modifier for modified operation", () => {
    const segments: MessageSegment[] = [
      {
        kind: "file_changed",
        event: { path: "bar.ts", operation: "modified", bytes: 100 },
      },
    ];
    const { container } = render(<SegmentRenderer segments={segments} />);
    expect(container.querySelector(".asv-file-chip--modified")).not.toBeNull();
    expect(container.querySelector(".asv-file-chip--created")).toBeNull();
  });
});

describe("FileDeletedChip", () => {
  it("renders deleted op label and filename", () => {
    const segments: MessageSegment[] = [
      {
        kind: "file_deleted",
        event: { path: "/workspace/old.rs" },
      },
    ];
    render(<SegmentRenderer segments={segments} />);
    expect(screen.getByText("deleted")).toBeInTheDocument();
    expect(screen.getByText("old.rs")).toBeInTheDocument();
  });

  it("uses --deleted CSS modifier", () => {
    const segments: MessageSegment[] = [{ kind: "file_deleted", event: { path: "gone.ts" } }];
    const { container } = render(<SegmentRenderer segments={segments} />);
    expect(container.querySelector(".asv-file-chip--deleted")).not.toBeNull();
  });
});

describe("ToolSummarizedChip", () => {
  it("renders collapsed chip showing tool name and size", () => {
    const segments: MessageSegment[] = [
      {
        kind: "tool_summarized",
        event: {
          tool_use_id: "tu_001",
          tool_name: "shell",
          original_bytes: 51200,
          summary: "Build succeeded with 3 warnings.",
        },
      },
    ];
    render(<SegmentRenderer segments={segments} />);
    expect(screen.getByText("shell")).toBeInTheDocument();
    expect(screen.getByText("summarized")).toBeInTheDocument();
    expect(screen.getByText("(50.0 KB)")).toBeInTheDocument();
    // Summary body hidden by default
    expect(screen.queryByText("Build succeeded with 3 warnings.")).toBeNull();
  });

  it("expands to show summary on click", async () => {
    const user = userEvent.setup();
    const segments: MessageSegment[] = [
      {
        kind: "tool_summarized",
        event: {
          tool_use_id: "tu_002",
          tool_name: "grep",
          original_bytes: 8192,
          summary: "Found 12 matches in 4 files.",
        },
      },
    ];
    render(<SegmentRenderer segments={segments} />);
    // Query by title since text content includes tool name + labels
    const btn = screen.getByTitle("Show summary");
    await user.click(btn);
    expect(screen.getByText("Found 12 matches in 4 files.")).toBeInTheDocument();
  });

  it("collapses again on second click", async () => {
    const user = userEvent.setup();
    const segments: MessageSegment[] = [
      {
        kind: "tool_summarized",
        event: {
          tool_use_id: "tu_003",
          tool_name: "shell",
          original_bytes: 1024,
          summary: "Done.",
        },
      },
    ];
    render(<SegmentRenderer segments={segments} />);
    await user.click(screen.getByTitle("Show summary"));
    expect(screen.getByText("Done.")).toBeInTheDocument();
    await user.click(screen.getByTitle("Hide summary"));
    expect(screen.queryByText("Done.")).toBeNull();
  });
});

describe("EntityRefInline", () => {
  it("renders canonical quest refs as clickable primitive chips", () => {
    const segments: MessageSegment[] = [
      { kind: "text", text: "Open " },
      {
        kind: "entity_ref",
        ref: {
          kind: "quest",
          id: "ae-096",
          label: "Reference primitive work",
          companyId: "company-1",
          status: "in progress",
        },
      },
    ];

    const { container } = renderInCompanyRoute(<SegmentRenderer segments={segments} />);

    const link = screen.getByRole("link", { name: /quest reference primitive work/i });
    expect(link).toHaveAttribute("href", "/company/company-slug/quests/ae-096");
    expect(container.querySelector(".asv-entity-ref--quest")).not.toBeNull();
    expect(screen.getByText("in progress")).toBeInTheDocument();
  });

  it("renders unresolved label-only refs as non-link primitive chips", () => {
    const segments: MessageSegment[] = [
      {
        kind: "entity_ref",
        ref: { kind: "idea", id: "", label: "Missing idea", source: "parser" },
      },
    ];

    const { container } = renderInCompanyRoute(<SegmentRenderer segments={segments} />);

    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByText("Idea")).toBeInTheDocument();
    expect(screen.getByText("Missing idea")).toBeInTheDocument();
    expect(container.querySelector(".asv-entity-ref--unresolved")).not.toBeNull();
  });
});
