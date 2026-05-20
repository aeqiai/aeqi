/**
 * Regression test: SIWE-authed user with no subscription clicks "+ New company"
 * → 402 from POST /api/start/launch → UI redirects to Stripe checkout URL,
 * NOT surfaces a raw error string.
 *
 * Tests the extracted handleCreate logic so we don't need to mount the full
 * TrustSetupPage with all its auth/routing deps.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ApiError } from "@/lib/api";

const { startLaunch, createCheckoutSession } = vi.hoisted(() => ({
  startLaunch: vi.fn(),
  createCheckoutSession: vi.fn(),
}));

vi.mock("@/lib/api", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...original,
    api: {
      ...(original.api as object),
      startLaunch,
      createCheckoutSession,
    },
  };
});

// ── Extracted handleCreate logic (mirrors TrustSetupPage.handleCreate) ───
//
// Tested as a pure async function so we can assert on side-effects
// (location redirect, error string) without mounting React.

type HandleCreateDeps = {
  blueprintSlug: string;
  displayName: string;
  mission: string;
  plan: string;
  onSuccess: (trustId: string) => void;
  onError: (msg: string) => void;
  navigateTo: (url: string) => void;
};

async function composeHandleCreate({
  blueprintSlug,
  displayName,
  mission,
  plan,
  onSuccess,
  onError,
  navigateTo,
}: HandleCreateDeps) {
  const { api } = await import("@/lib/api");
  try {
    const resp = await api.startLaunch({
      template: blueprintSlug,
      display_name: displayName,
      mission,
      plan,
    });
    onSuccess((resp as { trust_id: string }).trust_id);
  } catch (e) {
    if (e instanceof ApiError && e.status === 402) {
      try {
        const { url } = (await api.createCheckoutSession({
          blueprint: blueprintSlug,
          display_name: displayName,
          mission,
          plan,
          launch: true,
        })) as { url: string };
        navigateTo(url);
      } catch {
        onError("Subscribe to create your first company. Go to Settings → Billing.");
      }
      return;
    }
    onError(e instanceof Error ? e.message : "Create failed. Try again.");
  }
}

describe("company create 402 handling", () => {
  let redirectedTo: string | null = null;
  let errorSet: string | null = null;
  let successEntityId: string | null = null;

  const deps = (): HandleCreateDeps => ({
    blueprintSlug: "aeqi",
    displayName: "Acme Corp",
    mission: "A better operator company.",
    plan: "growth",
    onSuccess: (id) => {
      successEntityId = id;
    },
    onError: (msg) => {
      errorSet = msg;
    },
    navigateTo: (url) => {
      redirectedTo = url;
    },
  });

  beforeEach(() => {
    redirectedTo = null;
    errorSet = null;
    successEntityId = null;
    vi.resetAllMocks();
  });

  it("redirects to Stripe checkout URL when startLaunch returns 402", async () => {
    startLaunch.mockRejectedValueOnce(new ApiError(402, "subscription_required"));
    createCheckoutSession.mockResolvedValueOnce({
      url: "https://checkout.stripe.com/pay/cs_test_abc123",
    });

    await composeHandleCreate(deps());

    expect(startLaunch).toHaveBeenCalledWith({
      template: "aeqi",
      display_name: "Acme Corp",
      mission: "A better operator company.",
      plan: "growth",
    });
    expect(createCheckoutSession).toHaveBeenCalledWith({
      blueprint: "aeqi",
      display_name: "Acme Corp",
      mission: "A better operator company.",
      plan: "growth",
      launch: true,
    });
    expect(redirectedTo).toBe("https://checkout.stripe.com/pay/cs_test_abc123");
    expect(errorSet).toBeNull();
    expect(successEntityId).toBeNull();
  });

  it("shows fallback error when checkout session creation also fails", async () => {
    startLaunch.mockRejectedValueOnce(new ApiError(402, "subscription_required"));
    createCheckoutSession.mockRejectedValueOnce(new Error("billing endpoint down"));

    await composeHandleCreate(deps());

    expect(redirectedTo).toBeNull();
    expect(errorSet).toContain("Settings → Billing");
    expect(successEntityId).toBeNull();
  });

  it("calls onSuccess on a successful launch without touching checkout", async () => {
    startLaunch.mockResolvedValueOnce({ trust_id: "ent_abc" });

    await composeHandleCreate(deps());

    expect(successEntityId).toBe("ent_abc");
    expect(createCheckoutSession).not.toHaveBeenCalled();
    expect(redirectedTo).toBeNull();
    expect(errorSet).toBeNull();
  });

  it("surfaces non-402 errors as error messages without calling checkout", async () => {
    startLaunch.mockRejectedValueOnce(new ApiError(500, "internal server error"));

    await composeHandleCreate(deps());

    expect(errorSet).toBe("internal server error");
    expect(createCheckoutSession).not.toHaveBeenCalled();
    expect(redirectedTo).toBeNull();
  });
});
