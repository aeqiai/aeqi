import { create } from "zustand";
import { api } from "@/lib/api";
import { useUIStore } from "@/store/ui";
import { clearSessionData } from "@/lib/session";

export type AuthMode = "none" | "secret" | "accounts" | null;

/** Set the active company from a server response into both localStorage and Zustand. */
function applyCompany(companies?: string[], explicit?: string) {
  const name = explicit || (companies && companies.length > 0 ? companies[0] : null);
  if (name) {
    useUIStore.getState().setActiveCompany(name);
  }
}

interface User {
  id: string;
  email: string;
  name: string;
  avatar_url?: string;
  email_verified?: boolean;
  companies?: string[];
}

interface AuthState {
  token: string | null;
  authMode: AuthMode;
  googleOAuth: boolean;
  githubOAuth: boolean;
  waitlist: boolean;
  user: User | null;
  loading: boolean;
  error: string | null;
  pendingEmail: string | null; // email awaiting verification
  authModeLoaded: boolean;

  fetchAuthMode: () => Promise<void>;
  login: (secret: string) => Promise<boolean>;
  loginWithEmail: (email: string, password: string) => Promise<"ok" | "unverified" | "2fa" | "totp" | "error">;
  signup: (email: string, password: string, name: string, inviteCode?: string) => Promise<"verified" | "pending" | "error">;
  verifyEmail: (email: string, code: string) => Promise<boolean>;
  resendCode: (email: string) => Promise<boolean>;
  verify2fa: (email: string, code: string) => Promise<boolean>;
  verifyTotp: (email: string, code: string) => Promise<boolean>;
  resend2fa: (email: string) => Promise<boolean>;
  pending2faEmail: string | null;
  handleOAuthCallback: (token: string) => void;
  fetchMe: () => Promise<void>;
  logout: () => void;
  isAuthenticated: () => boolean;
  needsOnboarding: () => boolean;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  token: localStorage.getItem("aeqi_token"),
  authMode: (localStorage.getItem("aeqi_auth_mode") as AuthMode) || null,
  googleOAuth: false,
  githubOAuth: false,
  waitlist: false,
  user: null,
  loading: false,
  error: null,
  pendingEmail: null,
  pending2faEmail: null,
  authModeLoaded: false,

  fetchAuthMode: async () => {
    if (get().authModeLoaded) return;
    try {
      const resp = await api.getAuthMode();
      const mode = (resp.mode || "secret") as AuthMode;
      localStorage.setItem("aeqi_auth_mode", mode || "secret");
      set({ authMode: mode, googleOAuth: resp.google_oauth, githubOAuth: resp.github_oauth, waitlist: resp.waitlist, authModeLoaded: true });

      if (mode === "none" && !get().token) {
        try {
          const loginResp = await api.login("");
          if (loginResp.ok && loginResp.token) {
            clearSessionData();
            localStorage.setItem("aeqi_token", loginResp.token);
            set({ token: loginResp.token });
          }
        } catch {
          set({ token: "none" });
        }
      }
    } catch {
      set({ authMode: "secret", authModeLoaded: true });
    }
  },

  login: async (secret: string) => {
    set({ loading: true, error: null });
    try {
      const resp = await api.login(secret);
      if (resp.ok && resp.token) {
        clearSessionData();
        localStorage.setItem("aeqi_token", resp.token);
        set({ token: resp.token, loading: false });
        return true;
      }
      set({ loading: false, error: "Invalid secret" });
      return false;
    } catch {
      set({ loading: false, error: "Login failed" });
      return false;
    }
  },

  loginWithEmail: async (email: string, password: string) => {
    set({ loading: true, error: null });
    try {
      const resp = await api.loginWithEmail(email, password);
      if (resp.ok && (resp as Record<string, unknown>).pending_totp) {
        const maskedEmail = resp.email || email;
        set({ loading: false, pending2faEmail: maskedEmail });
        return "totp";
      }
      if (resp.ok && resp.pending_2fa) {
        const maskedEmail = resp.email || email;
        set({ loading: false, pending2faEmail: maskedEmail });
        return "2fa";
      }
      if (resp.ok && resp.token) {
        clearSessionData();
        localStorage.setItem("aeqi_token", resp.token);
        const user = (resp.user as User | undefined) || null;
        set({ token: resp.token, user, loading: false });
        applyCompany(user?.companies);
        return "ok";
      }
      set({ loading: false, error: "Invalid email or password" });
      return "error";
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Login failed";
      if (msg.includes("not verified")) {
        clearSessionData();
        localStorage.setItem("aeqi_pending_email", email);
        set({ token: null, loading: false, pendingEmail: email });
        return "unverified";
      }
      set({ loading: false, error: msg });
      return "error";
    }
  },

  signup: async (email: string, password: string, name: string, inviteCode?: string) => {
    set({ loading: true, error: null });
    try {
      clearSessionData();
      const resp = await api.signup(email, password, name, inviteCode);
      // Backend auto-creates a company (named after user's first name) + agent on signup.
      const company = (resp as Record<string, unknown>).company as string | undefined;
      if (resp.ok && resp.pending_verification) {
        if (resp.token) {
          localStorage.setItem("aeqi_token", resp.token);
          localStorage.setItem("aeqi_pending_email", email);
          set({ token: resp.token, user: (resp.user as User | undefined) || null, loading: false, pendingEmail: email });
        } else {
          set({ loading: false, pendingEmail: email });
        }
        applyCompany(undefined, company);
        return "pending";
      }
      if (resp.ok && resp.token) {
        localStorage.setItem("aeqi_token", resp.token);
        set({ token: resp.token, user: (resp.user as User | undefined) || null, loading: false });
        applyCompany(undefined, company);
        return "verified";
      }
      set({ loading: false, error: "Signup failed" });
      return "error";
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Signup failed";
      set({ loading: false, error: msg });
      return "error";
    }
  },

  verifyEmail: async (email: string, code: string) => {
    set({ loading: true, error: null });
    try {
      const resp = await api.verifyEmail(email, code);
      if (resp.ok && resp.token) {
        localStorage.setItem("aeqi_token", resp.token);
        const user = (resp.user as User | undefined) || null;
        set({ token: resp.token, user, loading: false, pendingEmail: null });
        // Company was already set during signup — don't wipe it.
        // If user object has companies, ensure one is selected.
        if (user?.companies) applyCompany(user.companies);
        return true;
      }
      set({ loading: false, error: "Invalid or expired code" });
      return false;
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Verification failed";
      set({ loading: false, error: msg });
      return false;
    }
  },

  resendCode: async (email: string) => {
    try {
      await api.resendCode(email);
      return true;
    } catch {
      return false;
    }
  },

  verify2fa: async (email: string, code: string) => {
    set({ loading: true, error: null });
    try {
      const resp = await api.verify2fa(email, code);
      if (resp.ok && resp.token) {
        clearSessionData();
        localStorage.setItem("aeqi_token", resp.token);
        const user = (resp.user as User | undefined) || null;
        set({ token: resp.token, user, loading: false, pending2faEmail: null });
        applyCompany(user?.companies);
        return true;
      }
      set({ loading: false, error: "Invalid or expired code" });
      return false;
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Verification failed";
      set({ loading: false, error: msg });
      return false;
    }
  },

  verifyTotp: async (email: string, code: string) => {
    set({ loading: true, error: null });
    try {
      const resp = await api.loginTotp(email, code);
      if ((resp as Record<string, unknown>).ok && (resp as Record<string, unknown>).token) {
        clearSessionData();
        localStorage.setItem("aeqi_token", (resp as Record<string, unknown>).token as string);
        const user = ((resp as Record<string, unknown>).user as User | undefined) || null;
        set({ token: (resp as Record<string, unknown>).token as string, user, loading: false, pending2faEmail: null });
        applyCompany(user?.companies);
        return true;
      }
      set({ loading: false, error: "Invalid or expired code" });
      return false;
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Verification failed";
      set({ loading: false, error: msg });
      return false;
    }
  },

  resend2fa: async (email: string) => {
    try {
      await api.resend2fa(email);
      return true;
    } catch {
      return false;
    }
  },

  handleOAuthCallback: (token: string) => {
    clearSessionData();
    localStorage.setItem("aeqi_token", token);
    set({ token });
    // Fetch user profile to get companies — OAuth doesn't return user inline.
    get().fetchMe().then(() => {
      const user = get().user;
      if (user?.companies) applyCompany(user.companies);
    });
  },

  fetchMe: async () => {
    try {
      const data = await api.getMe();
      set({ user: data as unknown as User });
    } catch {
      // Not critical.
    }
  },

  logout: () => {
    clearSessionData();
    localStorage.removeItem("aeqi_auth_mode");
    useUIStore.getState().setActiveCompany("");
    set({ token: null, user: null, pendingEmail: null, pending2faEmail: null, authMode: null, authModeLoaded: false });
  },

  isAuthenticated: () => {
    const { authMode, token } = get();
    if (authMode === "none") return true;
    return !!token;
  },

  needsOnboarding: () => {
    const { user } = get();
    if (!user) return false;
    return !user.companies || user.companies.length === 0;
  },

}));
