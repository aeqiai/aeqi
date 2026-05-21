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

    const google = screen.getByRole("button", { name: "Google" });
    expect(google).not.toBeDisabled();
    fireEvent.click(google);

    expect(goExternal).toHaveBeenCalledWith(
      expect.stringContaining("/api/auth/welcome/google/start?"),
    );
    const url = new URL(goExternal.mock.calls[0][0], "https://app.aeqi.ai");
    expect(url.searchParams.get("invite_code")).toBe("INVITE-1");
    expect(url.searchParams.get("name")).toBeNull();
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
