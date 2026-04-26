import { startRegistration, startAuthentication } from "@simplewebauthn/browser";
import type {
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
} from "@simplewebauthn/browser";

export interface PasskeyAuthResponse {
  ok: boolean;
  token: string;
  user: { id: string; email: string; name: string };
}

const BASE_URL = "/api";

async function post<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? "{}" : JSON.stringify(body),
  });
  const data = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  if (!res.ok) {
    const msg = (typeof data?.error === "string" ? data.error : null) || `HTTP ${res.status}`;
    const err = new Error(msg) as Error & { status: number };
    err.status = res.status;
    throw err;
  }
  return data as T;
}

interface BeginResponse {
  ok: boolean;
  session_id: string;
  publicKey: PublicKeyCredentialCreationOptionsJSON | PublicKeyCredentialRequestOptionsJSON;
}

/**
 * Run the full WebAuthn registration ceremony: server issues challenge,
 * browser shows Touch ID / Face ID / Windows Hello / hardware-key prompt,
 * server verifies the response and creates the user. Returns the JWT.
 */
export async function registerWithPasskey(name?: string): Promise<PasskeyAuthResponse> {
  const begin = await post<BeginResponse>("/auth/passkey/register-begin", { name });
  const credential = await startRegistration({
    optionsJSON: begin.publicKey as PublicKeyCredentialCreationOptionsJSON,
  });
  return post<PasskeyAuthResponse>("/auth/passkey/register-finish", {
    session_id: begin.session_id,
    credential,
  });
}

/**
 * Run the full WebAuthn authentication ceremony with a discoverable /
 * usernameless flow — the browser shows the user's saved passkeys for
 * this RP and they pick one. Returns the JWT.
 */
export async function loginWithPasskey(): Promise<PasskeyAuthResponse> {
  const begin = await post<BeginResponse>("/auth/passkey/login-begin");
  const credential = await startAuthentication({
    optionsJSON: begin.publicKey as PublicKeyCredentialRequestOptionsJSON,
  });
  return post<PasskeyAuthResponse>("/auth/passkey/login-finish", {
    session_id: begin.session_id,
    credential,
  });
}

/**
 * Combined "log in OR register if no passkey on this device yet" flow,
 * matching the wallet button's UX. Tries login first; if the browser
 * reports no available credential (or the server returns 401/404), falls
 * through to registration.
 */
export async function loginOrRegisterWithPasskey(): Promise<PasskeyAuthResponse> {
  try {
    return await loginWithPasskey();
  } catch (err) {
    const status = (err as { status?: number }).status;
    const name = (err as { name?: string }).name;
    const msg = err instanceof Error ? err.message : String(err);
    // NotAllowedError / AbortError = user dismissed the picker. Don't
    // automatically fall through to register — that would be surprising.
    if (name === "NotAllowedError" || name === "AbortError") {
      throw err;
    }
    if (status === 401 || status === 404 || msg.toLowerCase().includes("no account")) {
      return registerWithPasskey();
    }
    throw err;
  }
}
