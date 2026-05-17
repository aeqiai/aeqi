import type React from "react";
import { Button, Input } from "@/components/ui";
import type { WelcomeCopy } from "./types";
import { SolanaIcon, PasskeyIcon, GoogleIcon, GithubIcon } from "./icons";

// Door view: the initial three-door form (email + 4 oauth/passkey/wallet).

export interface DoorViewProps {
  copy: WelcomeCopy;
  email: string;
  setEmail: (s: string) => void;
  walletDetected: { name: string } | null;
  passkeyAvailable: boolean;
  submitting: boolean;
  onEmailSubmit: (e: React.FormEvent) => void;
  onWallet: () => void;
  onPasskey: () => void;
  onGoogle: () => void;
  onGithub: () => void;
  onSwitch: () => void;
}

export default function DoorView({
  copy,
  email,
  setEmail,
  walletDetected,
  passkeyAvailable,
  submitting,
  onEmailSubmit,
  onWallet,
  onPasskey,
  onGoogle,
  onGithub,
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
              onClick={onGoogle}
              type="button"
              leadingIcon={<GoogleIcon size={14} />}
            >
              Google
            </Button>
            <Button
              variant="secondary"
              size="lg"
              fullWidth
              onClick={onGithub}
              type="button"
              leadingIcon={<GithubIcon size={14} />}
            >
              GitHub
            </Button>
          </div>
          <div className="auth-oauth-row">
            <Button
              variant="secondary"
              size="lg"
              fullWidth
              onClick={onPasskey}
              type="button"
              leadingIcon={<PasskeyIcon size={14} />}
            >
              {passkeyAvailable ? "Passkey" : "Security key"}
            </Button>
            <Button
              variant="secondary"
              size="lg"
              fullWidth
              onClick={onWallet}
              type="button"
              leadingIcon={<SolanaIcon size={14} />}
            >
              {walletDetected?.name ?? "Wallet"}
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
