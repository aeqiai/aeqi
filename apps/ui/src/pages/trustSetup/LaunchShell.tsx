import type { ReactNode } from "react";

import AuthMobileNav from "@/components/AuthMobileNav";
import Wordmark from "@/components/Wordmark";

export interface LaunchPitchContent {
  eyebrow: string;
  lines: [string, string, string];
  lead: string;
}

const DEFAULT_PITCH: LaunchPitchContent = {
  eyebrow: "LAUNCH A TRUST",
  lines: ["Programmable", "company", "vehicle."],
  lead: "A TRUST aligns stakeholders, ownership, and operations inside one programmable company — so everyone moves toward the same outcome: creating value.",
};

function LaunchPitch({ pitch = DEFAULT_PITCH }: { pitch?: LaunchPitchContent }) {
  return (
    <aside className="signup-pitch-side launch-pitch-side" aria-hidden="true">
      <div className="signup-pitch-scrim launch-pitch-scrim" />
      <div className="signup-pitch-content launch-pitch-content">
        <p className="signup-pitch-eyebrow">{pitch.eyebrow}</p>
        <h2 className="signup-pitch-heading">
          {pitch.lines.map((line) => (
            <span key={line}>{line}</span>
          ))}
        </h2>
        <p className="signup-lead">{pitch.lead}</p>
      </div>
    </aside>
  );
}

export function LaunchShell({
  children,
  sideSlot,
  topSlot,
  pitch,
  cardClassName = "",
  mobileActionHref,
  mobileActionLabel,
  mobileActionOnClick,
  ariaLive,
  ariaBusy,
}: {
  children: ReactNode;
  sideSlot?: ReactNode;
  topSlot?: ReactNode;
  pitch?: LaunchPitchContent;
  cardClassName?: string;
  mobileActionHref?: string | null;
  mobileActionLabel?: string;
  mobileActionOnClick?: () => void;
  ariaLive?: "off" | "polite" | "assertive";
  ariaBusy?: boolean;
}) {
  return (
    <main
      className="signup-split launch-split"
      aria-live={ariaLive === "off" ? undefined : ariaLive}
      aria-busy={ariaBusy}
    >
      <a className="skip-link" href="#main-content">
        Skip to main content
      </a>
      <AuthMobileNav
        ariaLabel="Launch navigation"
        actionHref={mobileActionHref ?? undefined}
        actionLabel={mobileActionLabel}
        actionOnClick={mobileActionOnClick}
        className="launch-mobile-nav"
      />

      <div className="signup-form-side launch-form-side" id="main-content">
        {topSlot}

        <section
          className={["auth-container launch-flow-card", cardClassName].filter(Boolean).join(" ")}
        >
          <div className="auth-logo launch-logo">
            <Wordmark size={36} />
          </div>
          {children}
        </section>

        {sideSlot}
      </div>

      <LaunchPitch pitch={pitch} />
    </main>
  );
}
