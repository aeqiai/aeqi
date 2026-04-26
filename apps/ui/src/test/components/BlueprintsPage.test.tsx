import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { StrictMode } from "react";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { MemoryRouter, Routes, Route, useLocation } from "react-router-dom";
import BlueprintsPage from "@/pages/BlueprintsPage";
import BlueprintDetailPage from "@/pages/BlueprintDetailPage";
import SpawnTemplateModal from "@/components/SpawnTemplateModal";
import { FALLBACK_TEMPLATES } from "@/lib/templateFixtures";
import { api } from "@/lib/api";
import { useAuthStore } from "@/store/auth";

const SOLO = FALLBACK_TEMPLATES.find((t) => t.slug === "solo-founder")!;

// Both routes are wired so card-click navigation can be exercised end-to-end.
const renderApp = (entry = "/blueprints") =>
  render(
    <StrictMode>
      <MemoryRouter initialEntries={[entry]}>
        <Routes>
          <Route path="/blueprints" element={<BlueprintsPage />} />
          <Route path="/blueprints/:slug" element={<BlueprintDetailPage />} />
        </Routes>
      </MemoryRouter>
    </StrictMode>,
  );

describe("BlueprintsPage (catalog)", () => {
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

    renderApp();

    expect(
      await screen.findByRole("heading", { level: 1, name: /blueprints/i }),
    ).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText("Solo Founder")).toBeInTheDocument();
    });
  });

  it("falls back to local fixtures when the API errors", async () => {
    vi.spyOn(api, "getTemplates").mockRejectedValue(new Error("offline"));

    renderApp();

    await waitFor(() => {
      expect(screen.getByText("Solo Founder")).toBeInTheDocument();
      expect(screen.getByText("Studio")).toBeInTheDocument();
      expect(screen.getByText("Small Business")).toBeInTheDocument();
    });
  });

  it("clicking a card navigates to the dedicated detail page", async () => {
    vi.spyOn(api, "getTemplates").mockResolvedValue({
      ok: true,
      templates: FALLBACK_TEMPLATES,
    });
    vi.spyOn(api, "getTemplate").mockResolvedValue({ ok: true, template: SOLO });
    const user = userEvent.setup();

    renderApp();

    await user.click(await screen.findByText("Solo Founder"));

    // The detail page renders the blueprint name as an h1, the seed
    // counts list, and the spawn form's Company name input.
    expect(
      await screen.findByRole("heading", { level: 1, name: "Solo Founder" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("What this blueprint seeds")).toBeInTheDocument();
    expect(screen.getByLabelText("Company name")).toBeInTheDocument();
  });
});

describe("BlueprintDetailPage", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("renders sample event patterns + idea titles + quest subjects", async () => {
    vi.spyOn(api, "getTemplate").mockResolvedValue({ ok: true, template: SOLO });

    renderApp("/blueprints/solo-founder");

    await screen.findByRole("heading", { level: 1, name: "Solo Founder" });

    expect(screen.getByText("Events that fire")).toBeInTheDocument();
    expect(screen.getByText("Ideas seeded")).toBeInTheDocument();
    expect(screen.getByText("Quests waiting")).toBeInTheDocument();
    expect(screen.getByText("session:start")).toBeInTheDocument();
    expect(screen.getByText("how-to-create-a-quest")).toBeInTheDocument();
  });

  it("falls back to bundled fixtures when the detail API errors", async () => {
    vi.spyOn(api, "getTemplate").mockRejectedValue(new Error("offline"));

    renderApp("/blueprints/solo-founder");

    expect(
      await screen.findByRole("heading", { level: 1, name: "Solo Founder" }),
    ).toBeInTheDocument();
  });

  it("anonymous spawn click redirects to /signup with the slug as ?next=", async () => {
    vi.spyOn(api, "getTemplate").mockResolvedValue({ ok: true, template: SOLO });
    useAuthStore.setState({ token: null, authMode: "secret" });
    const user = userEvent.setup();

    let landed: string | null = null;
    const Probe = () => {
      const loc = useLocation();
      landed = loc.pathname + loc.search;
      return null;
    };

    render(
      <StrictMode>
        <MemoryRouter initialEntries={["/blueprints/solo-founder"]}>
          <Routes>
            <Route path="/blueprints/:slug" element={<BlueprintDetailPage />} />
            <Route path="/signup" element={<Probe />} />
          </Routes>
        </MemoryRouter>
      </StrictMode>,
    );

    await screen.findByRole("heading", { level: 1, name: "Solo Founder" });
    await user.click(screen.getByRole("button", { name: /sign up to start/i }));

    await waitFor(() => {
      expect(landed).not.toBeNull();
    });
    expect(landed).toBe("/signup?next=/blueprints/solo-founder");
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
