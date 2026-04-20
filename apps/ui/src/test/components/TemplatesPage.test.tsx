import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { StrictMode } from "react";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import TemplatesPage from "@/pages/TemplatesPage";
import SpawnTemplateModal from "@/components/SpawnTemplateModal";
import { FALLBACK_TEMPLATES } from "@/lib/templateFixtures";
import { api } from "@/lib/api";

/**
 * Smoke tests for the templates browse → spawn → redirect flow.
 *
 * We stub `api.getTemplates` + `api.spawnTemplate` at the module level so the
 * tests exercise the component wiring without hitting the network. The flow
 * covered end-to-end:
 *   1. page mounts, catalog renders (live or fallback)
 *   2. card click opens detail view
 *   3. "Start this company" opens the spawn modal
 *   4. confirming spawns and navigates to /{root}/sessions
 */

describe("TemplatesPage", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("renders the hero and at least one template card after loading", async () => {
    vi.spyOn(api, "getTemplates").mockResolvedValue({
      ok: true,
      templates: FALLBACK_TEMPLATES,
    });

    render(
      <StrictMode>
        <MemoryRouter initialEntries={["/templates"]}>
          <Routes>
            <Route path="/templates" element={<TemplatesPage />} />
          </Routes>
        </MemoryRouter>
      </StrictMode>,
    );

    expect(await screen.findByText("Template store")).toBeInTheDocument();
    expect(screen.getByText("Start a company in one step.")).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText("Solo Founder")).toBeInTheDocument();
    });
  });

  it("falls back to local fixtures when the API errors", async () => {
    vi.spyOn(api, "getTemplates").mockRejectedValue(new Error("offline"));

    render(
      <StrictMode>
        <MemoryRouter initialEntries={["/templates"]}>
          <Routes>
            <Route path="/templates" element={<TemplatesPage />} />
          </Routes>
        </MemoryRouter>
      </StrictMode>,
    );

    // Fallback catalog exposes the canonical three templates
    await waitFor(() => {
      expect(screen.getByText("Solo Founder")).toBeInTheDocument();
      expect(screen.getByText("Studio")).toBeInTheDocument();
      expect(screen.getByText("Small Business")).toBeInTheDocument();
    });
  });

  it("opens the detail view with seed sections when a card is clicked", async () => {
    vi.spyOn(api, "getTemplates").mockResolvedValue({
      ok: true,
      templates: FALLBACK_TEMPLATES,
    });
    const user = userEvent.setup();

    render(
      <StrictMode>
        <MemoryRouter initialEntries={["/templates"]}>
          <Routes>
            <Route path="/templates" element={<TemplatesPage />} />
          </Routes>
        </MemoryRouter>
      </StrictMode>,
    );

    await user.click(await screen.findByText("Solo Founder"));

    // Detail view shows the four primitive section labels
    expect(screen.getByText("Agents")).toBeInTheDocument();
    expect(screen.getByText("Events")).toBeInTheDocument();
    expect(screen.getByText("Ideas")).toBeInTheDocument();
    expect(screen.getByText("Quests")).toBeInTheDocument();
    expect(screen.getByText("Start this company")).toBeInTheDocument();
  });

  it("auto-opens the spawn modal when ?start= matches a template", async () => {
    vi.spyOn(api, "getTemplates").mockResolvedValue({
      ok: true,
      templates: FALLBACK_TEMPLATES,
    });

    render(
      <StrictMode>
        <MemoryRouter initialEntries={["/templates?start=solo-founder"]}>
          <Routes>
            <Route path="/templates" element={<TemplatesPage />} />
          </Routes>
        </MemoryRouter>
      </StrictMode>,
    );

    // Modal confirm button is present; the eyebrow + button both carry
    // the label so we assert on the button role specifically.
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /start company/i })).toBeInTheDocument();
    });
    // The template name shows in the modal title
    expect(screen.getByRole("dialog")).toHaveAttribute(
      "aria-label",
      expect.stringContaining("Solo Founder"),
    );
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
        display_name: "Solo Founder",
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
