import { useEffect, useRef, useState } from "react";
import { useAccount, useChainId, useDisconnect, useSignMessage } from "wagmi";
import { useConnectModal } from "@rainbow-me/rainbowkit";
import { useAuthStore } from "@/store/auth";
import { Button } from "@/components/ui";
import AuthIconSlot from "@/components/AuthIconSlot";
import { buildSiweMessage, fetchNonce, loginOrSignupWithWallet } from "@/lib/walletAuth";

interface Props {
  onAuthenticated?: () => void;
}

/**
 * One-click "Continue with Wallet" matching the Google / GitHub OAuth
 * buttons. Click → RainbowKit modal → on successful connect, auto-fires
 * the SIWE signing dance and posts to /api/auth/wallet/{login,signup}.
 */
export default function ConnectWalletButton({ onAuthenticated }: Props) {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const { signMessageAsync } = useSignMessage();
  const { disconnect } = useDisconnect();
  const { openConnectModal } = useConnectModal();
  const handleOAuthCallback = useAuthStore((s) => s.handleOAuthCallback);
  const [signing, setSigning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Guard so the post-connect effect only runs once per connection. If the
  // user disconnects (or auth fails and we disconnect them), this resets.
  const ranOnce = useRef(false);

  async function authenticate() {
    if (!address) return;
    setSigning(true);
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
      if (!res.ok || !res.token) throw new Error("auth response missing token");
      handleOAuthCallback(res.token);
      onAuthenticated?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      // Disconnect on auth failure so the user can pick a different wallet
      // without manually disconnecting first.
      disconnect();
      ranOnce.current = false;
    } finally {
      setSigning(false);
    }
  }

  // After the modal closes with a successful connection, run SIWE
  // automatically. The button itself collapses connect + sign into one
  // user-visible action.
  useEffect(() => {
    if (isConnected && address && !signing && !ranOnce.current) {
      ranOnce.current = true;
      void authenticate();
    }
    if (!isConnected) {
      ranOnce.current = false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isConnected, address]);

  function handleClick() {
    if (signing) return;
    if (isConnected) {
      void authenticate();
    } else {
      openConnectModal?.();
    }
  }

  return (
    <>
      <Button
        variant="secondary"
        size="lg"
        fullWidth
        type="button"
        onClick={handleClick}
        disabled={signing}
      >
        <AuthIconSlot />
        {signing ? "Signing in…" : "Continue with Wallet"}
      </Button>
      {error && (
        <div className="auth-error" role="alert">
          {error}
        </div>
      )}
    </>
  );
}
