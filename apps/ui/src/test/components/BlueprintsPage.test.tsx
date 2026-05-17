import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { StrictMode } from "react";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { MemoryRouter, Routes, Route, useLocation } from "react-router-dom";
import BlueprintsPage from "@/pages/BlueprintsPage";
import BlueprintDetailPage from "@/pages/BlueprintDetailPage";
import { api } from "@/lib/api";
import type { AgentTemplate, SingleBlueprint } from "@/lib/types";
import { isSingleBlueprint } from "@/lib/types";

const SOLO: SingleBlueprint = {
  slug: "solo-founder",
  name: "Solo Founder",
  tagline: "Ship product. Talk to users. Stay shipping.",
  description:
    "A lean operator for one-person companies. Wakes up with a product manager, an engineer, and a growth agent already threaded — plus a rolling backlog that keeps you moving from idea to revenue.",
  tags: ["founder", "startup", "product"],
  root: {
    name: "Operator",
    model: "anthropic/claude-sonnet-4.6",
    color: "#0a0a0b",
  },
  seed_agents: [{ name: "Operator", tagline: "The founder's right hand.", role: "Company root." }],
  seed_events: [{ pattern: "session:start", name: "Daily stand-in" }],
  seed_ideas: [{ name: "how-to-create-a-quest", tags: ["skill"] }],
  seed_quests: [{ subject: "Write the one-liner", priority: "high" }],
};

const STEWARD_TEMPLATE: AgentTemplate = {
  id: "steward",
  name: "Steward",
  tagline: "Maintains operating cadence, context hygiene, and weekly review.",
  role: "Operating Steward",
  seed_events: [
    { owner: "Steward", pattern: "schedule:0 16 * * 5", name: "steward_weekly_review" },
  ],
  seed_ideas: [{ owner: "Steward", name: "Steward operating cadence", tags: ["cadence"] }],
  seed_quests: [{ owner: "Steward", subject: "Run the first Steward review" }],
};

// ── Type discriminator unit tests ────────────────────────────────────

describe("Blueprint discriminated union", () => {
  it("isSingleBlueprint returns true for SingleBlueprint with no kind", () => {
    expect(isSingleBlueprint(SOLO)).toBe(true);
  });

  it("isSingleBlueprint returns true for SingleBlueprint with kind='single'", () => {
    const withKind: SingleBlueprint = { ...SOLO, kind: "single" };
    expect(isSingleBlueprint(withKind)).toBe(true);
  });
});

// ── BlueprintsPage catalog tests ──────────────────────────────────────

const renderApp = (entry = "/blueprints") =>
  render(
    <StrictMode>
      <MemoryRouter initialEntries={[entry]}>
        <Routes>
          <Route path="/blueprints" element={<BlueprintsPage />} />
          <Route path="/blueprints/agents" element={<BlueprintsPage />} />
          <Route path="/blueprints/:blueprintId" element={<BlueprintDetailPage />} />
          <Route path="/blueprints/:blueprintId/:section" element={<BlueprintDetailPage />} />
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
    vi.spyOn(api, "getBlueprints").mockResolvedValue({
      ok: true,
      blueprints: [SOLO],
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

  it("shows an error when the catalog API errors", async () => {
    vi.spyOn(api, "getBlueprints").mockRejectedValue(new Error("offline"));

    renderApp();

    expect(await screen.findByRole("alert")).toHaveTextContent("offline");
    expect(screen.queryByText("Solo Founder")).not.toBeInTheDocument();
  });

  it("clicking a card navigates to the dedicated detail page", async () => {
    vi.spyOn(api, "getBlueprints").mockResolvedValue({
      ok: true,
      blueprints: [SOLO],
    });
    vi.spyOn(api, "getBlueprint").mockResolvedValue({ ok: true, blueprint: SOLO });
    const user = userEvent.setup();

    renderApp();

    await user.click(await screen.findByText("Solo Founder"));

    // Detail page renders the blueprint name as h1, the seed counts list,
    // and the "Use this Blueprint" CTA — but no spawn form (that lives
    // exclusively on /launch now).
    expect(
      await screen.findByRole("heading", { level: 1, name: "Solo Founder" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("What this blueprint seeds")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /use this blueprint/i })).toBeInTheDocument();
  });

  it("renders reusable agent templates on the Agents catalog lane", async () => {
    vi.spyOn(api, "getBlueprints").mockResolvedValue({
      ok: true,
      blueprints: [SOLO],
      agent_templates: [STEWARD_TEMPLATE],
    });

    renderApp("/blueprints/agents");

    expect(await screen.findByText("Steward")).toBeInTheDocument();
    expect(screen.getByText("Operating Steward")).toBeInTheDocument();
    expect(screen.getByText(/1 event · 1 idea · 1 quest/)).toBeInTheDocument();
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
    vi.spyOn(api, "getBlueprint").mockResolvedValue({ ok: true, blueprint: SOLO });

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

  it("shows template-derived agent bundles on blueprint detail routes", async () => {
    const aeqi: SingleBlueprint = {
      ...SOLO,
      slug: "aeqi",
      name: "aeqi",
      seed_agents: [
        {
          template_id: "steward",
          name: "Steward",
          tagline: "Maintains operating cadence.",
          role: "Operating Steward",
        },
      ],
      seed_events: STEWARD_TEMPLATE.seed_events,
      seed_ideas: STEWARD_TEMPLATE.seed_ideas,
      seed_quests: STEWARD_TEMPLATE.seed_quests,
    };
    vi.spyOn(api, "getBlueprint").mockResolvedValue({ ok: true, blueprint: aeqi });

    const agentsRender = renderApp("/blueprints/aeqi/agents");
    await screen.findByText("Steward");
    expect(screen.getByText("fills · Operating Steward")).toBeInTheDocument();
    agentsRender.unmount();

    const ideasRender = renderApp("/blueprints/aeqi/ideas");
    await screen.findByText("Steward operating cadence");
    expect(screen.getByText(/Steward #cadence/)).toBeInTheDocument();
    ideasRender.unmount();

    renderApp("/blueprints/aeqi/events");
    await screen.findByText("schedule:0 16 * * 5");
    expect(screen.getByText(/Steward · steward_weekly_review/)).toBeInTheDocument();
  });

  it("shows the detail page error when the API fails", async () => {
    vi.spyOn(api, "getBlueprint").mockRejectedValue(new Error("offline"));

    renderApp("/blueprints/solo-founder");

    expect(
      await screen.findByRole("heading", { level: 3, name: "Blueprint not found." }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /back to the catalog/i })).toHaveAttribute(
      "href",
      "/blueprints",
    );
  });

  it("'Use this Blueprint' CTA navigates to /launch with the slug pre-loaded", async () => {
    vi.spyOn(api, "getBlueprint").mockResolvedValue({ ok: true, blueprint: SOLO });
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
            <Route path="/blueprints/:blueprintId" element={<BlueprintDetailPage />} />
            <Route path="/launch" element={<Probe />} />
            <Route path="/launch/:blueprintId" element={<Probe />} />
          </Routes>
        </MemoryRouter>
      </StrictMode>,
    );

    await screen.findByRole("heading", { level: 1, name: "Solo Founder" });
    await user.click(screen.getByRole("button", { name: /use this blueprint/i }));

    await waitFor(() => {
      expect(landed).not.toBeNull();
    });
    expect(landed).toBe("/launch/solo-founder");
  });
});
