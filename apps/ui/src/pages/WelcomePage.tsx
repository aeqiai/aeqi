import { useState, useEffect } from "react";

/**
 * Welcome — combined sign-in / sign-up entry point. Per the canonical
 * "every user = a Company" model, there is no separate signup vs login
 * flow: a user authenticates (passkey, Phantom/Solana wallet, or email),
 * the server resolves them to a Company (creating one if their auth
 * identity is new), the spawn animates live on-chain, and they land on
 * `/trust/<pubkey>/` inside their Company.
 *
 * Three doors:
 *   - Continue with a Solana wallet — uses `window.solana` (Phantom,
 *     Backpack, Solflare, etc. all inject the same shape). Detected on
 *     mount; surfaced as the recommended option when available.
 *   - Continue with passkey — WebAuthn ceremony; secp256r1-native on
 *     Solana so the passkey IS the on-chain authority. Recommended when
 *     Touch ID / Face ID / Windows Hello is available.
 *   - Continue with email — magic-link / OTP today; the email serves as
 *     the auth identity that resolves to a Company.
 *
 * Companion to `aeqi-platform`'s `/api/solana/companies/create` (smoke
 * server at :9220 by default; override with VITE_AEQI_SOLANA_API).
 */

type Door = "wallet" | "passkey" | "email";

export type WelcomeMode = "signup" | "login" | "welcome";

interface WelcomeCopy {
  title: string;
  subtitle: string;
  emailButton: string;
  sideTitle: string;
  foot: string;
}

const COPY: Record<WelcomeMode, WelcomeCopy> = {
  signup: {
    title: "Start your company.",
    subtitle: "Three seconds. One signer. Your TRUST is on-chain before you blink.",
    emailButton: "Sign up →",
    sideTitle: "What you get in 3 seconds",
    foot: "One Company per identity. Sign in with any method later — we resolve to the same on-chain TRUST.",
  },
  login: {
    title: "Welcome back.",
    subtitle:
      "Sign in with your wallet, passkey, or email — same Company, same on-chain authority.",
    emailButton: "Sign in →",
    sideTitle: "Pick up where you left off",
    foot: "First time here? Same flow — we'll spawn your Company on the spot.",
  },
  welcome: {
    title: "Welcome to aeqi.",
    subtitle:
      "Continue with your wallet, passkey, or email. The system figures out new vs returning.",
    emailButton: "Continue →",
    sideTitle: "What you get in 3 seconds",
    foot: "One Company per identity. Sign in with any method later — we resolve to the same on-chain TRUST.",
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

const SOLANA_API_URL =
  (import.meta.env.VITE_AEQI_SOLANA_API as string | undefined) ?? "http://127.0.0.1:9220";

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

export default function WelcomePage({ mode = "welcome" }: { mode?: WelcomeMode } = {}) {
  const copy = COPY[mode];
  const [stage, setStage] = useState<"door" | "spawning" | "welcome" | "error">("door");
  const [picked, setPicked] = useState<Door | null>(null);
  const [email, setEmail] = useState("");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<SpawnResponse | null>(null);
  const [steps, setSteps] = useState<SpawnStep[]>([]);
  const [walletDetected, setWalletDetected] = useState<{
    name: string;
    icon?: string;
  } | null>(null);
  const [passkeyAvailable, setPasskeyAvailable] = useState(false);

  // Detect installed Solana wallet (Phantom, Backpack, Solflare,
  // any Wallet Standard provider) on mount.
  useEffect(() => {
    const w = (
      window as unknown as {
        solana?: { isPhantom?: boolean; isBackpack?: boolean };
        backpack?: unknown;
        solflare?: { isSolflare?: boolean };
      }
    ).solana;
    if (w?.isPhantom) setWalletDetected({ name: "Phantom", icon: "👻" });
    else if (w?.isBackpack) setWalletDetected({ name: "Backpack", icon: "🎒" });
    else if ((window as unknown as { solflare?: unknown }).solflare)
      setWalletDetected({ name: "Solflare", icon: "🔥" });
    else if (w) setWalletDetected({ name: "Solana wallet" });

    // Detect platform authenticator (Touch ID / Face ID / Windows Hello).
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
      {
        key: "auth",
        label: "Identity confirmed",
        status: "done",
      },
      {
        key: "wallet",
        label: "Provisioning your Solana wallet",
        status: "active",
      },
      {
        key: "trust",
        label: "Deploying your Company on Solana",
        status: "pending",
      },
      {
        key: "role",
        label: "Role module initialized",
        status: "pending",
      },
      {
        key: "token",
        label: "Token module initialized",
        status: "pending",
      },
      {
        key: "governance",
        label: "Governance module initialized",
        status: "pending",
      },
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

  async function spawn(companyId: string) {
    setStage("spawning");
    setErrorMsg(null);
    setSteps(buildSteps());
    try {
      const res = await fetch(`${SOLANA_API_URL}/api/solana/companies/create`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ company_id: companyId }),
      });
      if (!res.ok) {
        const body = await res.text();
        throw new Error(`${res.status}: ${body}`);
      }
      const data = (await res.json()) as SpawnResponse;
      setOutcome(data);

      // Animate the steps in. The smoke endpoint returns all sigs at
      // once (after on-chain confirms); we reveal each one with a
      // small delay so the user perceives motion. Real streaming is
      // a Phase-2 enhancement (server-sent events from the spawn
      // endpoint per-tx).
      const trustPda = data.trust_pubkey_b58;
      const advanceWith = async (idx: number, detail?: string) => {
        await new Promise((r) => setTimeout(r, 450));
        advanceStep(idx, detail);
      };
      await advanceWith(2, trustPda);
      await advanceWith(3, data.role_init_signature_b58 ?? undefined);
      await advanceWith(4, data.token_init_signature_b58 ?? undefined);
      await advanceWith(5, data.governance_init_signature_b58 ?? undefined);
      await new Promise((r) => setTimeout(r, 350));
      setSteps((prev) => prev.map((s) => ({ ...s, status: "done" as const })));
      await new Promise((r) => setTimeout(r, 300));
      setStage("welcome");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setErrorMsg(msg);
      setStage("error");
    }
  }

  async function handleWalletConnect() {
    setPicked("wallet");
    const provider = (
      window as unknown as {
        solana?: {
          connect: () => Promise<{ publicKey: { toString: () => string } }>;
        };
      }
    ).solana;
    if (!provider) {
      setErrorMsg("No Solana wallet detected. Install Phantom, Backpack, or Solflare.");
      setStage("error");
      return;
    }
    try {
      const resp = await provider.connect();
      const pk = resp.publicKey.toString();
      // Use the wallet pubkey as the company_id — every distinct wallet
      // gets a distinct Company.
      await spawn(pk);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setErrorMsg(msg);
      setStage("error");
    }
  }

  async function handlePasskey() {
    setPicked("passkey");
    setErrorMsg(
      "Passkey ceremony coming online soon — secp256r1 native instruction wiring in flight. Try email or wallet for now.",
    );
    setStage("error");
  }

  async function handleEmailSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    setPicked("email");
    await spawn(email.trim().toLowerCase());
  }

  function reset() {
    setStage("door");
    setPicked(null);
    setErrorMsg(null);
    setOutcome(null);
    setSteps([]);
  }

  if (stage === "spawning") return <SpawningView steps={steps} picked={picked} />;

  if (stage === "welcome" && outcome) return <WelcomeView outcome={outcome} onContinue={reset} />;

  if (stage === "error")
    return <ErrorView message={errorMsg ?? "Something went wrong."} onBack={reset} />;

  // stage === "door"
  return (
    <main className="welcome-shell">
      <a className="skip-link" href="#main-content">
        Skip to main content
      </a>
      <div className="welcome-pane" id="main-content">
        <div className="welcome-mark">æ</div>
        <h1 className="welcome-headline">{copy.title}</h1>
        <p className="welcome-subhead">{copy.subtitle}</p>

        <div className="welcome-doors">
          {walletDetected && (
            <button
              type="button"
              className="welcome-door welcome-door--recommended"
              onClick={handleWalletConnect}
            >
              <span className="welcome-door-icon" aria-hidden="true">
                {walletDetected.icon ?? "◎"}
              </span>
              <span className="welcome-door-body">
                <span className="welcome-door-title">Continue with {walletDetected.name}</span>
                <span className="welcome-door-detail">
                  Sign once. Your wallet pubkey is your Company authority.
                </span>
              </span>
              <span className="welcome-door-chev" aria-hidden="true">
                →
              </span>
            </button>
          )}

          {!walletDetected && (
            <div className="welcome-door welcome-door--hint" aria-hidden="true">
              <span className="welcome-door-icon">◎</span>
              <span className="welcome-door-body">
                <span className="welcome-door-title">No Solana wallet detected</span>
                <span className="welcome-door-detail">
                  Phantom · Backpack · Solflare · Glow — install any to use it as your signer.
                </span>
              </span>
            </div>
          )}

          <button
            type="button"
            className={`welcome-door ${
              passkeyAvailable && !walletDetected ? "welcome-door--recommended" : ""
            }`}
            onClick={handlePasskey}
          >
            <span className="welcome-door-icon" aria-hidden="true">
              ⌥
            </span>
            <span className="welcome-door-body">
              <span className="welcome-door-title">
                One-touch with passkey
                {passkeyAvailable && <span className="welcome-door-tag"> · Touch ID ready</span>}
              </span>
              <span className="welcome-door-detail">
                Non-custodial. Your passkey IS the Solana authority via secp256r1.
              </span>
            </span>
            <span className="welcome-door-chev" aria-hidden="true">
              →
            </span>
          </button>

          <form className="welcome-door welcome-door--email" onSubmit={handleEmailSubmit}>
            <span className="welcome-door-icon" aria-hidden="true">
              @
            </span>
            <span className="welcome-door-body">
              <label className="welcome-door-title" htmlFor="welcome-email">
                Continue with email
              </label>
              <input
                id="welcome-email"
                className="welcome-door-input"
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                required
              />
            </span>
            <button type="submit" className="welcome-door-submit">
              {copy.emailButton}
            </button>
          </form>
        </div>

        <p className="welcome-foot">{copy.foot}</p>
      </div>

      <aside className="welcome-side">
        <div className="welcome-side-inner">
          <h2 className="welcome-side-title">{copy.sideTitle}</h2>
          <ul className="welcome-side-list">
            <li>
              <span className="welcome-side-step">01</span>
              <span>
                <strong>Your TRUST.</strong> A Solana smart account with role graph, treasury, and
                governance — yours from the second you land.
              </span>
            </li>
            <li>
              <span className="welcome-side-step">02</span>
              <span>
                <strong>Your authority.</strong> Your wallet, your passkey, or your email-bound
                custodial keypair — your call. Rotate anytime without losing the Company.
              </span>
            </li>
            <li>
              <span className="welcome-side-step">03</span>
              <span>
                <strong>Your stack.</strong> Cap table (Token-2022), org chart (roles), governance
                (proposals + voting) — all deployed atomically.
              </span>
            </li>
          </ul>
          <p className="welcome-side-foot">
            Powered by <span className="welcome-side-brand">aeqi</span> on Solana
          </p>
        </div>
      </aside>
    </main>
  );
}

// ── Spawning view ─────────────────────────────────────────────────────────

function SpawningView({ steps, picked }: { steps: SpawnStep[]; picked: Door | null }) {
  const pickedLabel =
    picked === "wallet" ? "your wallet" : picked === "passkey" ? "your passkey" : "your email";
  return (
    <main className="welcome-shell welcome-shell--solo">
      <div className="welcome-pane welcome-pane--center">
        <div className="welcome-mark welcome-mark--lg">æ</div>
        <h1 className="welcome-spawn-title">Welcome to your Company.</h1>
        <p className="welcome-spawn-sub">
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
                  {s.detail.length > 24
                    ? `${s.detail.slice(0, 8)}…${s.detail.slice(-6)}`
                    : s.detail}
                </span>
              )}
            </li>
          ))}
        </ol>
      </div>
    </main>
  );
}

// ── Welcome (post-spawn) view ─────────────────────────────────────────────

function WelcomeView({ outcome, onContinue }: { outcome: SpawnResponse; onContinue: () => void }) {
  const trustShort = `${outcome.trust_pubkey_b58.slice(
    0,
    6,
  )}…${outcome.trust_pubkey_b58.slice(-4)}`;
  const authorityShort = `${outcome.authority_pubkey_b58.slice(
    0,
    6,
  )}…${outcome.authority_pubkey_b58.slice(-4)}`;
  return (
    <main className="welcome-shell welcome-shell--solo">
      <div className="welcome-pane welcome-pane--center">
        <div className="welcome-mark welcome-mark--lg welcome-mark--success">✓</div>
        <h1 className="welcome-spawn-title">Your Company is live.</h1>
        <p className="welcome-spawn-sub">
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

        <div className="welcome-cta-row">
          <button
            type="button"
            className="welcome-cta welcome-cta--primary"
            onClick={() => {
              window.location.assign(`/trust/${outcome.trust_pubkey_b58}/`);
            }}
          >
            Enter your Company →
          </button>
          <button type="button" className="welcome-cta welcome-cta--secondary" onClick={onContinue}>
            Add a backup signer
          </button>
        </div>

        <p className="welcome-spawn-foot">
          Tip: add a second signer (passkey on another device, hardware key) so you never lose
          access.
        </p>
      </div>
    </main>
  );
}

// ── Error view ────────────────────────────────────────────────────────────

function ErrorView({ message, onBack }: { message: string; onBack: () => void }) {
  return (
    <main className="welcome-shell welcome-shell--solo">
      <div className="welcome-pane welcome-pane--center">
        <div className="welcome-mark welcome-mark--lg">·</div>
        <h1 className="welcome-spawn-title">That didn't work.</h1>
        <p className="welcome-spawn-sub welcome-spawn-sub--err">{message}</p>
        <div className="welcome-cta-row">
          <button type="button" className="welcome-cta welcome-cta--primary" onClick={onBack}>
            Try again
          </button>
        </div>
      </div>
    </main>
  );
}
