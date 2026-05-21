import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StrictMode } from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import StartPage from "@/pages/StartPage";
import { useEntities } from "@/queries/entities";
import { useAuthStore } from "@/store/auth";
import { useInboxStore } from "@/store/inbox";
import type { InboxItem } from "@/lib/api";
import type { Trust } from "@/lib/types";

vi.mock("@/queries/entities", () => ({
  useEntities: vi.fn(),
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

const initialAuthState = useAuthStore.getState();
const initialInboxState = useInboxStore.getState();

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
  useAuthStore.setState({ user: USER } as never);
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
  });

  it("supports the no-TRUST state with Launch TRUST primary and Browse Blueprints secondary", () => {
    primeStartPage([]);

    const { container } = renderStartPage();

    const trustSection = screen.getByRole("region", { name: "Your TRUSTs" });
    const primary = within(trustSection).getByRole("button", { name: /launch trust/i });
    const secondary = within(trustSection).getByRole("button", { name: /browse blueprints/i });

    expect(
      screen.getByRole("heading", { level: 1, name: "Operate your TRUSTs" }),
    ).toBeInTheDocument();
    expect(primary).toBeInTheDocument();
    expect(secondary).toBeInTheDocument();
    expect(screen.getByText(/no other TRUSTs/i)).toBeInTheDocument();
    expect(
      screen.getByText(/approvals and proposals appear here once your TRUST is live/i),
    ).toBeInTheDocument();
    expectNoVagueCtaLanguage(container);

    fireEvent.click(primary);
    expect(screen.getByTestId("location")).toHaveTextContent("/launch");
  });

  it("shows the returning-user operating surface with active TRUST, inbox review, launch, browse, and switch affordances", () => {
    primeStartPage([ALPHA_TRUST, BETA_TRUST], [AWAITING_INBOX_ITEM]);

    const { container } = renderStartPage();

    expect(
      screen.getByRole("heading", { level: 1, name: "Operate your TRUSTs" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("status", { name: "Account snapshot" })).toHaveTextContent("2 TRUSTs");
    expect(screen.getByRole("status", { name: "Account snapshot" })).toHaveTextContent(
      "1 awaiting",
    );

    const activeTrust = screen.getByRole("button", { name: /open trust.*alpha trust/i });
    const reviewInbox = screen.getByRole("button", { name: /review inbox/i });
    const launchTrust = screen.getByRole("button", { name: /launch trust/i });
    const browseBlueprints = screen.getByRole("button", { name: /browse blueprints/i });
    const otherTrust = screen.getByRole("button", { name: /open trust.*beta trust/i });

    expect(activeTrust).toBeInTheDocument();
    expect(reviewInbox).toBeInTheDocument();
    expect(launchTrust).toBeInTheDocument();
    expect(browseBlueprints).toBeInTheDocument();
    expect(otherTrust).toBeInTheDocument();
    expect(screen.getByText("Review launch result")).toBeInTheDocument();
    expect(screen.getByText(/Inbox item · Awaiting you/i)).toBeInTheDocument();
    expect(screen.getByText(/Janus · Alpha Trust/i)).toBeInTheDocument();
    expectNoVagueCtaLanguage(container);

    fireEvent.click(activeTrust);
    expect(screen.getByTestId("location")).toHaveTextContent("/trust/alpha");
  });
});
