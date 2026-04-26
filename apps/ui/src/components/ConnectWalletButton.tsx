import { useState } from "react";
import { useAccount, useSignMessage, useChainId, useDisconnect } from "wagmi";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useAuthStore } from "@/store/auth";
import { buildSiweMessage, fetchNonce, loginOrSignupWithWallet } from "@/lib/walletAuth";

interface Props {
  onAuthenticated?: () => void;
}

/**
 * Single button that runs the full SIWE flow: opens RainbowKit's wallet
 * picker on first click; once connected, requests a nonce, asks the wallet
 * to sign the SIWE message, and sends it to the platform's
 * /api/auth/wallet/{login,signup} endpoint. On success, stashes the JWT in
 * the existing auth store so the rest of the app behaves identically to a
 * password / OAuth login.
 */
export default function ConnectWalletButton({ onAuthenticated }: Props) {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const { signMessageAsync } = useSignMessage();
  const { disconnect } = useDisconnect();
  const handleOAuthCallback = useAuthStore((s) => s.handleOAuthCallback);
  const [signingIn, setSigningIn] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function authenticate() {
    if (!address) return;
    setSigningIn(true);
    setError(null);
    try {
      const { nonce, domain } = await fetchNonce();
      const message = buildSiweMessage({
        domain,
        address,
        nonce,
        chainId,
        uri: window.location.origin,
      });
      const signature = await signMessageAsync({ message });
      const res = await loginOrSignupWithWallet(message, signature);
      if (!res.ok || !res.token) {
        throw new Error("auth response missing token");
      }
      handleOAuthCallback(res.token);
      onAuthenticated?.();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      // Disconnect on auth failure so the user can try a different wallet
      // without first manually disconnecting.
      disconnect();
    } finally {
      setSigningIn(false);
    }
  }

  return (
    <div className="connect-wallet-block">
      <ConnectButton.Custom>
        {({ account, chain, openConnectModal, mounted }) => {
          const ready = mounted;
          const connected = ready && account && chain;
          if (!connected) {
            return (
              <button
                type="button"
                className="btn btn--secondary connect-wallet-btn"
                onClick={openConnectModal}
              >
                Connect Wallet
              </button>
            );
          }
          return (
            <button
              type="button"
              className="btn btn--primary connect-wallet-btn"
              onClick={authenticate}
              disabled={signingIn}
            >
              {signingIn ? "Signing in…" : `Sign in as ${account.displayName}`}
            </button>
          );
        }}
      </ConnectButton.Custom>
      {isConnected && error && (
        <div className="connect-wallet-error" role="alert">
          {error}
        </div>
      )}
    </div>
  );
}
