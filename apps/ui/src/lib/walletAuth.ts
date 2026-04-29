import type { Hex } from "viem";
import { apiRequest } from "@/api/client";

export interface NonceResponse {
  ok: boolean;
  nonce: string;
  expires_in_seconds: number;
  domain: string;
}

export interface WalletAuthResponse {
  ok: boolean;
  token: string;
  user: { id: string; email: string; name: string };
  primary_wallet?: string;
}

async function request<T>(path: string, body?: unknown): Promise<T> {
  return apiRequest<T>(path, {
    method: "POST",
    body: body === undefined ? "{}" : JSON.stringify(body),
  });
}

/**
 * Build a canonical EIP-4361 SIWE message string. Mirrors
 * `aeqi_wallets::siwe::canonical_message` on the backend so the
 * server-side parser accepts what we sign.
 */
export function buildSiweMessage(args: {
  domain: string;
  address: string; // already EIP-55 checksummed by wagmi/viem
  nonce: string;
  chainId: number;
  uri: string;
  statement?: string;
  issuedAt?: Date;
}): string {
  const issuedAt = (args.issuedAt ?? new Date()).toISOString();
  const statement = args.statement ?? "Sign in to aeqi";
  return [
    `${args.domain} wants you to sign in with your Ethereum account:`,
    args.address,
    "",
    statement,
    "",
    `URI: ${args.uri}`,
    `Version: 1`,
    `Chain ID: ${args.chainId}`,
    `Nonce: ${args.nonce}`,
    `Issued At: ${issuedAt}`,
  ].join("\n");
}

export async function fetchNonce(): Promise<NonceResponse> {
  return request<NonceResponse>("/auth/wallet/nonce");
}

export async function loginWithWallet(
  message: string,
  signature: Hex,
): Promise<WalletAuthResponse> {
  return request<WalletAuthResponse>("/auth/wallet/login", { message, signature });
}

export async function signupWithWallet(
  message: string,
  signature: Hex,
  name?: string,
): Promise<WalletAuthResponse> {
  return request<WalletAuthResponse>("/auth/wallet/signup", { message, signature, name });
}

/**
 * The combined "log in OR sign up if no account exists yet" flow used by
 * the single Connect Wallet button. Tries login first; on 404 falls back
 * to signup.
 */
export async function loginOrSignupWithWallet(
  message: string,
  signature: Hex,
): Promise<WalletAuthResponse> {
  try {
    return await loginWithWallet(message, signature);
  } catch (err) {
    const status = (err as { status?: number }).status;
    const msg = err instanceof Error ? err.message : String(err);
    if (status === 404 || msg.includes("no account linked")) {
      return signupWithWallet(message, signature);
    }
    throw err;
  }
}
