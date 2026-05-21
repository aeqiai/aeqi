import type React from "react";
import { Button, Input } from "@/components/ui";
import type { WelcomeCopy } from "./types";
import { SolanaIcon, PasskeyIcon, GoogleIcon, GithubIcon } from "./icons";

// Door view: the initial three-door form (email + 4 oauth/passkey/wallet).

export interface DoorViewProps {
  copy: WelcomeCopy;
  displayName: string;
  setDisplayName: (s: string) => void;
  requireName: boolean;
  email: string;
  setEmail: (s: string) => void;
  /** Manual invite-code input value (signup mode only). */
  inviteInput: string;
  setInviteInput: (s: string) => void;
  /** Invite code already supplied via `?invite=` URL param — when set,
   *  the manual input is hidden because the URL wins. */
  inviteFromUrl: string | null;
  /** Render the invite-code input. False on `/login` (existing users
   *  don't need to redeem a code). */
  showInviteField: boolean;
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
  displayName,
  setDisplayName,
  requireName,
  email,
  setEmail,
  inviteInput,
  setInviteInput,
  inviteFromUrl,
  showInviteField,
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
  const renderInviteField = showInviteField && !inviteFromUrl;
  const nameReady = !requireName || displayName.trim().length > 0;
  return (
    <>
      <h1 className="auth-heading">{copy.title}</h1>
      <p className="auth-subheading">{copy.subtitle}</p>

      <form className="auth-form" onSubmit={onEmailSubmit} autoComplete="on">
        {requireName && (
          <Input
            size="lg"
            type="text"
            name="name"
            autoComplete="name"
            placeholder="Your name"
            aria-label="Your name"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            autoFocus
          />
        )}
        <Input
          size="lg"
          type="email"
          name="email"
          autoComplete="email"
          placeholder="Email address"
          aria-label="Email address"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoFocus={!requireName}
        />
        {renderInviteField && (
          <Input
            size="lg"
            type="text"
            name="invite_code"
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            placeholder="Invite code (optional)"
            aria-label="Invite code"
            value={inviteInput}
            onChange={(e) => setInviteInput(e.target.value)}
          />
        )}
        <Button
          variant="primary"
          size="lg"
          type="submit"
          fullWidth
          disabled={!nameReady || !email.trim() || submitting}
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
              disabled={!nameReady}
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
              disabled={!nameReady}
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
              disabled={!nameReady}
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
              disabled={!nameReady}
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
