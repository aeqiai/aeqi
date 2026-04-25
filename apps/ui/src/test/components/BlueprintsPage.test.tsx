import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { StrictMode } from "react";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import BlueprintsPage from "@/pages/BlueprintsPage";
import SpawnTemplateModal from "@/components/SpawnTemplateModal";
import { FALLBACK_TEMPLATES } from "@/lib/templateFixtures";
import { api } from "@/lib/api";

describe("BlueprintsPage", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("renders the hero and at least one blueprint card after loading", async () => {
    vi.spyOn(api, "getTemplates").mockResolvedValue({
      ok: true,
      templates: FALLBACK_TEMPLATES,
    });

    render(
      <StrictMode>
        <MemoryRouter initialEntries={["/blueprints"]}>
          <Routes>
            <Route path="/blueprints" element={<BlueprintsPage />} />
          </Routes>
        </MemoryRouter>
      </StrictMode>,
    );

    expect(
      await screen.findByRole("heading", { level: 1, name: /blueprints/i }),
    ).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText("Solo Founder")).toBeInTheDocument();
    });
  });

  it("falls back to local fixtures when the API errors", async () => {
    vi.spyOn(api, "getTemplates").mockRejectedValue(new Error("offline"));

    render(
      <StrictMode>
        <MemoryRouter initialEntries={["/blueprints"]}>
          <Routes>
            <Route path="/blueprints" element={<BlueprintsPage />} />
          </Routes>
        </MemoryRouter>
      </StrictMode>,
    );

    await waitFor(() => {
      expect(screen.getByText("Solo Founder")).toBeInTheDocument();
      expect(screen.getByText("Studio")).toBeInTheDocument();
      expect(screen.getByText("Small Business")).toBeInTheDocument();
    });
  });

  it("opens the inline detail pane with seed counts when a card is clicked", async () => {
    vi.spyOn(api, "getTemplates").mockResolvedValue({
      ok: true,
      templates: FALLBACK_TEMPLATES,
    });
    const user = userEvent.setup();

    render(
      <StrictMode>
        <MemoryRouter initialEntries={["/blueprints"]}>
          <Routes>
            <Route path="/blueprints" element={<BlueprintsPage />} />
          </Routes>
        </MemoryRouter>
      </StrictMode>,
    );

    await user.click(await screen.findByText("Solo Founder"));

    expect(
      await screen.findByRole("heading", { level: 2, name: "Solo Founder" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("What this blueprint seeds")).toBeInTheDocument();
    expect(screen.getByLabelText("Company name")).toBeInTheDocument();
  });

  it("auto-selects the blueprint when ?start= matches a slug", async () => {
    vi.spyOn(api, "getTemplates").mockResolvedValue({
      ok: true,
      templates: FALLBACK_TEMPLATES,
    });

    render(
      <StrictMode>
        <MemoryRouter initialEntries={["/blueprints?start=solo-founder"]}>
          <Routes>
            <Route path="/blueprints" element={<BlueprintsPage />} />
          </Routes>
        </MemoryRouter>
      </StrictMode>,
    );

    expect(
      await screen.findByRole("heading", { level: 2, name: "Solo Founder" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Company name")).toBeInTheDocument();
  });
});

describe("SpawnTemplateModal", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("calls api.spawnTemplate and invokes onSpawned with the new root id", async () => {
    const spawn = vi.spyOn(api, "spawnTemplate").mockResolvedValue({
      ok: true,
      root_agent_id: "agent-42",
    });
    const onSpawned = vi.fn();
    const user = userEvent.setup();

    render(
      <StrictMode>
        <MemoryRouter>
          <SpawnTemplateModal
            open
            template={FALLBACK_TEMPLATES[0]}
            onClose={() => {}}
            onSpawned={onSpawned}
          />
        </MemoryRouter>
      </StrictMode>,
    );

    await user.click(screen.getByRole("button", { name: /start company/i }));

    await waitFor(() => {
      expect(spawn).toHaveBeenCalledWith({
        template: "solo-founder",
        name: "Solo Founder",
      });
      expect(onSpawned).toHaveBeenCalledWith("agent-42");
    });
  });

  it("surfaces the error message when spawn fails", async () => {
    vi.spyOn(api, "spawnTemplate").mockRejectedValue(new Error("template not found"));
    const user = userEvent.setup();

    render(
      <StrictMode>
        <MemoryRouter>
          <SpawnTemplateModal
            open
            template={FALLBACK_TEMPLATES[0]}
            onClose={() => {}}
            onSpawned={() => {}}
          />
        </MemoryRouter>
      </StrictMode>,
    );

    await user.click(screen.getByRole("button", { name: /start company/i }));

    await waitFor(() => {
      expect(screen.getByText(/template not found/i)).toBeInTheDocument();
    });
  });
});
