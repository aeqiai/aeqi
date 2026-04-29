import { startRegistration, startAuthentication } from "@simplewebauthn/browser";
import type {
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
} from "@simplewebauthn/browser";
import { apiRequest } from "@/api/client";

export interface PasskeyAuthResponse {
  ok: boolean;
  token: string;
  user: { id: string; email: string; name: string };
}

async function post<T>(path: string, body?: unknown): Promise<T> {
  return apiRequest<T>(path, {
    method: "POST",
    body: body === undefined ? "{}" : JSON.stringify(body),
  });
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
    const name = (err as { name?: string }).name;
    // User-dismissed prompts shouldn't cascade into a registration attempt.
    if (name === "NotAllowedError" || name === "AbortError") {
      throw err;
    }
    // Anything else — server doesn't know us yet, no passkeys present on
    // this device, server returned an error on login-begin — fall through
    // to register and let the user create a fresh credential.
    return registerWithPasskey();
  }
}
