import { useEffect, useState } from "react";
import { Button, StatusRow } from "@/components/ui";
import {
  Events,
  onConsentChange,
  readConsent,
  useTrack,
  writeConsent,
  type ConsentLevel,
} from "@/lib/analytics";

/**
 * Settings → Preferences. Two sections: Privacy (analytics consent) and
 * Email (placeholder until backend persists per-user toggles).
 *
 * Analytics consent is local-only — it gates the Plausible script's
 * lazy-load. Authed users default to "all" on first auth (privacy
 * policy was accepted at signup); flipping here switches the provider
 * via the same `onConsentChange` event the boot wiring listens to.
 */
export default function PreferencesPanel() {
  const [consent, setConsentState] = useState<ConsentLevel>(() => readConsent());
  const track = useTrack();

  useEffect(() => onConsentChange(setConsentState), []);

  const enabled = consent === "all";

  const setLevel = (level: "all" | "essential") => {
    if (consent === level) return;
    writeConsent(level);
    track(level === "all" ? Events.ConsentGranted : Events.ConsentRevoked, { surface: "account" });
  };

  return (
    <>
      <section className="account-section">
        <h3 className="account-section-title">Privacy</h3>
        <div>
          <label className="account-field-label">Product analytics</label>
          <p className="account-field-desc">
            Helps us see which features land and where people get stuck. We self-host Plausible at{" "}
            <code>analytics.aeqi.ai</code> — no third-party trackers, no ad networks, never sold.
            Personal-identifying fields are never collected. Off-by-default for anonymous visitors;
            on by default once you sign in.
          </p>
          <StatusRow
            dot={enabled ? "active" : "idle"}
            label={enabled ? "Analytics on" : "Analytics off"}
            action={
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => setLevel(enabled ? "essential" : "all")}
              >
                {enabled ? "Turn off" : "Turn on"}
              </Button>
            }
          />
        </div>
      </section>

      <section className="account-section">
        <h3 className="account-section-title">Email</h3>
        <p className="account-field-desc">
          Email preferences are coming soon. For now, transactional emails (login codes, password
          resets) are always sent.
        </p>
      </section>
    </>
  );
}
