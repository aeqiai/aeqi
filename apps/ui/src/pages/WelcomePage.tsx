import { useState, useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAuthStore } from "@/store/auth";
import { goExternal } from "@/lib/navigation";
import { buildAuthSwitchHref, getRedirectAfterAuth } from "@/lib/redirectAfterAuth";
import {
  COPY,
  SOLANA_API_URL,
  type AccountSessionResponse,
  type Door,
  type SpawnStep,
  type WalletProvider,
  type WelcomeMode,
  type WelcomeStage,
} from "./welcome/types";
import {
  base58Encode,
  decodeCreateOptions,
  decodeRequestOptions,
  encodeAssertionCredential,
  encodeRegistrationCredential,
} from "./welcome/webauthn";
import {
  buildWelcomeSteps,
  persistWelcomeSession,
  verifyWelcomeEmailToken,
} from "./welcome/session";
import SecretLogin from "./welcome/SecretLogin";
import WelcomeAccountShell from "./welcome/WelcomeAccountShell";

export type { WelcomeMode } from "./welcome/types";

const PENDING_SIGNUP_NAME_KEY = "aeqi_pending_signup_name";

// Combined sign-in / sign-up entry point backed by `/api/auth/welcome/*`.
export default function WelcomePage({ mode = "welcome" }: { mode?: WelcomeMode } = {}) {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const copy = COPY[mode];
  const authSwitchHref = buildAuthSwitchHref(copy.switchHref, searchParams);
  const doorCopy = { ...copy, switchHref: authSwitchHref };

  // Auth-mode dispatch — self-hosters running with `[web.auth].mode = "secret"`
  // (the default) get a single passphrase form, NOT the email/OAuth flow.
  // The accounts flow is opt-in for multi-user teams. fetchAuthMode polls
  // /api/auth/mode on first render; the actual dispatch lives at the final
  // return so every hook in this component fires unconditionally
  // (rules-of-hooks).
  const authMode = useAuthStore((s) => s.authMode);
  const authModeLoaded = useAuthStore((s) => s.authModeLoaded);
  const fetchAuthMode = useAuthStore((s) => s.fetchAuthMode);
  const waitlistMode = useAuthStore((s) => s.waitlist);
  const handleOAuthCallback = useAuthStore((s) => s.handleOAuthCallback);
  useEffect(() => {
    if (!authModeLoaded) void fetchAuthMode();
  }, [authModeLoaded, fetchAuthMode]);
  useEffect(() => {
    if (authModeLoaded && authMode === "none") navigate("/", { replace: true });
  }, [authModeLoaded, authMode, navigate]);
  const [stage, setStage] = useState<WelcomeStage>("door");
  const [picked, setPicked] = useState<Door | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<AccountSessionResponse | null>(null);
  const [steps, setSteps] = useState<SpawnStep[]>([]);
  const [walletDetected, setWalletDetected] = useState<{ name: string } | null>(null);
  const [passkeyAvailable, setPasskeyAvailable] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  // URL invite wins; otherwise signup can carry a typed invite code.
  const [inviteInput, setInviteInput] = useState("");
  const getInviteCode = (): string | undefined => {
    const fromUrl = searchParams.get("invite");
    if (fromUrl) return fromUrl;
    const typed = inviteInput.trim();
    return typed || undefined;
  };
  const getSignupName = (): string | undefined => {
    if (mode !== "signup") return undefined;
    const name = displayName.trim();
    return name || undefined;
  };

  // OAuth hash landing path for Google + GitHub callbacks.
  useEffect(() => {
    if (!window.location.hash) return;
    const hashParams = new URLSearchParams(window.location.hash.slice(1));
    const token = hashParams.get("oauth_token");
    if (!token) return;
    const account = hashParams.get("account") ?? "";
    const wallet = hashParams.get("wallet") ?? hashParams.get("trust") ?? "";
    const isNew = hashParams.get("new") === "1";
    // Strip the fragment so refreshing doesn't replay.
    window.history.replaceState({}, "", window.location.pathname + window.location.search);
    setPicked("email");
    setErrorMsg(null);
    const synthetic: AccountSessionResponse & {
      session_jwt: string;
      session_expires_at: string;
    } = {
      account_id: account,
      user_id: account,
      wallet_pubkey_b58: wallet,
      company_id: null,
      trust_pubkey_b58: "",
      authority_pubkey_b58: wallet,
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
    void completeWelcomeAuth(synthetic);
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

  // Magic-link landing path for `/welcome?token=<hex>`.
  useEffect(() => {
    const token = searchParams.get("token");
    if (!token) return;
    // Strip the token from the URL so a back/refresh doesn't replay the
    // verify call (the token is single-use server-side anyway).
    const next = new URLSearchParams(searchParams);
    next.delete("token");
    const tokenName = next.get("name")?.trim() || "";
    next.delete("name");
    setSearchParams(next, { replace: true });

    setPicked("email");
    setStage("spawning");
    setErrorMsg(null);
    setSteps(buildWelcomeSteps());
    (async () => {
      try {
        const verify = await verifyWelcomeEmailToken(SOLANA_API_URL, token, tokenName);
        await completeWelcomeAuth(verify);
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

    document.title = "aeqi";
  }, [mode]);

  function advanceStep(idx: number, detail?: string) {
    setSteps((prev) =>
      prev.map((s, i) => {
        if (i < idx) return { ...s, status: "done" as const };
        if (i === idx) return { ...s, status: "active" as const, detail: detail ?? s.detail };
        return s;
      }),
    );
  }

  async function animateSpawn(data: AccountSessionResponse) {
    setOutcome(data);
    const tick = 450;
    const advanceWith = async (idx: number, detail?: string) => {
      await new Promise((r) => setTimeout(r, tick));
      advanceStep(idx, detail);
    };
    await advanceWith(1, data.wallet_pubkey_b58);
    await advanceWith(2);
    await new Promise((r) => setTimeout(r, tick));
    setSteps((prev) => prev.map((s) => ({ ...s, status: "done" as const })));
    await new Promise((r) => setTimeout(r, 300));
    setStage("welcome");
  }

  async function completeWelcomeAuth(
    data: AccountSessionResponse & { session_jwt: string; session_expires_at: string },
  ) {
    persistWelcomeSession(data, handleOAuthCallback);
    localStorage.removeItem(PENDING_SIGNUP_NAME_KEY);
    if (mode !== "signup" && data.already_existed) {
      navigate(getRedirectAfterAuth(searchParams), { replace: true });
      return;
    }
    setStage("spawning");
    setSteps(buildWelcomeSteps());
    await animateSpawn(data);
  }

  async function spawnViaWalletSiws(provider: WalletProvider, walletPubkey: string) {
    setStage("spawning");
    setErrorMsg(null);
    setSteps(buildWelcomeSteps());
    try {
      const inviteCode = getInviteCode();
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
          invite_code: inviteCode,
          name: getSignupName(),
        }),
      });
      if (!verifyRes.ok) {
        throw new Error(`wallet-verify ${verifyRes.status}: ${await verifyRes.text()}`);
      }
      const verify = (await verifyRes.json()) as AccountSessionResponse & {
        session_jwt: string;
        session_expires_at: string;
      };
      await completeWelcomeAuth(verify);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setErrorMsg(msg);
      setStage("error");
    }
  }

  // Send email-start and move to the code/magic-link redemption step.
  async function submitEmailForCode(emailAddress: string) {
    setStage("check-email");
    setErrorMsg(null);
    try {
      const inviteCode = getInviteCode();
      const name = getSignupName();
      if (name) localStorage.setItem(PENDING_SIGNUP_NAME_KEY, name);
      else localStorage.removeItem(PENDING_SIGNUP_NAME_KEY);
      const startRes = await fetch(`${SOLANA_API_URL}/api/auth/welcome/email-start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: emailAddress, invite_code: inviteCode, name }),
      });
      if (!startRes.ok) {
        // 403 with invite_code error → fall through to the waitlist
        // signup form. Invite-only users continue through signup; everyone
        // else can drop their email so we can follow up later.
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
        setSteps(buildWelcomeSteps());
        const magicLink = new URL(start.magic_link_url, window.location.origin);
        const verify = await verifyWelcomeEmailToken(
          SOLANA_API_URL,
          magicLink.searchParams.get("token") ?? "",
          magicLink.searchParams.get("name") ?? getSignupName(),
        );
        await completeWelcomeAuth(verify);
      }
      // Prod path: stays on "check-email" — user types the code or
      // clicks the magic link from their inbox.
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setErrorMsg(msg);
      setStage("error");
    }
  }

  // Verify the emailed 6-digit code, then continue through account setup.
  async function spawnViaEmailCode(emailAddress: string, code: string) {
    setStage("spawning");
    setErrorMsg(null);
    setSteps(buildWelcomeSteps());
    try {
      const verifyRes = await fetch(`${SOLANA_API_URL}/api/auth/welcome/email-verify-code`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: emailAddress, code, name: getSignupName() }),
      });
      if (!verifyRes.ok) {
        throw new Error(`verify-code ${verifyRes.status}: ${await verifyRes.text()}`);
      }
      const verify = (await verifyRes.json()) as AccountSessionResponse & {
        session_jwt: string;
        session_expires_at: string;
      };
      await completeWelcomeAuth(verify);
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
    setSteps(buildWelcomeSteps());
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
          const verify = (await verifyRes.json()) as AccountSessionResponse & {
            session_jwt: string;
            session_expires_at: string;
          };
          await completeWelcomeAuth(verify);
          return;
        }
      }

      const regStartRes = await fetch(`${SOLANA_API_URL}/api/auth/welcome/passkey-register-start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: getSignupName() }),
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
          invite_code: getInviteCode(),
          name: getSignupName(),
        }),
      });
      if (!finishRes.ok) {
        throw new Error(`register-finish ${finishRes.status}: ${await finishRes.text()}`);
      }
      const finish = (await finishRes.json()) as AccountSessionResponse & {
        session_jwt: string;
        session_expires_at: string;
      };
      await completeWelcomeAuth(finish);
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

  function startOAuth(provider: "google" | "github") {
    const inviteCode = getInviteCode();
    const qs = new URLSearchParams();
    if (inviteCode) qs.set("invite_code", inviteCode);
    const name = getSignupName();
    if (name) qs.set("name", name);
    const query = qs.toString() ? `?${qs.toString()}` : "";
    goExternal(`${SOLANA_API_URL}/api/auth/welcome/${provider}/start${query}`);
  }

  async function resendEmailCode() {
    const lower = email.trim().toLowerCase();
    const inviteCode = getInviteCode();
    await fetch(`${SOLANA_API_URL}/api/auth/welcome/email-start`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: lower,
        invite_code: inviteCode,
        name: getSignupName(),
      }),
    });
  }

  async function submitWaitlist(emailLower: string) {
    const res = await fetch(`${SOLANA_API_URL}/api/auth/waitlist`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: emailLower, _hp: "" }),
    });
    if (!res.ok) {
      throw new Error(`${res.status}: ${await res.text()}`);
    }
    setStage("waitlist-sent");
  }

  const shellProps = {
    authSwitchHref,
    copy: doorCopy,
    displayName,
    email,
    errorMsg,
    inviteFromUrl: searchParams.get("invite"),
    inviteInput,
    mode,
    outcome,
    passkeyAvailable,
    picked,
    setDisplayName,
    setEmail,
    setInviteInput,
    stage,
    steps,
    submitting,
    waitlistMode,
    walletDetected,
    onBack: reset,
    onEmailSubmit: handleEmailSubmit,
    onGoogle: () => startOAuth("google"),
    onGithub: () => startOAuth("github"),
    onPasskey: handlePasskey,
    onSwitch: () => navigate(authSwitchHref),
    onWaitlistSubmit: submitWaitlist,
    onWallet: handleWalletConnect,
    onEmailCodeSubmit: (code: string) => spawnViaEmailCode(email.trim().toLowerCase(), code),
    onEmailResend: resendEmailCode,
  };

  // Dispatch on auth mode AFTER all hooks above have run unconditionally.
  // Self-host default = "secret" → simple passphrase form. SaaS / multi-user
  // teams set "accounts" → fall through to the existing wallet/passkey/email
  // flow. "none" navigates to / via effect; render nothing while it fires.
  if (!authModeLoaded)
    return (
      <WelcomeAccountShell {...shellProps} authModeLoaded={false} onContinue={() => undefined} />
    );
  if (authMode === "secret") return <SecretLogin />;
  if (authMode === "none") return null;

  return (
    <WelcomeAccountShell
      {...shellProps}
      authModeLoaded
      onContinue={() =>
        navigate(outcome?.already_existed ? "/" : "/launch?blueprint=personal-os", {
          replace: true,
        })
      }
    />
  );
}
