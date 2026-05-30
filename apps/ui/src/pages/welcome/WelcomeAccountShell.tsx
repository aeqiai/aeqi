import type React from "react";
import AuthMobileNav from "@/components/AuthMobileNav";
import Wordmark from "@/components/Wordmark";
import DoorView from "./DoorView";
import CheckEmailView from "./CheckEmailView";
import { ErrorView, SpawningView, WaitlistSentView, WaitlistView, WelcomeView } from "./views";
import type {
  AccountSessionResponse,
  Door,
  SpawnStep,
  WelcomeCopy,
  WelcomeMode,
  WelcomeStage,
} from "./types";

interface WelcomeAccountShellProps {
  authModeLoaded: boolean;
  authSwitchHref: string;
  copy: WelcomeCopy;
  displayName: string;
  email: string;
  errorMsg: string | null;
  inviteFromUrl: string | null;
  inviteInput: string;
  mode: WelcomeMode;
  outcome: AccountSessionResponse | null;
  passkeyAvailable: boolean;
  picked: Door | null;
  setDisplayName: (value: string) => void;
  setEmail: (value: string) => void;
  setInviteInput: (value: string) => void;
  stage: WelcomeStage;
  steps: SpawnStep[];
  submitting: boolean;
  waitlistMode: boolean;
  walletDetected: { name: string } | null;
  onBack: () => void;
  onContinue: () => void;
  onEmailSubmit: (event: React.FormEvent) => void;
  onGoogle: () => void;
  onGithub: () => void;
  onPasskey: () => void;
  onSwitch: () => void;
  onWaitlistSubmit: (email: string) => Promise<void>;
  onWallet: () => void;
  onEmailCodeSubmit: (code: string) => void;
  onEmailResend: () => Promise<void>;
}

export default function WelcomeAccountShell({
  authModeLoaded,
  authSwitchHref,
  copy,
  displayName,
  email,
  errorMsg,
  inviteFromUrl,
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
  onBack,
  onContinue,
  onEmailSubmit,
  onGoogle,
  onGithub,
  onPasskey,
  onSwitch,
  onWaitlistSubmit,
  onWallet,
  onEmailCodeSubmit,
  onEmailResend,
}: WelcomeAccountShellProps) {
  const isWaitlistStage = stage === "waitlist" || stage === "waitlist-sent";

  if (!authModeLoaded) {
    return (
      <main className="signup-split">
        <a className="skip-link" href="#main-content">
          Skip to main content
        </a>
        <AuthMobileNav
          ariaLabel="Authentication navigation"
          actionHref={authSwitchHref}
          actionLabel={copy.switchCta}
        />
        <div className="signup-form-side" id="main-content" />
      </main>
    );
  }

  return (
    <main className="signup-split">
      <a className="skip-link" href="#main-content">
        Skip to main content
      </a>
      <AuthMobileNav
        ariaLabel="Authentication navigation"
        actionHref={authSwitchHref}
        actionLabel={copy.switchCta}
      />
      <div className="signup-form-side" id="main-content">
        <div
          className={isWaitlistStage ? "auth-container auth-container--waitlist" : "auth-container"}
          role="region"
          aria-live="polite"
        >
          <div className="auth-logo">
            <Wordmark size={36} />
          </div>

          {stage === "door" && (
            <DoorView
              copy={copy}
              displayName={displayName}
              setDisplayName={setDisplayName}
              showNameField={mode === "signup"}
              email={email}
              setEmail={setEmail}
              inviteInput={inviteInput}
              setInviteInput={setInviteInput}
              inviteFromUrl={inviteFromUrl}
              showInviteField={waitlistMode && mode !== "login"}
              walletDetected={walletDetected}
              passkeyAvailable={passkeyAvailable}
              submitting={submitting}
              onEmailSubmit={onEmailSubmit}
              onWallet={onWallet}
              onPasskey={onPasskey}
              onGoogle={onGoogle}
              onGithub={onGithub}
              onSwitch={onSwitch}
            />
          )}

          {stage === "check-email" && (
            <CheckEmailView
              email={email}
              onCodeSubmit={onEmailCodeSubmit}
              onResend={onEmailResend}
              onBack={onBack}
            />
          )}

          {stage === "spawning" && <SpawningView steps={steps} picked={picked} />}

          {stage === "welcome" && outcome && (
            <WelcomeView outcome={outcome} onContinue={onContinue} />
          )}

          {stage === "waitlist" && (
            <WaitlistView
              email={email}
              setEmail={setEmail}
              onSubmit={onWaitlistSubmit}
              onBack={onBack}
            />
          )}

          {stage === "waitlist-sent" && <WaitlistSentView email={email} onBack={onBack} />}

          {stage === "error" && (
            <ErrorView message={errorMsg ?? "Something went wrong."} onBack={onBack} />
          )}

          <div className="auth-footer">
            <p>
              By continuing, you agree to the{" "}
              <a href="https://aeqi.ai/terms" target="_blank" rel="noopener noreferrer">
                Terms of Service
              </a>{" "}
              and{" "}
              <a href="https://aeqi.ai/privacy" target="_blank" rel="noopener noreferrer">
                Privacy Policy
              </a>
              .
            </p>
          </div>
        </div>
      </div>

      <aside className={`signup-pitch-side signup-pitch-side--${mode}`} aria-hidden="true">
        <div className="signup-pitch-scrim" />
        <div className="signup-pitch-content">
          <p className="signup-pitch-eyebrow">THE COMPANY OS</p>
          <h2 className="signup-pitch-heading">
            <span>Start something</span>
            <span>that can work</span>
            <span>without you.</span>
          </h2>
          <p className="signup-lead">Humans set direction. Agents execute. Memory compounds.</p>
        </div>
      </aside>
    </main>
  );
}
