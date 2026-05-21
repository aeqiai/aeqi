import type { AccountSessionResponse, SpawnStep } from "./types";

export function buildWelcomeSteps(): SpawnStep[] {
  return [
    { key: "auth", label: "Identity confirmed", status: "done" },
    { key: "wallet", label: "Setting up your wallet", status: "active" },
    { key: "ready", label: "Entering AEQI", status: "pending" },
  ];
}

export async function verifyWelcomeEmailToken(solanaApiUrl: string, token: string, name?: string) {
  const verifyUrl = new URL(
    `${solanaApiUrl}/api/auth/welcome/email-verify`,
    window.location.origin,
  );
  verifyUrl.searchParams.set("token", token);
  if (name?.trim()) verifyUrl.searchParams.set("name", name.trim());
  const verifyRes = await fetch(verifyUrl.toString());
  if (!verifyRes.ok) {
    throw new Error(`email-verify ${verifyRes.status}: ${await verifyRes.text()}`);
  }
  return (await verifyRes.json()) as AccountSessionResponse & {
    session_jwt: string;
    session_expires_at: string;
  };
}

export function persistWelcomeSession(
  s: {
    session_jwt: string;
    account_id?: string;
    user_id?: string;
    wallet_pubkey_b58?: string;
    company_id?: string | null;
    session_expires_at: string;
  },
  handleOAuthCallback: (token: string) => void,
) {
  try {
    localStorage.setItem("aeqi_token", s.session_jwt);
    localStorage.setItem("aeqi_app_mode", "runtime");
    localStorage.setItem("aeqi_auth_mode", "accounts");
    localStorage.setItem("aeqi_session_jwt", s.session_jwt);
    if (s.account_id || s.user_id) {
      localStorage.setItem("aeqi_session_account_id", s.account_id ?? s.user_id ?? "");
    }
    if (s.wallet_pubkey_b58) {
      localStorage.setItem("aeqi_session_wallet_pubkey", s.wallet_pubkey_b58);
    }
    if (s.company_id) {
      localStorage.setItem("aeqi_session_company_id", s.company_id);
    } else {
      localStorage.removeItem("aeqi_session_company_id");
    }
    localStorage.setItem("aeqi_session_expires_at", s.session_expires_at);
    handleOAuthCallback(s.session_jwt);
  } catch {
    // Safari private mode etc. — non-fatal.
  }
}
