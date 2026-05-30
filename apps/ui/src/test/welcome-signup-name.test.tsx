import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import WelcomePage from "@/pages/WelcomePage";
import { useAuthStore } from "@/store/auth";

const { goExternal } = vi.hoisted(() => ({
  goExternal: vi.fn(),
}));

vi.mock("@/lib/navigation", () => ({
  goExternal,
}));

describe("WelcomePage signup name capture", () => {
  const initialAuthState = useAuthStore.getState();

  beforeEach(() => {
    localStorage.clear();
    goExternal.mockReset();
    useAuthStore.setState({
      ...initialAuthState,
      authMode: "accounts",
      authModeLoaded: true,
      googleOAuth: true,
      githubOAuth: true,
      waitlist: true,
    });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    useAuthStore.setState(initialAuthState, true);
  });

  function renderSignup() {
    return render(
      <MemoryRouter initialEntries={["/signup?invite=INVITE-1"]}>
        <WelcomePage mode="signup" />
      </MemoryRouter>,
    );
  }

  it("lets OAuth start without a signup name", () => {
    renderSignup();

    fireEvent.change(screen.getByLabelText("Email address"), {
      target: { value: "ada@example.com" },
    });
    const google = screen.getByRole("button", { name: "Google" });
    expect(google).not.toBeDisabled();
    fireEvent.click(google);

    expect(goExternal).toHaveBeenCalledWith(
      expect.stringContaining("/api/auth/welcome/google/start?"),
    );
    const url = new URL(goExternal.mock.calls[0][0], "https://app.aeqi.ai");
    expect(url.searchParams.get("invite_code")).toBe("INVITE-1");
    expect(url.searchParams.get("name")).toBeNull();
    expect(localStorage.getItem("aeqi_pending_oauth_waitlist_email")).toBe("ada@example.com");
  });

  it("routes closed-beta OAuth state failures into the waitlist flow", async () => {
    localStorage.setItem("aeqi_pending_oauth_waitlist_email", "ada@example.com");
    render(
      <MemoryRouter initialEntries={["/signup?oauth_error=invalid%20or%20expired%20state"]}>
        <WelcomePage mode="signup" />
      </MemoryRouter>,
    );

    expect(await screen.findByRole("heading", { name: /aeqi is in closed beta/i })).toBeVisible();
    expect(screen.queryByText(/That didn't work/i)).not.toBeInTheDocument();
    expect(screen.getByText(/ada@example.com/i)).toBeVisible();
    expect(screen.getByRole("button", { name: /Add me to the waitlist/i })).not.toBeDisabled();
    expect(localStorage.getItem("aeqi_pending_oauth_waitlist_email")).toBeNull();
  });

  it("shows waitlist confirmation when OAuth supplied the provider email", async () => {
    localStorage.setItem("aeqi_pending_oauth_waitlist_email", "stale@example.com");
    render(
      <MemoryRouter
        initialEntries={["/signup?oauth_waitlisted=1&waitlist_email=ada%2Boauth%40example.com"]}
      >
        <WelcomePage mode="signup" />
      </MemoryRouter>,
    );

    expect(await screen.findByRole("heading", { name: /You're on the list/i })).toBeVisible();
    expect(screen.queryByText(/Add me to the waitlist/i)).not.toBeInTheDocument();
    expect(screen.getByText(/ada\+oauth@example.com/i)).toBeVisible();
    expect(localStorage.getItem("aeqi_pending_oauth_waitlist_email")).toBeNull();
  });

  it("accepts invite_code as a referral-code alias", () => {
    render(
      <MemoryRouter initialEntries={["/signup?invite_code=INVITE-2"]}>
        <WelcomePage mode="signup" />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Google" }));

    const url = new URL(goExternal.mock.calls[0][0], "https://app.aeqi.ai");
    expect(url.searchParams.get("invite_code")).toBe("INVITE-2");
  });

  it("sends an optional signup name to Google start when provided", () => {
    renderSignup();

    fireEvent.change(screen.getByLabelText("Your name"), {
      target: { value: "Ada Lovelace" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Google" }));

    expect(goExternal).toHaveBeenCalledWith(
      expect.stringContaining("/api/auth/welcome/google/start?"),
    );
    const url = new URL(goExternal.mock.calls[0][0], "https://app.aeqi.ai");
    expect(url.searchParams.get("invite_code")).toBe("INVITE-1");
    expect(url.searchParams.get("name")).toBe("Ada Lovelace");
  });

  it("keeps the signup name for email code verification after email start", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ email: "ada@example.com", expires_at: "2026-05-21T21:20:00Z" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    renderSignup();

    fireEvent.change(screen.getByLabelText("Your name"), {
      target: { value: "Ada Lovelace" },
    });
    fireEvent.change(screen.getByLabelText("Email address"), {
      target: { value: "ada@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Continue with email" }));

    await screen.findByText(/We sent a 6-digit code/i);
    expect(localStorage.getItem("aeqi_pending_signup_name")).toBe("Ada Lovelace");
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({
      email: "ada@example.com",
      invite_code: "INVITE-1",
      name: "Ada Lovelace",
    });
  });

  it("lets email signup continue without a name", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ email: "ada@example.com", expires_at: "2026-05-21T21:20:00Z" }),
    });
    vi.stubGlobal("fetch", fetchMock);
    localStorage.setItem("aeqi_pending_signup_name", "Stale Name");

    renderSignup();

    fireEvent.change(screen.getByLabelText("Email address"), {
      target: { value: "ada@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Continue with email" }));

    await screen.findByText(/We sent a 6-digit code/i);
    expect(localStorage.getItem("aeqi_pending_signup_name")).toBeNull();
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({
      email: "ada@example.com",
      invite_code: "INVITE-1",
    });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).name).toBeUndefined();
  });
});
