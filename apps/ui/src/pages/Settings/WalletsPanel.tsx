import { useEffect, useState } from "react";
import { useAccount, useChainId, useDisconnect, useSignMessage } from "wagmi";
import { useConnectModal } from "@rainbow-me/rainbowkit";
import { api } from "@/lib/api";
import { Button, ConfirmDialog } from "@/components/ui";
import { buildSiweMessage, fetchNonce } from "@/lib/walletAuth";

interface WalletRow {
  id: string;
  address: string;
  custody_state: "custodial" | "co_custody" | "self_custody";
  is_primary: boolean;
  added_at: string;
}

interface MeResponse {
  wallets?: WalletRow[];
}

type Feedback = { type: "success" | "error"; msg: string } | null;

const BASE_URL = "/api";

async function authedJson<T>(method: string, path: string, body?: unknown): Promise<T> {
  const token = localStorage.getItem("aeqi_token");
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  if (!res.ok) {
    const msg = (typeof data?.error === "string" ? data.error : null) || `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return data as T;
}

function shorten(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

/**
 * Settings → Wallets. Lists every `user_wallets` row for the account,
 * exposes the management actions (set primary, remove, link external),
 * and offers a "link external wallet" button that runs SIWE against
 * `/api/me/wallets/link` to attach a wallet the user already controls.
 */
export default function WalletsPanel() {
  const [wallets, setWallets] = useState<WalletRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [linking, setLinking] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [removeBusy, setRemoveBusy] = useState(false);

  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const { signMessageAsync } = useSignMessage();
  const { disconnect } = useDisconnect();
  const { openConnectModal } = useConnectModal();

  async function refresh() {
    setLoading(true);
    try {
      const data = (await api.getMe()) as MeResponse;
      setWallets(data.wallets || []);
    } catch (e) {
      setFeedback({ type: "error", msg: e instanceof Error ? e.message : "Load failed" });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  async function setPrimary(id: string) {
    setFeedback(null);
    try {
      await authedJson<{ ok: boolean }>("PUT", `/me/wallets/${id}/primary`);
      await refresh();
      setFeedback({ type: "success", msg: "Primary wallet updated." });
    } catch (e) {
      setFeedback({ type: "error", msg: e instanceof Error ? e.message : "Update failed" });
    }
  }

  function askRemove(id: string) {
    setRemovingId(id);
  }

  async function performRemove() {
    if (!removingId) return;
    setRemoveBusy(true);
    setFeedback(null);
    try {
      await authedJson<{ ok: boolean }>("DELETE", `/me/wallets/${removingId}`);
      await refresh();
      setFeedback({ type: "success", msg: "Wallet removed." });
    } catch (e) {
      setFeedback({ type: "error", msg: e instanceof Error ? e.message : "Remove failed" });
    } finally {
      setRemoveBusy(false);
      setRemovingId(null);
    }
  }

  async function linkExternal() {
    if (!address) {
      openConnectModal?.();
      return;
    }
    setLinking(true);
    setFeedback(null);
    try {
      const { nonce, domain } = await fetchNonce();
      const message = buildSiweMessage({
        domain,
        address,
        nonce,
        chainId,
        uri: window.location.origin,
        statement: "Link this wallet to your aeqi account",
      });
      const signature = await signMessageAsync({ message });
      await authedJson<{ ok: boolean; address: string }>("POST", "/me/wallets/link", {
        message,
        signature,
      });
      await refresh();
      setFeedback({ type: "success", msg: "Wallet linked." });
      disconnect();
    } catch (e) {
      const name = (e as { name?: string }).name;
      if (name !== "NotAllowedError" && name !== "AbortError") {
        setFeedback({ type: "error", msg: e instanceof Error ? e.message : "Link failed" });
      }
    } finally {
      setLinking(false);
    }
  }

  // After RainbowKit closes with a connection, run linking automatically if
  // the user clicked "Link external wallet" first (we set a sessionStorage
  // flag at click time so we don't auto-link on every page load).
  useEffect(() => {
    if (linking || !isConnected || !address) return;
    const flag = sessionStorage.getItem("aeqi:wallet-link-pending");
    if (flag === "1") {
      sessionStorage.removeItem("aeqi:wallet-link-pending");
      void linkExternal();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isConnected, address]);

  function startLink() {
    sessionStorage.setItem("aeqi:wallet-link-pending", "1");
    if (isConnected && address) {
      void linkExternal();
    } else {
      openConnectModal?.();
    }
  }

  return (
    <>
      <div className="account-field-lg">
        <label className="account-field-label">Wallets</label>
        <p className="account-field-desc">
          Every aeqi account has at least one custodial wallet provisioned for you. Link an external
          wallet (MetaMask, Rabby, Coinbase, hardware) to add it as a login + signing option.
        </p>

        {feedback && (
          <div className={feedback.type === "error" ? "auth-error" : "account-feedback-success"}>
            {feedback.msg}
          </div>
        )}

        {loading && <div className="account-activity-empty">Loading…</div>}
        {!loading && wallets.length === 0 && (
          <div className="account-activity-empty">No wallets yet.</div>
        )}

        {wallets.length > 0 && (
          <div className="account-device-list">
            {wallets.map((w) => (
              <div
                key={w.id}
                className={`account-device-item ${w.is_primary ? "account-device-current" : ""}`}
              >
                <div className="account-device-icon" aria-hidden="true">
                  <svg viewBox="0 0 48 48" width="44" height="44" aria-hidden="true">
                    <rect
                      x="6"
                      y="13"
                      width="36"
                      height="24"
                      rx="3"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.6"
                    />
                    <path
                      d="M6 19 H38 a4 4 0 0 1 4 4 v6 a4 4 0 0 1 -4 4 H6"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.6"
                      strokeLinejoin="round"
                    />
                    <circle cx="35" cy="26" r="1.6" fill="currentColor" />
                  </svg>
                </div>
                <div className="account-device-body">
                  <div className="account-device-title">
                    {shorten(w.address)}
                    {w.is_primary && <span className="account-device-badge">Primary</span>}
                  </div>
                  <div className="account-device-meta">{w.custody_state.replace("_", "-")}</div>
                </div>
                <div className="account-device-actions">
                  {!w.is_primary && (
                    <Button
                      variant="ghost"
                      size="sm"
                      type="button"
                      onClick={() => setPrimary(w.id)}
                    >
                      Set primary
                    </Button>
                  )}
                  {!w.is_primary && (
                    <Button variant="ghost" size="sm" type="button" onClick={() => askRemove(w.id)}>
                      Remove
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        <Button variant="secondary" size="md" type="button" onClick={startLink} loading={linking}>
          Link external wallet
        </Button>

        <ConfirmDialog
          open={removingId !== null}
          onClose={() => (removeBusy ? null : setRemovingId(null))}
          onConfirm={performRemove}
          title="Remove wallet"
          confirmLabel="Remove"
          destructive
          loading={removeBusy}
          message={
            <p>
              This unlinks the wallet from your account. Future logins with this wallet will be
              rejected. You can re-link it later.
            </p>
          }
        />
      </div>
    </>
  );
}
