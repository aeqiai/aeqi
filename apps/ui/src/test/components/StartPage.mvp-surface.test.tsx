import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StrictMode } from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import StartPage from "@/pages/StartPage";
import { useAgents } from "@/queries/agents";
import { useEntities } from "@/queries/entities";
import { useQuests } from "@/queries/quests";
import { useAuthStore } from "@/store/auth";
import { useInboxStore } from "@/store/inbox";
import { useUIStore } from "@/store/ui";
import type { InboxItem } from "@/lib/api";
import type { Agent, Quest } from "@/lib/types";
import type { Trust } from "@/lib/types";

vi.mock("@/queries/agents", () => ({
  useAgents: vi.fn(),
}));

vi.mock("@/queries/entities", () => ({
  useEntities: vi.fn(),
}));

vi.mock("@/queries/quests", () => ({
  useQuests: vi.fn(),
}));

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

const ALPHA_QUEST: Quest = {
  id: "quest-alpha",
  status: "in_progress",
  priority: "high",
  cost_usd: 0,
  created_at: "2026-05-21T09:00:00Z",
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
  vi.mocked(useQuests).mockReturnValue(trusts.length > 0 ? [ALPHA_QUEST] : []);
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
    /\b(step in|step into|explore|go|continue|manage)\b|^view( all)?$/i.test(name),
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

    expect(screen.getByRole("heading", { level: 1, name: "Ada Founder" })).toBeInTheDocument();
    expect(screen.getByText("Operator · ada@aeqi.ai")).toBeInTheDocument();
    expect(screen.getByText("No active TRUST")).toBeInTheDocument();
    expect(primary).toBeInTheDocument();
    expect(secondary).toBeInTheDocument();
    expect(screen.getByText(/none yet/i)).toBeInTheDocument();
    expect(
      screen.getByText(/no reviews, approvals, failed events, or agent handoffs/i),
    ).toBeInTheDocument();
    expect(screen.getByText("Learn more")).toBeInTheDocument();
    expectNoVagueCtaLanguage(container);

    fireEvent.click(primary);
    expect(screen.getByTestId("location")).toHaveTextContent("/launch");
  });

  it("shows the returning-user operating surface with active TRUST, inbox review, launch, browse, and switch affordances", () => {
    primeStartPage([ALPHA_TRUST, BETA_TRUST], [AWAITING_INBOX_ITEM]);

    const { container } = renderStartPage();

    expect(screen.getByRole("heading", { level: 1, name: "Ada Founder" })).toBeInTheDocument();
    expect(screen.getByRole("status", { name: "Account snapshot" })).toHaveTextContent("2 TRUSTs");
    expect(screen.getByRole("status", { name: "Account snapshot" })).toHaveTextContent(
      "1 awaiting",
    );

    expect(screen.getByText("Current context")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "Alpha Trust" })).toBeInTheDocument();
    expect(screen.getAllByText("Director").length).toBeGreaterThan(0);
    expect(
      screen.getByText("You are operating as Director inside this TRUST."),
    ).toBeInTheDocument();
    expect(screen.getByText("Your TRUSTs")).toBeInTheDocument();
    expect(screen.getByText(/Beta Trust/i)).toBeInTheDocument();

    const activeTrust = screen.getAllByRole("link", { name: /open trust.*alpha trust/i })[0];
    const reviewInbox = screen.getByRole("link", { name: /review inbox/i });
    const launchTrust = screen.getByRole("link", { name: /launch blank trust/i });
    const browseBlueprints = screen.getByRole("link", { name: /browse blueprints/i });
    const otherTrust = screen.getByRole("link", { name: /open trust.*beta trust/i });

    expect(activeTrust).toBeInTheDocument();
    expect(reviewInbox).toBeInTheDocument();
    expect(launchTrust).toBeInTheDocument();
    expect(browseBlueprints).toBeInTheDocument();
    expect(otherTrust).toBeInTheDocument();
    expect(screen.getByText("Review launch result")).toBeInTheDocument();
    expect(screen.getByText(/Inbox item · Awaiting you/i)).toBeInTheDocument();
    expect(screen.getByText(/Janus · Alpha Trust/i)).toBeInTheDocument();
    expect(screen.getByText(/Explore Economy/i)).toBeInTheDocument();
    expect(screen.getByText(/Unlock the agent economy/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /discover/i })).toBeInTheDocument();
    expect(screen.getByText(/Why aeqi pivoted/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /read docs/i })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /^show /i })).toHaveLength(8);
    expectNoVagueCtaLanguage(container);

    fireEvent.click(activeTrust);
    expect(screen.getByTestId("location")).toHaveTextContent("/trust/alpha");
  });
});
