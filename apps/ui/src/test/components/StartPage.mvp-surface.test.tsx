import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StrictMode } from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import StartPage from "@/pages/StartPage";
import { useAgents } from "@/queries/agents";
import { useEntities } from "@/queries/entities";
import { useAuthStore } from "@/store/auth";
import { useInboxStore } from "@/store/inbox";
import { useUIStore } from "@/store/ui";
import { api, type InboxItem } from "@/lib/api";
import type { Agent, Role } from "@/lib/types";
import type { Trust } from "@/lib/types";

vi.mock("@/queries/agents", () => ({
  useAgents: vi.fn(),
}));

vi.mock("@/queries/entities", () => ({
  useEntities: vi.fn(),
}));

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    api: {
      ...actual.api,
      getRoles: vi.fn(),
    },
  };
});

const USER = {
  id: "user-1",
  email: "ada@aeqi.ai",
  name: "Ada Founder",
  subscription_plan: "starter",
};

const ALPHA_TRUST: Trust = {
  id: "alpha",
  name: "Alpha Trust",
  type: "trust",
  status: "active",
  created_at: "2026-05-01T00:00:00Z",
  tagline: "Operating company",
  public: true,
};

const BETA_TRUST: Trust = {
  id: "beta",
  name: "Beta Trust",
  type: "trust",
  status: "active",
  created_at: "2026-05-02T00:00:00Z",
  tagline: "Second company",
  public: false,
};

const AWAITING_INBOX_ITEM: InboxItem = {
  session_id: "session-review-1",
  agent_id: "agent-1",
  agent_name: "Janus",
  trust_id: "alpha",
  session_name: "Launch review",
  awaiting_subject: "Review launch result",
  awaiting_at: "2026-05-21T10:00:00Z",
  last_agent_message: "The home page launch result is ready for review.",
  last_active: "2026-05-21T10:05:00Z",
};

const ALPHA_AGENT: Agent = {
  id: "agent-alpha",
  name: "Janus",
  status: "running",
  trust_id: "alpha",
};

const ALPHA_ROLE: Role = {
  id: "role-alpha-director",
  trust_id: "alpha",
  title: "Director",
  occupant_kind: "human",
  occupant_id: "user-1",
  occupant_name: "Ada Founder",
  occupant_avatar_url: null,
  description_idea_id: null,
  role_type: "director",
  founder: true,
  grants: [],
  created_at: "2026-05-01T00:00:00Z",
  updated_at: null,
};

const initialAuthState = useAuthStore.getState();
const initialInboxState = useInboxStore.getState();
const initialUIState = useUIStore.getState();

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{location.pathname}</div>;
}

function renderStartPage() {
  return render(
    <StrictMode>
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route
            path="/"
            element={
              <>
                <StartPage />
                <LocationProbe />
              </>
            }
          />
          <Route path="*" element={<LocationProbe />} />
        </Routes>
      </MemoryRouter>
    </StrictMode>,
  );
}

function primeStartPage(trusts: Trust[], inboxItems: InboxItem[] = []) {
  vi.mocked(useEntities).mockReturnValue(trusts);
  vi.mocked(useAgents).mockReturnValue(trusts.length > 0 ? [ALPHA_AGENT] : []);
  vi.mocked(api.getRoles).mockResolvedValue(
    trusts.length > 0
      ? { ok: true, roles: [ALPHA_ROLE], edges: [] }
      : { ok: true, roles: [], edges: [] },
  );
  useAuthStore.setState({ user: USER } as never);
  useUIStore.setState({ activeEntity: trusts[0]?.id ?? "" } as never);
  useInboxStore.setState({
    items: inboxItems,
    loading: false,
    error: null,
    pendingDismissal: new Set(),
    fetchInbox: vi.fn().mockResolvedValue(undefined),
  });
}

function interactiveNames(container: HTMLElement) {
  return Array.from(container.querySelectorAll<HTMLButtonElement | HTMLAnchorElement>("button, a"))
    .map((el) => el.getAttribute("aria-label") || el.textContent || "")
    .map((name) => name.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

function expectNoVagueCtaLanguage(container: HTMLElement) {
  const vagueCtas = interactiveNames(container).filter((name) =>
    /\b(step in|step into|go|continue|manage)\b|^explore$|^view( all)?$/i.test(name),
  );

  expect(vagueCtas).toEqual([]);
}

describe("StartPage MVP surface", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.mocked(useEntities).mockReset();
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    useAuthStore.setState(initialAuthState, true);
    useInboxStore.setState(initialInboxState, true);
    useUIStore.setState(initialUIState, true);
  });

  it("supports the no-TRUST state with Launch TRUST primary and Browse Blueprints secondary", () => {
    primeStartPage([]);

    const { container } = renderStartPage();

    const trustSection = screen.getByRole("region", { name: "Operating context" });
    const primary = within(trustSection).getByRole("link", { name: /launch trust/i });
    const secondary = within(trustSection).getByRole("link", { name: /browse blueprints/i });

    expect(screen.getByRole("heading", { level: 1, name: "Welcome back" })).toBeInTheDocument();
    expect(screen.getByText("Ada Founder")).toBeInTheDocument();
    expect(screen.getByText("ada@aeqi.ai")).toBeInTheDocument();
    expect(
      screen.getByText(/Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday/),
    ).toBeInTheDocument();
    expect(screen.queryByText("Operator shell")).not.toBeInTheDocument();
    expect(screen.queryByText(/aeqi v0\.1/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /open account settings/i })).not.toBeInTheDocument();
    expect(screen.getByText("No active TRUST")).toBeInTheDocument();
    expect(
      screen.getByText(/operating container for ownership, agents, quests, and ideas/i),
    ).toBeInTheDocument();
    expect(primary).toBeInTheDocument();
    expect(secondary).toBeInTheDocument();
    expect(
      screen.getByText(/no reviews, approvals, failed events, or agent handoffs/i),
    ).toBeInTheDocument();
    expect(screen.getByText("Learn more")).toBeInTheDocument();
    expectNoVagueCtaLanguage(container);

    fireEvent.click(primary);
    expect(screen.getByTestId("location")).toHaveTextContent("/launch");
  });

  it("shows the returning-user operating surface with active TRUST activity, inbox review, launch, and browse affordances", async () => {
    primeStartPage([ALPHA_TRUST, BETA_TRUST], [AWAITING_INBOX_ITEM]);

    const { container } = renderStartPage();
    const trustSection = screen.getByRole("region", { name: "Operating context" });

    expect(screen.getByRole("heading", { level: 1, name: "Welcome back" })).toBeInTheDocument();
    expect(screen.queryByRole("status", { name: "Account snapshot" })).not.toBeInTheDocument();
    expect(screen.getByText("Ada Founder")).toBeInTheDocument();
    expect(screen.getByText("ada@aeqi.ai")).toBeInTheDocument();
    expect(
      screen.getByText(/Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday/),
    ).toBeInTheDocument();
    expect(screen.queryByText("Operator shell")).not.toBeInTheDocument();
    expect(screen.queryByText(/aeqi v0\.1/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /open account settings/i })).not.toBeInTheDocument();

    expect(
      within(trustSection).getByRole("heading", { level: 2, name: "TRUST" }),
    ).toBeInTheDocument();
    expect(within(trustSection).getByText("Active TRUST")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 3, name: "Alpha Trust" })).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Director .* Ada Founder/i })).toBeInTheDocument(),
    );
    expect(screen.queryByText("Quests")).not.toBeInTheDocument();
    expect(screen.queryByText("Ideas")).not.toBeInTheDocument();
    expect(screen.queryByText("Events")).not.toBeInTheDocument();
    expect(screen.queryByText("Agents")).not.toBeInTheDocument();
    expect(screen.queryByText(/Latest activity:/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Beta Trust/i)).not.toBeInTheDocument();

    const yourTrusts = screen.getByRole("link", { name: /your trusts/i });
    const reviewInbox = screen.getByRole("link", { name: /^inbox$/i });
    const launchTrust = screen.getByRole("link", { name: /^launch$/i });
    const browseBlueprints = screen.getByRole("link", { name: /browse blueprints/i });

    expect(yourTrusts).toBeInTheDocument();
    expect(reviewInbox).toBeInTheDocument();
    expect(launchTrust).toBeInTheDocument();
    expect(browseBlueprints).toBeInTheDocument();
    expect(
      screen.getByText(/operating container for ownership, agents, quests, and ideas/i),
    ).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /open trust/i })).not.toBeInTheDocument();
    expect(screen.getByText("Review launch result")).toBeInTheDocument();
    expect(screen.getByText(/Awaiting reply · Janus · Alpha Trust/i)).toBeInTheDocument();
    expect(screen.getByText("Economy")).toBeInTheDocument();
    expect(screen.getByText(/Unlock the agent economy/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /explore economy/i })).toBeInTheDocument();
    expect(screen.getByText(/Why aeqi pivoted/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /read docs/i })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /^show /i })).toHaveLength(8);
    expectNoVagueCtaLanguage(container);

    fireEvent.click(yourTrusts);
    expect(screen.getByTestId("location")).toHaveTextContent("/trust");
  });
});
