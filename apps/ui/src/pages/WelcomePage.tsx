import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
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
    subtitle: "Three seconds. One signer. Your TRUST is on-chain before you blink.",
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

const SOLSCAN_BASE =
  (import.meta.env.VITE_SOLSCAN_BASE as string | undefined) ?? "https://solscan.io";

const SOLSCAN_CLUSTER = (import.meta.env.VITE_SOLSCAN_CLUSTER as string | undefined) ?? "custom";

function solscanLink(kind: "tx" | "account", value: string): string {
  const path = kind === "tx" ? "tx" : "account";
  if (SOLSCAN_CLUSTER === "mainnet" || SOLSCAN_CLUSTER === "") {
    return `${SOLSCAN_BASE}/${path}/${value}`;
  }
  return `${SOLSCAN_BASE}/${path}/${value}?cluster=${SOLSCAN_CLUSTER}`;
}

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

export default function WelcomePage({ mode = "welcome" }: { mode?: WelcomeMode } = {}) {
  const navigate = useNavigate();
  const copy = COPY[mode];
  const [stage, setStage] = useState<"door" | "spawning" | "welcome" | "error" | "check-email">(
    "door",
  );
  const [picked, setPicked] = useState<Door | null>(null);
  const [email, setEmail] = useState("");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<SpawnResponse | null>(null);
  const [steps, setSteps] = useState<SpawnStep[]>([]);
  const [walletDetected, setWalletDetected] = useState<{ name: string } | null>(null);
  const [passkeyAvailable, setPasskeyAvailable] = useState(false);
  const [submitting, setSubmitting] = useState(false);

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
    const trustPda = data.trust_pubkey_b58;
    const tick = data.already_existed ? 120 : 450;
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

  async function spawnViaEmailMagicLink(emailAddress: string) {
    setStage("spawning");
    setErrorMsg(null);
    setSteps(buildSteps());
    try {
      const startRes = await fetch(`${SOLANA_API_URL}/api/auth/welcome/email-start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: emailAddress }),
      });
      if (!startRes.ok) {
        throw new Error(`email-start ${startRes.status}: ${await startRes.text()}`);
      }
      const start = (await startRes.json()) as { magic_link_url?: string };
      if (!start.magic_link_url) {
        // Real prod path — magic link sent via SMTP, no auto-follow.
        setStage("check-email");
        return;
      }
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
      await spawnViaEmailMagicLink(email.trim().toLowerCase());
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
              onSwitch={() => navigate(copy.switchHref)}
            />
          )}

          {stage === "check-email" && <CheckEmailView email={email} onBack={reset} />}

          {stage === "spawning" && <SpawningView steps={steps} picked={picked} />}

          {stage === "welcome" && outcome && (
            <WelcomeView
              outcome={outcome}
              onContinue={() => navigate(`/trust/${outcome.trust_pubkey_b58}/`)}
              onAddSigner={reset}
            />
          )}

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

      <div className="signup-pitch-side">
        <div className="signup-pitch-content">
          <h2 className="signup-pitch-heading">Start something that can work without you.</h2>
          <p className="signup-lead">
            Build companies where humans set direction. Agents turn context into execution.
          </p>
          <p className="signup-trust">Open source · Self-hostable · Free to start</p>
        </div>
      </div>
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
            <Button
              variant="secondary"
              size="lg"
              fullWidth
              onClick={onWallet}
              type="button"
              disabled={!walletDetected}
            >
              <SolanaIcon /> {walletDetected ? walletDetected.name : "No wallet detected"}
            </Button>
            <Button
              variant="secondary"
              size="lg"
              fullWidth
              onClick={onPasskey}
              type="button"
              disabled={!passkeyAvailable}
            >
              <PasskeyIcon /> Passkey
            </Button>
          </div>
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

// ── Check-email view (real prod, no auto-follow) ─────────────────

function CheckEmailView({ email, onBack }: { email: string; onBack: () => void }) {
  return (
    <>
      <h1 className="auth-heading">Check your email</h1>
      <p className="auth-subheading">
        We sent a magic link to <strong>{email}</strong>. Open it on this device to continue.
      </p>
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
  outcome,
  onContinue,
  onAddSigner,
}: {
  outcome: SpawnResponse;
  onContinue: () => void;
  onAddSigner: () => void;
}) {
  const trustShort = `${outcome.trust_pubkey_b58.slice(0, 6)}…${outcome.trust_pubkey_b58.slice(-4)}`;
  const authorityShort = `${outcome.authority_pubkey_b58.slice(0, 6)}…${outcome.authority_pubkey_b58.slice(-4)}`;
  return (
    <>
      <h1 className="auth-heading">Your Company is live.</h1>
      <p className="auth-subheading">
        {outcome.already_existed
          ? "Welcome back — your TRUST is exactly where you left it."
          : "Authority pubkey + role + token + governance modules are on-chain."}
      </p>

      <dl className="welcome-summary">
        <div className="welcome-summary-row">
          <dt>TRUST</dt>
          <dd>
            <a
              href={solscanLink("account", outcome.trust_pubkey_b58)}
              target="_blank"
              rel="noopener noreferrer"
              className="welcome-summary-link"
            >
              {trustShort} ↗
            </a>
          </dd>
        </div>
        <div className="welcome-summary-row">
          <dt>Authority</dt>
          <dd>
            <a
              href={solscanLink("account", outcome.authority_pubkey_b58)}
              target="_blank"
              rel="noopener noreferrer"
              className="welcome-summary-link"
            >
              {authorityShort} ↗
            </a>
          </dd>
        </div>
      </dl>

      <div className="auth-form">
        <Button variant="primary" size="lg" fullWidth type="button" onClick={onContinue}>
          Enter your Company →
        </Button>
        <Button variant="secondary" size="lg" fullWidth type="button" onClick={onAddSigner}>
          Add a backup signer later
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
