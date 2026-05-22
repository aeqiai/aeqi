// Shared types + constants for the WelcomePage auth flow.

export type Door = "wallet" | "passkey" | "email";

export interface WalletProvider {
  isPhantom?: boolean;
  isBackpack?: boolean;
  connect: () => Promise<{ publicKey: { toString: () => string } }>;
  signMessage: (message: Uint8Array, encoding?: "utf8") => Promise<{ signature: Uint8Array }>;
}

export type WelcomeMode = "signup" | "login" | "welcome";

export type WelcomeStage =
  | "door"
  | "spawning"
  | "welcome"
  | "error"
  | "check-email"
  | "waitlist"
  | "waitlist-sent";

export interface WelcomeCopy {
  title: string;
  subtitle: string;
  switchLabel: string;
  switchHref: string;
  switchCta: string;
}

export const COPY: Record<WelcomeMode, WelcomeCopy> = {
  signup: {
    title: "Create your account",
    subtitle: "Use email, Google, GitHub, passkey, or wallet. We will set up your account wallet.",
    switchLabel: "Already have an account?",
    switchHref: "/login",
    switchCta: "Sign in",
  },
  login: {
    title: "Welcome back",
    subtitle:
      "Sign in with email, Google, GitHub, passkey, or wallet. Your account wallet stays the same.",
    switchLabel: "First time here?",
    switchHref: "/signup",
    switchCta: "Sign up",
  },
  welcome: {
    title: "Welcome to aeqi",
    subtitle: "Continue with email, Google, GitHub, passkey, or wallet.",
    switchLabel: "",
    switchHref: "",
    switchCta: "",
  },
};

export interface AccountSessionResponse {
  account_id?: string;
  user_id?: string;
  wallet_pubkey_b58?: string;
  company_id?: string | null;
  trust_id_hex?: string;
  trust_pubkey_b58?: string;
  authority_pubkey_b58?: string;
  already_existed: boolean;
  create_signature_b58?: string | null;
  role_init_signature_b58?: string | null;
  token_init_signature_b58?: string | null;
  governance_init_signature_b58?: string | null;
  role_module_pda_b58?: string;
  token_module_pda_b58?: string;
  governance_module_pda_b58?: string;
  role_module_state_pda_b58?: string;
  token_module_state_pda_b58?: string;
  governance_module_state_pda_b58?: string;
}

export interface SpawnStep {
  key: string;
  label: string;
  detail?: string;
  status: "pending" | "active" | "done";
}

// Empty default → relative URLs hit the current origin (hosted or local in
// prod, localhost dev in dev). Override with VITE_AEQI_SOLANA_API only
// when running the standalone smoke server on a non-default port.
export const SOLANA_API_URL = (import.meta.env.VITE_AEQI_SOLANA_API as string | undefined) ?? "";
