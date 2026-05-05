import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import WalletUpgradeSection from "@/pages/Settings/WalletUpgradeSection";

// ── Snapshot tests ───────────────────────────────────────────────────────────

describe("WalletUpgradeSection — snapshots", () => {
  it("renders the passkey-enrolled state", () => {
    const { container } = render(<WalletUpgradeSection signerType="passkey" />);
    expect(container).toMatchSnapshot();
  });

  it("renders the custodial EOA state with upgrade button", () => {
    const { container } = render(<WalletUpgradeSection signerType="custodial_eoa" />);
    expect(container).toMatchSnapshot();
  });

  it("renders the unknown / loading state", () => {
    const { container } = render(<WalletUpgradeSection signerType="unknown" />);
    expect(container).toMatchSnapshot();
  });
});

// ── Signer type display ─────────────────────────────────────────────────────

describe("WalletUpgradeSection — display", () => {
  it("shows 'Passkey enrolled' text when signerType is passkey", () => {
    render(<WalletUpgradeSection signerType="passkey" />);
    expect(screen.getByText("Passkey enrolled")).toBeInTheDocument();
  });

  it("shows 'Custodial EOA' text when signerType is custodial_eoa", () => {
    render(<WalletUpgradeSection signerType="custodial_eoa" />);
    expect(screen.getByText("Custodial EOA")).toBeInTheDocument();
  });

  it("shows 'Upgrade to passkey' button when signerType is custodial_eoa", () => {
    render(<WalletUpgradeSection signerType="custodial_eoa" />);
    const btn = screen.getByRole("button", { name: /upgrade to passkey/i });
    expect(btn).toBeInTheDocument();
  });

  it("does NOT show upgrade button when signerType is passkey", () => {
    render(<WalletUpgradeSection signerType="passkey" />);
    expect(screen.queryByRole("button", { name: /upgrade to passkey/i })).toBeNull();
  });

  it("shows Phase 2 badge when signerType is passkey", () => {
    render(<WalletUpgradeSection signerType="passkey" />);
    expect(screen.getByText("Phase 2")).toBeInTheDocument();
  });

  it("shows Phase 1 badge when signerType is custodial_eoa", () => {
    render(<WalletUpgradeSection signerType="custodial_eoa" />);
    expect(screen.getByText("Phase 1")).toBeInTheDocument();
  });
});

// ── Modal open/close ─────────────────────────────────────────────────────────

describe("WalletUpgradeSection — modal", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("opens the upgrade modal when 'Upgrade to passkey' is clicked", async () => {
    const user = userEvent.setup();
    render(<WalletUpgradeSection signerType="custodial_eoa" />);
    const btn = screen.getByRole("button", { name: /upgrade to passkey/i });
    await user.click(btn);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText(/Upgrade to passkey/i, { selector: "h2" })).toBeInTheDocument();
  });

  it("modal contains a link to the wallet migration docs", async () => {
    const user = userEvent.setup();
    render(<WalletUpgradeSection signerType="custodial_eoa" />);
    await user.click(screen.getByRole("button", { name: /upgrade to passkey/i }));
    const link = screen.getByRole("link", { name: /read the migration guide/i });
    expect(link).toHaveAttribute("href", "https://aeqi.ai/docs/guides/wallet-migration");
  });

  it("closes the modal when Cancel is clicked", async () => {
    const user = userEvent.setup();
    render(<WalletUpgradeSection signerType="custodial_eoa" />);
    await user.click(screen.getByRole("button", { name: /upgrade to passkey/i }));
    const cancelBtn = screen.getByRole("button", { name: /cancel/i });
    await user.click(cancelBtn);
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

// ── WebAuthn invocation ──────────────────────────────────────────────────────

describe("WalletUpgradeSection — WebAuthn invocation", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("calls navigator.credentials.create with P-256 (alg -7) when 'Upgrade to passkey' is confirmed", async () => {
    // Arrange: stub navigator.credentials.create to return a minimal credential.
    const mockRawId = new ArrayBuffer(16);
    const mockPublicKey = new ArrayBuffer(64);

    const createSpy = vi.fn().mockResolvedValue({
      rawId: mockRawId,
      response: {
        getPublicKey: () => mockPublicKey,
      },
    } as unknown as PublicKeyCredential);

    Object.defineProperty(navigator, "credentials", {
      value: { create: createSpy },
      writable: true,
      configurable: true,
    });

    // Stub apiRequest so we don't actually hit the network.
    vi.mock("@/api/client", () => ({
      apiRequest: vi.fn().mockResolvedValue({ ok: true }),
    }));

    const user = userEvent.setup();
    render(<WalletUpgradeSection signerType="custodial_eoa" />);

    // Open the modal.
    await user.click(screen.getByRole("button", { name: /upgrade to passkey/i }));

    // Click the primary "Upgrade to passkey" button inside the modal.
    const confirmBtn = screen.getAllByRole("button", { name: /upgrade to passkey/i })[1];
    fireEvent.click(confirmBtn);

    // Wait for createSpy to be called.
    await waitFor(() => expect(createSpy).toHaveBeenCalledTimes(1));

    // Assert the call used P-256 (alg: -7) and platform authenticator.
    const callArg = createSpy.mock.calls[0][0] as CredentialCreationOptions;
    const pubKey = callArg.publicKey!;

    expect(pubKey.pubKeyCredParams).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: "public-key", alg: -7 })]),
    );
    expect(pubKey.authenticatorSelection?.authenticatorAttachment).toBe("platform");
    expect(pubKey.authenticatorSelection?.residentKey).toBe("required");
    expect(pubKey.authenticatorSelection?.userVerification).toBe("required");
  });

  it("silently resets to idle on NotAllowedError (user dismissed the prompt)", async () => {
    const createSpy = vi
      .fn()
      .mockRejectedValue(Object.assign(new Error("Not allowed"), { name: "NotAllowedError" }));

    Object.defineProperty(navigator, "credentials", {
      value: { create: createSpy },
      writable: true,
      configurable: true,
    });

    const user = userEvent.setup();
    render(<WalletUpgradeSection signerType="custodial_eoa" />);
    await user.click(screen.getByRole("button", { name: /upgrade to passkey/i }));

    const confirmBtn = screen.getAllByRole("button", { name: /upgrade to passkey/i })[1];
    fireEvent.click(confirmBtn);

    await waitFor(() => expect(createSpy).toHaveBeenCalledTimes(1));

    // The modal resets to idle — no error banner and the confirm button is enabled again.
    await waitFor(() => {
      // No error banner rendered.
      expect(screen.queryByRole("alert")).toBeNull();
    });
    // Confirm button is back and not in loading state.
    const resetBtn = screen.getAllByRole("button", { name: /upgrade to passkey/i })[1];
    expect(resetBtn).not.toBeDisabled();
    expect(resetBtn).toHaveAttribute("aria-busy", "false");
  });
});
