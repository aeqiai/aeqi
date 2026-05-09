import { useState, useEffect, useRef } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import Wordmark from "@/components/Wordmark";
import { Button, Input } from "@/components/ui";

/**
 * Welcome — combined sign-in / sign-up entry point. Per the canonical
 * "every user = a Company" model, there is no separate signup vs login
 * flow: a user authenticates (wallet, passkey, or email), the server
 * resolves them to a Company (creating one if their auth identity is
 * new), the spawn animates live on-chain, and they land on
 * `/trust/<pubkey>/` inside their Company.
 *
 * Companion to `aeqi-platform`'s `/api/auth/welcome/*` routes (served
 * relative to the current origin in prod; override with
 * VITE_AEQI_SOLANA_API for local smoke testing).
 */

type Door = "wallet" | "passkey" | "email";

interface WalletProvider {
  isPhantom?: boolean;
  isBackpack?: boolean;
  connect: () => Promise<{ publicKey: { toString: () => string } }>;
  signMessage: (message: Uint8Array, encoding?: "utf8") => Promise<{ signature: Uint8Array }>;
}

function b64uEncode(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < bytes.byteLength; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64uDecode(s: string): Uint8Array<ArrayBuffer> {
  const padded = s.replace(/-/g, "+").replace(/_/g, "/");
  const padLen = (4 - (padded.length % 4)) % 4;
  const decoded = atob(padded + "=".repeat(padLen));
  const bytes = new Uint8Array(new ArrayBuffer(decoded.length));
  for (let i = 0; i < decoded.length; i++) bytes[i] = decoded.charCodeAt(i);
  return bytes;
}

function decodeCreateOptions(ccr: Record<string, unknown>): PublicKeyCredentialCreationOptions {
  const pk = (ccr.publicKey ?? ccr) as Record<string, unknown>;
  const user = pk.user as Record<string, unknown>;
  const excludeRaw = (pk.excludeCredentials ?? []) as Array<{
    id: string;
    type: string;
    transports?: AuthenticatorTransport[];
  }>;
  return {
    challenge: b64uDecode(pk.challenge as string),
    rp: pk.rp as PublicKeyCredentialRpEntity,
    user: {
      id: b64uDecode(user.id as string),
      name: user.name as string,
      displayName: user.displayName as string,
    },
    pubKeyCredParams: pk.pubKeyCredParams as PublicKeyCredentialParameters[],
    timeout: pk.timeout as number | undefined,
    attestation: pk.attestation as AttestationConveyancePreference | undefined,
    authenticatorSelection: pk.authenticatorSelection as AuthenticatorSelectionCriteria | undefined,
    excludeCredentials: excludeRaw.map((c) => ({
      id: b64uDecode(c.id),
      type: "public-key" as const,
      transports: c.transports,
    })),
  };
}

function decodeRequestOptions(rcr: Record<string, unknown>): PublicKeyCredentialRequestOptions {
  const pk = (rcr.publicKey ?? rcr) as Record<string, unknown>;
  const allowRaw = (pk.allowCredentials ?? []) as Array<{
    id: string;
    type: string;
    transports?: AuthenticatorTransport[];
  }>;
  return {
    challenge: b64uDecode(pk.challenge as string),
    rpId: pk.rpId as string | undefined,
    timeout: pk.timeout as number | undefined,
    userVerification: pk.userVerification as UserVerificationRequirement | undefined,
    allowCredentials: allowRaw.map((c) => ({
      id: b64uDecode(c.id),
      type: "public-key" as const,
      transports: c.transports,
    })),
  };
}

function encodeRegistrationCredential(cred: PublicKeyCredential) {
  const att = cred.response as AuthenticatorAttestationResponse;
  return {
    id: cred.id,
    rawId: b64uEncode(cred.rawId),
    type: cred.type,
    response: {
      clientDataJSON: b64uEncode(att.clientDataJSON),
      attestationObject: b64uEncode(att.attestationObject),
    },
    extensions: cred.getClientExtensionResults?.() ?? {},
  };
}

function encodeAssertionCredential(cred: PublicKeyCredential) {
  const ass = cred.response as AuthenticatorAssertionResponse;
  return {
    id: cred.id,
    rawId: b64uEncode(cred.rawId),
    type: cred.type,
    response: {
      clientDataJSON: b64uEncode(ass.clientDataJSON),
      authenticatorData: b64uEncode(ass.authenticatorData),
      signature: b64uEncode(ass.signature),
      userHandle: ass.userHandle ? b64uEncode(ass.userHandle) : null,
    },
    extensions: cred.getClientExtensionResults?.() ?? {},
  };
}

function base58Encode(bytes: Uint8Array): string {
  const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let zeros = 0;
  while (zeros < bytes.length && bytes[zeros] === 0) zeros++;
  const digits: number[] = [];
  for (let i = zeros; i < bytes.length; i++) {
    let carry = bytes[i];
    for (let j = 0; j < digits.length; j++) {
      const v = digits[j] * 256 + carry;
      digits[j] = v % 58;
      carry = Math.floor(v / 58);
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = Math.floor(carry / 58);
    }
  }
  let out = "";
  for (let i = 0; i < zeros; i++) out += "1";
  for (let i = digits.length - 1; i >= 0; i--) out += ALPHABET[digits[i]];
  return out;
}

export type WelcomeMode = "signup" | "login" | "welcome";

interface WelcomeCopy {
  title: string;
  subtitle: string;
  switchLabel: string;
  switchHref: string;
  switchCta: string;
}

const COPY: Record<WelcomeMode, WelcomeCopy> = {
  signup: {
    title: "Start your company",
    subtitle: "Sign up with your wallet, passkey, or email.",
    switchLabel: "Already have an account?",
    switchHref: "/login",
    switchCta: "Sign in",
  },
  login: {
    title: "Welcome back",
    subtitle:
      "Sign in with your wallet, passkey, or email — same Company, same on-chain authority.",
    switchLabel: "First time here?",
    switchHref: "/signup",
    switchCta: "Sign up",
  },
  welcome: {
    title: "Welcome to aeqi",
    subtitle:
      "Continue with your wallet, passkey, or email. We'll spawn or resume your Company in seconds.",
    switchLabel: "",
    switchHref: "",
    switchCta: "",
  },
};

interface SpawnResponse {
  company_id: string;
  trust_id_hex: string;
  trust_pubkey_b58: string;
  authority_pubkey_b58: string;
  already_existed: boolean;
  create_signature_b58: string | null;
  role_init_signature_b58: string | null;
  token_init_signature_b58: string | null;
  governance_init_signature_b58: string | null;
  role_module_pda_b58: string;
  token_module_pda_b58: string;
  governance_module_pda_b58: string;
  role_module_state_pda_b58: string;
  token_module_state_pda_b58: string;
  governance_module_state_pda_b58: string;
}

interface SpawnStep {
  key: string;
  label: string;
  detail?: string;
  status: "pending" | "active" | "done";
}

// Empty default → relative URLs hit the current origin (app.aeqi.ai in
// prod, localhost dev in dev). Override with VITE_AEQI_SOLANA_API only
// when running the standalone smoke server on a non-default port.
const SOLANA_API_URL = (import.meta.env.VITE_AEQI_SOLANA_API as string | undefined) ?? "";

function SolanaIcon({ size = 16 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 397.7 311.7"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <path
        fill="currentColor"
        d="M64.6 237.9c2.4-2.4 5.7-3.8 9.2-3.8h317.4c5.8 0 8.7 7 4.6 11.1l-62.7 62.7c-2.4 2.4-5.7 3.8-9.2 3.8H6.5c-5.8 0-8.7-7-4.6-11.1l62.7-62.7zM64.6 3.8C67.1 1.4 70.4 0 73.8 0h317.4c5.8 0 8.7 7 4.6 11.1l-62.7 62.7c-2.4 2.4-5.7 3.8-9.2 3.8H6.5c-5.8 0-8.7-7-4.6-11.1L64.6 3.8zM333.1 120.1c-2.4-2.4-5.7-3.8-9.2-3.8H6.5c-5.8 0-8.7 7-4.6 11.1l62.7 62.7c2.4 2.4 5.7 3.8 9.2 3.8h317.4c5.8 0 8.7-7 4.6-11.1l-62.7-62.6z"
      />
    </svg>
  );
}

function PasskeyIcon({ size = 16 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <circle cx="9" cy="8" r="4" />
      <path d="M9 14c-2.8 0-5 1.5-5 4v2h6" />
      <path d="M19 12v8" />
      <path d="M16 16h6" />
      <path d="M16 19h3" />
    </svg>
  );
}

function GoogleIcon({ size = 16 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <path
        fill="#4285F4"
        d="M22.5 12.27c0-.79-.07-1.54-.2-2.27H12v4.51h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.55c2.08-1.92 3.28-4.74 3.28-8.33z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.55-2.77c-.98.66-2.24 1.06-3.73 1.06-2.87 0-5.3-1.94-6.17-4.55H2.18v2.86A11 11 0 0 0 12 23z"
      />
      <path
        fill="#FBBC05"
        d="M5.83 14.08a6.6 6.6 0 0 1 0-4.16V7.06H2.18a11 11 0 0 0 0 9.88l3.65-2.86z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.07.56 4.21 1.65l3.16-3.16C17.46 2.07 14.97 1 12 1A11 11 0 0 0 2.18 7.06l3.65 2.86C6.7 7.32 9.13 5.38 12 5.38z"
      />
    </svg>
  );
}

function GithubIcon({ size = 16 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <path d="M12 1.27a11 11 0 0 0-3.48 21.46c.55.1.75-.24.75-.53v-1.84c-3.06.66-3.7-1.47-3.7-1.47-.5-1.27-1.22-1.6-1.22-1.6-1-.68.07-.67.07-.67 1.1.08 1.69 1.13 1.69 1.13.98 1.69 2.58 1.2 3.21.92.1-.71.39-1.2.7-1.48-2.44-.28-5.01-1.22-5.01-5.43 0-1.2.43-2.18 1.13-2.95-.11-.27-.49-1.39.11-2.9 0 0 .92-.3 3.02 1.12a10.49 10.49 0 0 1 5.5 0c2.1-1.42 3.02-1.12 3.02-1.12.6 1.51.22 2.63.11 2.9.7.77 1.13 1.75 1.13 2.95 0 4.22-2.58 5.15-5.04 5.42.4.34.75 1.01.75 2.04v3.02c0 .29.2.64.76.53A11 11 0 0 0 12 1.27" />
    </svg>
  );
}

export default function WelcomePage({ mode = "welcome" }: { mode?: WelcomeMode } = {}) {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const copy = COPY[mode];
  const [stage, setStage] = useState<
    "door" | "spawning" | "welcome" | "error" | "check-email" | "waitlist" | "waitlist-sent"
  >("door");
  const [picked, setPicked] = useState<Door | null>(null);
  const [email, setEmail] = useState("");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<SpawnResponse | null>(null);
  const [steps, setSteps] = useState<SpawnStep[]>([]);
  const [walletDetected, setWalletDetected] = useState<{ name: string } | null>(null);
  const [passkeyAvailable, setPasskeyAvailable] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  /**
   * OAuth hash landing path: Google + GitHub callbacks redirect to
   * `/welcome#oauth_token=<jwt>&trust=<pubkey>&new=<0|1>`. The fragment
   * never reaches a webserver; the SPA reads it on mount, persists the
   * session, and either rolls into the spawn animation (new) or jumps
   * straight to /trust/<addr>/ (returning).
   */
  useEffect(() => {
    if (!window.location.hash) return;
    const hashParams = new URLSearchParams(window.location.hash.slice(1));
    const token = hashParams.get("oauth_token");
    const trust = hashParams.get("trust");
    if (!token || !trust) return;
    const isNew = hashParams.get("new") === "1";
    // Strip the fragment so refreshing doesn't replay.
    window.history.replaceState({}, "", window.location.pathname + window.location.search);
    setPicked("email");
    setErrorMsg(null);
    const synthetic: SpawnResponse & { session_jwt: string; session_expires_at: string } = {
      company_id: "",
      trust_pubkey_b58: trust,
      authority_pubkey_b58: "",
      already_existed: !isNew,
      session_jwt: token,
      session_expires_at: "",
      trust_id_hex: "",
      create_signature_b58: null,
      role_init_signature_b58: null,
      token_init_signature_b58: null,
      governance_init_signature_b58: null,
      role_module_pda_b58: "",
      token_module_pda_b58: "",
      governance_module_pda_b58: "",
      role_module_state_pda_b58: "",
      token_module_state_pda_b58: "",
      governance_module_state_pda_b58: "",
    };
    persistSession(synthetic);
    if (!isNew) {
      navigate(`/trust/${trust}/`, { replace: true });
      return;
    }
    setStage("spawning");
    setSteps(buildSteps());
    void animateSpawn(synthetic);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** OAuth error landing: ?oauth_error=<msg> from the callback. */
  useEffect(() => {
    const err = searchParams.get("oauth_error");
    if (!err) return;
    const next = new URLSearchParams(searchParams);
    next.delete("oauth_error");
    setSearchParams(next, { replace: true });
    setErrorMsg(`OAuth: ${err}`);
    setStage("error");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Magic-link landing path: when the user clicks the email link, they
   * arrive at `/welcome?token=<hex>`. Strip the token off the URL so the
   * page can be safely refreshed/shared, fire `email-verify` against the
   * platform with the raw token, persist the resulting session, and roll
   * straight into the spawn animation.
   */
  useEffect(() => {
    const token = searchParams.get("token");
    if (!token) return;
    // Strip the token from the URL so a back/refresh doesn't replay the
    // verify call (the token is single-use server-side anyway).
    const next = new URLSearchParams(searchParams);
    next.delete("token");
    setSearchParams(next, { replace: true });

    setPicked("email");
    setStage("spawning");
    setErrorMsg(null);
    setSteps(buildSteps());
    (async () => {
      try {
        const verifyRes = await fetch(
          `${SOLANA_API_URL}/api/auth/welcome/email-verify?token=${encodeURIComponent(token)}`,
        );
        if (!verifyRes.ok) {
          throw new Error(`email-verify ${verifyRes.status}: ${await verifyRes.text()}`);
        }
        const verify = (await verifyRes.json()) as SpawnResponse & {
          session_jwt: string;
          session_expires_at: string;
        };
        persistSession(verify);
        await animateSpawn(verify);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setErrorMsg(msg);
        setStage("error");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const w = (
      window as unknown as {
        solana?: { isPhantom?: boolean; isBackpack?: boolean };
        backpack?: unknown;
        solflare?: { isSolflare?: boolean };
      }
    ).solana;
    if (w?.isPhantom) setWalletDetected({ name: "Phantom" });
    else if (w?.isBackpack) setWalletDetected({ name: "Backpack" });
    else if ((window as unknown as { solflare?: unknown }).solflare)
      setWalletDetected({ name: "Solflare" });
    else if (w) setWalletDetected({ name: "Solana wallet" });

    if (window.PublicKeyCredential) {
      window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()
        .then((avail) => setPasskeyAvailable(avail))
        .catch(() => setPasskeyAvailable(false));
    }

    document.title =
      mode === "login" ? "Sign in · aeqi" : mode === "signup" ? "Sign up · aeqi" : "Welcome · aeqi";
  }, [mode]);

  function buildSteps(): SpawnStep[] {
    return [
      { key: "auth", label: "Identity confirmed", status: "done" },
      { key: "wallet", label: "Provisioning your Solana wallet", status: "active" },
      { key: "trust", label: "Deploying your Company on Solana", status: "pending" },
      { key: "role", label: "Role module initialized", status: "pending" },
      { key: "token", label: "Token module initialized", status: "pending" },
      { key: "governance", label: "Governance module initialized", status: "pending" },
    ];
  }

  function advanceStep(idx: number, detail?: string) {
    setSteps((prev) =>
      prev.map((s, i) => {
        if (i < idx) return { ...s, status: "done" as const };
        if (i === idx) return { ...s, status: "active" as const, detail: detail ?? s.detail };
        return s;
      }),
    );
  }

  async function animateSpawn(data: SpawnResponse) {
    setOutcome(data);
    // Returning users (already_existed=true) skip the spawn ceremony
    // entirely — there's nothing being provisioned, and the
    // "TRUST/Authority" addresses are jargon that means nothing to a
    // returning sign-in. Land them straight on /trust/<pubkey>/.
    if (data.already_existed) {
      navigate(`/trust/${data.trust_pubkey_b58}/`);
      return;
    }
    const trustPda = data.trust_pubkey_b58;
    const tick = 450;
    const advanceWith = async (idx: number, detail?: string) => {
      await new Promise((r) => setTimeout(r, tick));
      advanceStep(idx, detail);
    };
    await advanceWith(2, trustPda);
    await advanceWith(3, data.role_init_signature_b58 ?? undefined);
    await advanceWith(4, data.token_init_signature_b58 ?? undefined);
    await advanceWith(5, data.governance_init_signature_b58 ?? undefined);
    await new Promise((r) => setTimeout(r, tick));
    setSteps((prev) => prev.map((s) => ({ ...s, status: "done" as const })));
    await new Promise((r) => setTimeout(r, 300));
    setStage("welcome");
  }

  function persistSession(s: {
    session_jwt: string;
    company_id: string;
    session_expires_at: string;
  }) {
    try {
      // Canonical auth-store keys (read by store/auth.ts on boot). Writing
      // the welcome JWT here is what bridges welcome → rest-of-app: without
      // these keys the auth store treats the user as logged-out and bounces
      // every protected route to /login?next=… even though we just spawned
      // their company.
      localStorage.setItem("aeqi_token", s.session_jwt);
      localStorage.setItem("aeqi_app_mode", "runtime");
      localStorage.setItem("aeqi_auth_mode", "accounts");
      // Welcome-flow scope (kept for downstream surfaces that need
      // company_id specifically without re-decoding the JWT).
      localStorage.setItem("aeqi_session_jwt", s.session_jwt);
      localStorage.setItem("aeqi_session_company_id", s.company_id);
      localStorage.setItem("aeqi_session_expires_at", s.session_expires_at);
    } catch {
      // Safari private mode etc. — non-fatal.
    }
  }

  async function spawnViaWalletSiws(provider: WalletProvider, walletPubkey: string) {
    setStage("spawning");
    setErrorMsg(null);
    setSteps(buildSteps());
    try {
      const startRes = await fetch(`${SOLANA_API_URL}/api/auth/welcome/wallet-start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wallet_pubkey: walletPubkey }),
      });
      if (!startRes.ok) {
        throw new Error(`wallet-start ${startRes.status}: ${await startRes.text()}`);
      }
      const start = (await startRes.json()) as { message: string };
      const encoded = new TextEncoder().encode(start.message);
      const signed = await provider.signMessage(encoded, "utf8");
      const signatureB58 = base58Encode(signed.signature);
      const verifyRes = await fetch(`${SOLANA_API_URL}/api/auth/welcome/wallet-verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          wallet_pubkey: walletPubkey,
          message: start.message,
          signature_b58: signatureB58,
        }),
      });
      if (!verifyRes.ok) {
        throw new Error(`wallet-verify ${verifyRes.status}: ${await verifyRes.text()}`);
      }
      const verify = (await verifyRes.json()) as SpawnResponse & {
        session_jwt: string;
        session_expires_at: string;
      };
      persistSession(verify);
      await animateSpawn(verify);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setErrorMsg(msg);
      setStage("error");
    }
  }

  /**
   * Send email-start: the platform persists a magic-link token + 6-digit
   * code, mails BOTH to the user, and the SPA transitions to the "check
   * email" view. The user can either click the magic link in their inbox
   * (handled by the `?token=` useEffect on mount) OR paste / type the
   * 6-digit code into the OTP boxes (handled by `spawnViaEmailCode`).
   * Either path redeems the same row and lands on the same spawn flow.
   *
   * In dev (no SMTP backend), the platform inlines `magic_link_url` in
   * the response so the smoke test can auto-follow it. In prod that
   * field is absent and we wait for the user to act on the email.
   */
  async function submitEmailForCode(emailAddress: string) {
    setStage("check-email");
    setErrorMsg(null);
    try {
      const inviteCode = searchParams.get("invite") ?? undefined;
      const startRes = await fetch(`${SOLANA_API_URL}/api/auth/welcome/email-start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: emailAddress, invite_code: inviteCode }),
      });
      if (!startRes.ok) {
        // 403 with invite_code error → fall through to the waitlist
        // signup form. Closed beta is invite-only; everyone else gets
        // a chance to drop their email so we can email them later.
        if (startRes.status === 403) {
          const errBody = await startRes.text();
          if (/invite_code/i.test(errBody)) {
            setStage("waitlist");
            return;
          }
          throw new Error(errBody);
        }
        throw new Error(`email-start ${startRes.status}: ${await startRes.text()}`);
      }
      const start = (await startRes.json()) as { magic_link_url?: string };
      // Dev / smoke path: server returned the URL inline. Auto-follow.
      if (start.magic_link_url) {
        setStage("spawning");
        setSteps(buildSteps());
        const verifyRes = await fetch(start.magic_link_url);
        if (!verifyRes.ok) {
          throw new Error(`email-verify ${verifyRes.status}: ${await verifyRes.text()}`);
        }
        const verify = (await verifyRes.json()) as SpawnResponse & {
          session_jwt: string;
          session_expires_at: string;
        };
        persistSession(verify);
        await animateSpawn(verify);
      }
      // Prod path: stays on "check-email" — user types the code or
      // clicks the magic link from their inbox.
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setErrorMsg(msg);
      setStage("error");
    }
  }

  /**
   * Verify the 6-digit code from the email. Same downstream flow as the
   * magic link path: persist session, animate spawn, land on /trust/<pk>.
   */
  async function spawnViaEmailCode(emailAddress: string, code: string) {
    setStage("spawning");
    setErrorMsg(null);
    setSteps(buildSteps());
    try {
      const verifyRes = await fetch(`${SOLANA_API_URL}/api/auth/welcome/email-verify-code`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: emailAddress, code }),
      });
      if (!verifyRes.ok) {
        throw new Error(`verify-code ${verifyRes.status}: ${await verifyRes.text()}`);
      }
      const verify = (await verifyRes.json()) as SpawnResponse & {
        session_jwt: string;
        session_expires_at: string;
      };
      persistSession(verify);
      await animateSpawn(verify);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setErrorMsg(msg);
      setStage("error");
    }
  }

  async function handleWalletConnect() {
    setPicked("wallet");
    const provider = (window as unknown as { solana?: WalletProvider }).solana;
    if (!provider) {
      setErrorMsg("No Solana wallet detected. Install Phantom, Backpack, or Solflare.");
      setStage("error");
      return;
    }
    try {
      const resp = await provider.connect();
      const pk = resp.publicKey.toString();
      await spawnViaWalletSiws(provider, pk);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setErrorMsg(msg);
      setStage("error");
    }
  }

  async function handlePasskey() {
    setPicked("passkey");
    if (!window.PublicKeyCredential) {
      setErrorMsg("This browser doesn't support WebAuthn. Try Chrome, Safari, Edge, or Firefox.");
      setStage("error");
      return;
    }
    setStage("spawning");
    setErrorMsg(null);
    setSteps(buildSteps());
    try {
      const startRes = await fetch(`${SOLANA_API_URL}/api/auth/welcome/passkey-assert-start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!startRes.ok) {
        throw new Error(`assert-start ${startRes.status}: ${await startRes.text()}`);
      }
      const start = (await startRes.json()) as {
        ceremony_id: string;
        challenge: Record<string, unknown>;
      };
      const requestOptions = decodeRequestOptions(start.challenge);
      let assertion: PublicKeyCredential | null = null;
      try {
        assertion = (await navigator.credentials.get({
          publicKey: requestOptions,
        })) as PublicKeyCredential | null;
      } catch (e) {
        if ((e as DOMException)?.name !== "NotAllowedError") throw e;
      }

      if (assertion) {
        const verifyRes = await fetch(`${SOLANA_API_URL}/api/auth/welcome/passkey-assert-finish`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ceremony_id: start.ceremony_id,
            credential: encodeAssertionCredential(assertion),
          }),
        });
        if (verifyRes.ok) {
          const verify = (await verifyRes.json()) as SpawnResponse & {
            session_jwt: string;
            session_expires_at: string;
          };
          persistSession(verify);
          await animateSpawn(verify);
          return;
        }
      }

      const regStartRes = await fetch(`${SOLANA_API_URL}/api/auth/welcome/passkey-register-start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!regStartRes.ok) {
        throw new Error(`register-start ${regStartRes.status}: ${await regStartRes.text()}`);
      }
      const regStart = (await regStartRes.json()) as {
        ceremony_id: string;
        challenge: Record<string, unknown>;
      };
      const createOptions = decodeCreateOptions(regStart.challenge);
      const registration = (await navigator.credentials.create({
        publicKey: createOptions,
      })) as PublicKeyCredential | null;
      if (!registration) throw new Error("authenticator did not return a credential");

      const finishRes = await fetch(`${SOLANA_API_URL}/api/auth/welcome/passkey-register-finish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ceremony_id: regStart.ceremony_id,
          credential: encodeRegistrationCredential(registration),
        }),
      });
      if (!finishRes.ok) {
        throw new Error(`register-finish ${finishRes.status}: ${await finishRes.text()}`);
      }
      const finish = (await finishRes.json()) as SpawnResponse & {
        session_jwt: string;
        session_expires_at: string;
      };
      persistSession(finish);
      await animateSpawn(finish);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setErrorMsg(msg);
      setStage("error");
    }
  }

  async function handleEmailSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    setPicked("email");
    setSubmitting(true);
    try {
      await submitEmailForCode(email.trim().toLowerCase());
    } finally {
      setSubmitting(false);
    }
  }

  function reset() {
    setStage("door");
    setPicked(null);
    setErrorMsg(null);
    setOutcome(null);
    setSteps([]);
  }

  return (
    <main className="signup-split">
      <a className="skip-link" href="#main-content">
        Skip to main content
      </a>
      <div className="signup-form-side" id="main-content">
        <div className="auth-container" role="region" aria-live="polite">
          <div className="auth-logo">
            <Wordmark size={36} />
          </div>

          {stage === "door" && (
            <DoorView
              copy={copy}
              email={email}
              setEmail={setEmail}
              walletDetected={walletDetected}
              passkeyAvailable={passkeyAvailable}
              submitting={submitting}
              onEmailSubmit={handleEmailSubmit}
              onWallet={handleWalletConnect}
              onPasskey={handlePasskey}
              onGoogle={() => {
                window.location.href = `${SOLANA_API_URL}/api/auth/welcome/google/start`;
              }}
              onGithub={() => {
                window.location.href = `${SOLANA_API_URL}/api/auth/welcome/github/start`;
              }}
              onSwitch={() => navigate(copy.switchHref)}
            />
          )}

          {stage === "check-email" && (
            <CheckEmailView
              email={email}
              onCodeSubmit={(code) => spawnViaEmailCode(email.trim().toLowerCase(), code)}
              onResend={async () => {
                const lower = email.trim().toLowerCase();
                const inviteCode = searchParams.get("invite") ?? undefined;
                await fetch(`${SOLANA_API_URL}/api/auth/welcome/email-start`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ email: lower, invite_code: inviteCode }),
                });
              }}
              onBack={reset}
            />
          )}

          {stage === "spawning" && <SpawningView steps={steps} picked={picked} />}

          {stage === "welcome" && outcome && (
            <WelcomeView
              outcome={outcome}
              onContinue={() => navigate(`/trust/${outcome.trust_pubkey_b58}/`)}
            />
          )}

          {stage === "waitlist" && (
            <WaitlistView
              email={email}
              onSubmit={async (emailLower) => {
                const res = await fetch(`${SOLANA_API_URL}/api/auth/waitlist`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ email: emailLower, _hp: "" }),
                });
                if (!res.ok) {
                  throw new Error(`${res.status}: ${await res.text()}`);
                }
                setStage("waitlist-sent");
              }}
              onBack={reset}
            />
          )}

          {stage === "waitlist-sent" && <WaitlistSentView email={email} onBack={reset} />}

          {stage === "error" && (
            <ErrorView message={errorMsg ?? "Something went wrong."} onBack={reset} />
          )}

          <div className="auth-footer">
            <p>
              By continuing, you agree to the{" "}
              <a href="https://aeqi.ai/terms" target="_blank" rel="noopener noreferrer">
                Terms of Service
              </a>{" "}
              and{" "}
              <a href="https://aeqi.ai/privacy" target="_blank" rel="noopener noreferrer">
                Privacy Policy
              </a>
              .
            </p>
          </div>
        </div>
      </div>

      <aside className={`signup-pitch-side signup-pitch-side--${mode}`} aria-hidden="true">
        <div className="signup-pitch-scrim" />
        <div className="signup-pitch-content">
          {mode === "login" ? (
            <>
              <p className="signup-pitch-eyebrow">Welcome back</p>
              <h2 className="signup-pitch-heading">Your company is still running.</h2>
              <p className="signup-lead">
                Your TRUST, your roles, your treasury — exactly where you left them.
              </p>
            </>
          ) : (
            <>
              <p className="signup-pitch-eyebrow">aeqi · the company OS</p>
              <h2 className="signup-pitch-heading">Start something that can work without you.</h2>
              <p className="signup-lead">
                Build companies where humans set direction. Agents turn context into execution.
              </p>
            </>
          )}
        </div>
      </aside>
    </main>
  );
}

// ── Door view (initial three-door form) ───────────────────────────

interface DoorViewProps {
  copy: WelcomeCopy;
  email: string;
  setEmail: (s: string) => void;
  walletDetected: { name: string } | null;
  passkeyAvailable: boolean;
  submitting: boolean;
  onEmailSubmit: (e: React.FormEvent) => void;
  onWallet: () => void;
  onPasskey: () => void;
  onGoogle: () => void;
  onGithub: () => void;
  onSwitch: () => void;
}

function DoorView({
  copy,
  email,
  setEmail,
  walletDetected,
  passkeyAvailable,
  submitting,
  onEmailSubmit,
  onWallet,
  onPasskey,
  onGoogle,
  onGithub,
  onSwitch,
}: DoorViewProps) {
  return (
    <>
      <h1 className="auth-heading">{copy.title}</h1>
      <p className="auth-subheading">{copy.subtitle}</p>

      <form className="auth-form" onSubmit={onEmailSubmit} autoComplete="on">
        <Input
          size="lg"
          type="email"
          name="email"
          autoComplete="email"
          placeholder="Email address"
          aria-label="Email address"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoFocus
        />
        <Button
          variant="primary"
          size="lg"
          type="submit"
          fullWidth
          disabled={!email.trim() || submitting}
        >
          {submitting ? "Sending magic link…" : "Continue with email"}
        </Button>
      </form>

      <div className="auth-oauth-recess">
        <p className="auth-oauth-recess-label">Or</p>
        <div className="auth-oauth-group">
          <div className="auth-oauth-row">
            <Button variant="secondary" size="lg" fullWidth onClick={onGoogle} type="button">
              <GoogleIcon /> Google
            </Button>
            <Button variant="secondary" size="lg" fullWidth onClick={onGithub} type="button">
              <GithubIcon /> GitHub
            </Button>
          </div>
          {(walletDetected || passkeyAvailable) && (
            <div className="auth-oauth-row">
              {walletDetected && (
                <Button variant="secondary" size="lg" fullWidth onClick={onWallet} type="button">
                  <SolanaIcon /> {walletDetected.name}
                </Button>
              )}
              {passkeyAvailable && (
                <Button variant="secondary" size="lg" fullWidth onClick={onPasskey} type="button">
                  <PasskeyIcon /> Passkey
                </Button>
              )}
            </div>
          )}
        </div>
      </div>

      {copy.switchHref && copy.switchCta && (
        <p className="auth-switch">
          {copy.switchLabel}{" "}
          <a
            href={copy.switchHref}
            onClick={(e) => {
              e.preventDefault();
              onSwitch();
            }}
          >
            {copy.switchCta}
          </a>
        </p>
      )}
    </>
  );
}

// ── Check-email view: OTP boxes + magic-link copy ────────────────

/**
 * Two ways to get past this screen: paste / type the 6-digit code from
 * the email (auto-submits on the 6th digit) OR open the magic link in
 * the email on any device (mounts back into WelcomePage with `?token=`).
 * Cross-device: code + link are equivalent verifiers — either redeems
 * the same row, single-use enforced server-side.
 */
function CheckEmailView({
  email,
  onCodeSubmit,
  onResend,
  onBack,
}: {
  email: string;
  onCodeSubmit: (code: string) => void;
  onResend: () => Promise<void>;
  onBack: () => void;
}) {
  const [digits, setDigits] = useState<string[]>(["", "", "", "", "", ""]);
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);
  const [cooldownEndsAt, setCooldownEndsAt] = useState<number>(() => Date.now() + 60_000);
  const [now, setNow] = useState(() => Date.now());
  const [resending, setResending] = useState(false);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const remaining = Math.max(0, Math.ceil((cooldownEndsAt - now) / 1000));
  const canResend = remaining === 0 && !resending;

  const handleResend = async () => {
    if (!canResend) return;
    setResending(true);
    try {
      await onResend();
      setCooldownEndsAt(Date.now() + 60_000);
    } finally {
      setResending(false);
    }
  };

  const setDigit = (idx: number, value: string) => {
    const v = value.replace(/\D/g, "").slice(0, 1);
    setDigits((prev) => {
      const next = [...prev];
      next[idx] = v;
      // Auto-submit when all 6 boxes are filled.
      if (v && idx === 5 && next.every((d) => d.length === 1)) {
        // Defer to next tick so React commits the state before submit.
        setTimeout(() => onCodeSubmit(next.join("")), 0);
      }
      return next;
    });
    if (v && idx < 5) inputRefs.current[idx + 1]?.focus();
  };

  const onKeyDown = (idx: number) => (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Backspace" && !digits[idx] && idx > 0) {
      inputRefs.current[idx - 1]?.focus();
    }
  };

  const onPaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    const text = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6);
    if (!text) return;
    const next = ["", "", "", "", "", ""];
    for (let i = 0; i < text.length; i++) next[i] = text[i];
    setDigits(next);
    if (next.every((d) => d.length === 1)) {
      setTimeout(() => onCodeSubmit(next.join("")), 0);
    } else {
      inputRefs.current[Math.min(text.length, 5)]?.focus();
    }
  };

  return (
    <>
      <h1 className="auth-heading">Check your email</h1>
      <p className="auth-subheading">
        We sent a 6-digit code and a magic link to <strong>{email}</strong>. Type the code here, or
        open the link from any device.
      </p>
      <div
        className="verify-code-inputs"
        role="group"
        aria-label="Email verification code"
        onPaste={onPaste}
      >
        {digits.map((d, i) => (
          <input
            key={i}
            ref={(el) => {
              inputRefs.current[i] = el;
            }}
            className="verify-code-digit"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={1}
            value={d}
            onChange={(e) => setDigit(i, e.target.value)}
            onKeyDown={onKeyDown(i)}
            aria-label={`Digit ${i + 1}`}
            autoFocus={i === 0}
          />
        ))}
      </div>
      <div className="auth-resend-row">
        <Button
          variant="ghost"
          size="md"
          type="button"
          onClick={handleResend}
          disabled={!canResend}
        >
          {resending ? "Sending…" : canResend ? "Resend code" : `Resend in ${remaining}s`}
        </Button>
      </div>
      <Button variant="secondary" size="lg" fullWidth type="button" onClick={onBack}>
        Use a different method
      </Button>
    </>
  );
}

// ── Spawning view ────────────────────────────────────────────────

function SpawningView({ steps, picked }: { steps: SpawnStep[]; picked: Door | null }) {
  const pickedLabel =
    picked === "wallet" ? "your wallet" : picked === "passkey" ? "your passkey" : "your email";
  return (
    <>
      <h1 className="auth-heading">Welcome to your Company.</h1>
      <p className="auth-subheading">
        Authenticated with {pickedLabel}. Spawning your TRUST on Solana now.
      </p>
      <ol className="welcome-spawn-list">
        {steps.map((s) => (
          <li key={s.key} className={`welcome-spawn-step welcome-spawn-step--${s.status}`}>
            <span className="welcome-spawn-marker" aria-hidden="true">
              {s.status === "done" ? "✓" : s.status === "active" ? "•" : "·"}
            </span>
            <span className="welcome-spawn-label">{s.label}</span>
            {s.detail && (
              <span className="welcome-spawn-detail">
                {s.detail.length > 24 ? `${s.detail.slice(0, 8)}…${s.detail.slice(-6)}` : s.detail}
              </span>
            )}
          </li>
        ))}
      </ol>
    </>
  );
}

// ── Welcome (post-spawn) view ────────────────────────────────────

function WelcomeView({
  outcome: _outcome,
  onContinue,
}: {
  outcome: SpawnResponse;
  onContinue: () => void;
}) {
  return (
    <>
      <h1 className="auth-heading">Your company is live.</h1>
      <p className="auth-subheading">
        Roles, treasury, and governance are on-chain. Take it from here.
      </p>
      <div className="auth-form">
        <Button variant="primary" size="lg" fullWidth type="button" onClick={onContinue}>
          Enter your company →
        </Button>
      </div>
    </>
  );
}

// ── Error view ───────────────────────────────────────────────────

function ErrorView({ message, onBack }: { message: string; onBack: () => void }) {
  return (
    <>
      <h1 className="auth-heading">That didn't work.</h1>
      <p className="auth-subheading">{message}</p>
      <Button variant="primary" size="lg" fullWidth type="button" onClick={onBack}>
        Try again
      </Button>
    </>
  );
}

// ── Waitlist views ────────────────────────────────────────────────

/**
 * Closed-beta gate fallback. When email-start returns 403 because the
 * caller didn't carry a valid invite_code, the user lands here. POSTs
 * to /api/auth/waitlist; the backend dedupes by email, sends a
 * confirmation email with a click-to-confirm link.
 */
function WaitlistView({
  email,
  onSubmit,
  onBack,
}: {
  email: string;
  onSubmit: (email: string) => Promise<void>;
  onBack: () => void;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await onSubmit(email.trim().toLowerCase());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <h1 className="auth-heading">aeqi is in closed beta.</h1>
      <p className="auth-subheading">
        We'll add <strong>{email}</strong> to the waitlist and email you when it's your turn.
      </p>
      <form className="auth-form" onSubmit={handleSubmit} autoComplete="off">
        {/* Honeypot — hidden from humans, bots fill it. */}
        <input
          type="text"
          name="_hp"
          tabIndex={-1}
          autoComplete="off"
          style={{ position: "absolute", left: "-9999px", width: 1, height: 1 }}
          aria-hidden="true"
        />
        {error && <p className="auth-error">{error}</p>}
        <Button variant="primary" size="lg" type="submit" fullWidth disabled={submitting}>
          {submitting ? "Adding…" : "Add me to the waitlist"}
        </Button>
      </form>
      <Button variant="secondary" size="lg" fullWidth type="button" onClick={onBack}>
        Use a different method
      </Button>
    </>
  );
}

function WaitlistSentView({ email, onBack }: { email: string; onBack: () => void }) {
  return (
    <>
      <h1 className="auth-heading">You're on the list.</h1>
      <p className="auth-subheading">
        Check <strong>{email}</strong> for a confirmation link. We'll email you when an invite opens
        up.
      </p>
      <Button variant="secondary" size="lg" fullWidth type="button" onClick={onBack}>
        Done
      </Button>
    </>
  );
}
