import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { StrictMode } from "react";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { MemoryRouter, Routes, Route, useLocation } from "react-router-dom";
import BlueprintsPage from "@/pages/BlueprintsPage";
import BlueprintDetailPage from "@/pages/BlueprintDetailPage";
import { FALLBACK_TEMPLATES } from "@/lib/templateFixtures";
import { api } from "@/lib/api";

const SOLO = FALLBACK_TEMPLATES.find((t) => t.slug === "solo-founder")!;

const renderApp = (entry = "/blueprints") =>
  render(
    <StrictMode>
      <MemoryRouter initialEntries={[entry]}>
        <Routes>
          <Route path="/blueprints" element={<BlueprintsPage />} />
          <Route path="/blueprints/:slug" element={<BlueprintDetailPage />} />
          <Route path="/blueprints/:slug/:section" element={<BlueprintDetailPage />} />
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

    // The catalog has no title row anymore — the toolbar IS the
    // header (matches the Ideas pattern). Assert the search field +
    // a card render to prove the page mounted.
    expect(
      await screen.findByRole("searchbox", { name: /search blueprints/i }),
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

    // Detail page renders the blueprint name as h1, the seed counts list,
    // and the "Use this Blueprint" CTA — but no spawn form (that lives
    // exclusively on /start now).
    expect(
      await screen.findByRole("heading", { level: 1, name: "Solo Founder" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("What this blueprint seeds")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /use this blueprint/i })).toBeInTheDocument();
  });
});

describe("BlueprintDetailPage", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("renders the section rail; seeds appear on each per-kind sub-route", async () => {
    vi.spyOn(api, "getTemplate").mockResolvedValue({ ok: true, template: SOLO });

    // Overview lands by default — shows the title + the section rail.
    const overview = renderApp("/blueprints/solo-founder");
    await screen.findByRole("heading", { level: 1, name: "Solo Founder" });
    expect(screen.getByRole("tab", { name: /overview/i })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /agents/i })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /events/i })).toBeInTheDocument();
    overview.unmount();

    // Events sub-route renders the event patterns from the seeds.
    const eventsRender = renderApp("/blueprints/solo-founder/events");
    await waitFor(() => {
      expect(screen.getByText("session:start")).toBeInTheDocument();
    });
    eventsRender.unmount();

    // Ideas sub-route renders the seeded idea titles.
    renderApp("/blueprints/solo-founder/ideas");
    await waitFor(() => {
      expect(screen.getByText("how-to-create-a-quest")).toBeInTheDocument();
    });
  });

  it("falls back to bundled fixtures when the detail API errors", async () => {
    vi.spyOn(api, "getTemplate").mockRejectedValue(new Error("offline"));

    renderApp("/blueprints/solo-founder");

    expect(
      await screen.findByRole("heading", { level: 1, name: "Solo Founder" }),
    ).toBeInTheDocument();
  });

  it("'Use this Blueprint' CTA navigates to /start with the slug pre-loaded", async () => {
    vi.spyOn(api, "getTemplate").mockResolvedValue({ ok: true, template: SOLO });
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
            <Route path="/start" element={<Probe />} />
          </Routes>
        </MemoryRouter>
      </StrictMode>,
    );

    await screen.findByRole("heading", { level: 1, name: "Solo Founder" });
    await user.click(screen.getByRole("button", { name: /use this blueprint/i }));

    await waitFor(() => {
      expect(landed).not.toBeNull();
    });
    expect(landed).toBe("/start?blueprint=solo-founder");
  });
});
