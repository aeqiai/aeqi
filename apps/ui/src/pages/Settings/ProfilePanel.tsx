import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Badge, Banner, Button, Input } from "@/components/ui";
import AvatarUploader from "./AvatarUploader";
import EmailEditor from "@/pages/Settings/EmailEditor";

interface UserData {
  email?: string;
  name?: string;
  phone?: string;
  avatar_url?: string;
}

type Feedback = { type: "success" | "error"; msg: string } | null;

/**
 * Settings → Profile tab. Identity-level fields: avatar, first/last
 * name, email (read-only), phone, KYC stub. Owns its own state +
 * fetches `getMe()` on mount; never reaches outside the tab.
 */
export default function ProfilePanel() {
  const [user, setUser] = useState<UserData | null>(null);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);

  useEffect(() => {
    api
      .getMe()
      .then((data) => {
        const u = data as UserData;
        setUser(u);
        const parts = (u.name || "").split(/\s+/);
        setFirstName(parts[0] || "");
        setLastName(parts.slice(1).join(" ") || "");
        if (typeof u.phone === "string") setPhone(u.phone);
      })
      .catch(() => {});
  }, []);

  const displayName = `${firstName} ${lastName}`.trim() || "Profile";
  const email = user?.email || "";

  const handleSave = async () => {
    setFeedback(null);
    if (!firstName.trim()) {
      setFeedback({ type: "error", msg: "First name is required." });
      return;
    }
    setSaving(true);
    try {
      await api.updateProfile(firstName.trim(), lastName.trim(), phone.trim());
      setFeedback({ type: "success", msg: "Profile updated." });
      setTimeout(() => setFeedback(null), 3000);
    } catch (e: unknown) {
      setFeedback({
        type: "error",
        msg: e instanceof Error ? e.message : "Failed to update profile.",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <section className="account-section">
        <h3 className="account-section-title">Identity</h3>

        <div className="account-profile-header">
          <AvatarUploader
            name={displayName}
            src={user?.avatar_url ?? null}
            onSrcChange={(next) =>
              setUser((prev) => (prev ? { ...prev, avatar_url: next ?? undefined } : prev))
            }
            onFeedback={setFeedback}
          />
          <div>
            <div className="account-profile-name">{displayName}</div>
            <div className="account-profile-email">{email}</div>
          </div>
        </div>

        <div className="account-name-grid">
          <div>
            <label className="account-field-label" htmlFor="account-first-name">
              First name
            </label>
            <Input
              id="account-first-name"
              size="lg"
              type="text"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              placeholder="First name"
              autoComplete="given-name"
            />
          </div>
          <div>
            <label className="account-field-label" htmlFor="account-last-name">
              Last name
            </label>
            <Input
              id="account-last-name"
              size="lg"
              type="text"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              placeholder="Last name"
              autoComplete="family-name"
            />
          </div>
        </div>
      </section>

      <section className="account-section">
        <h3 className="account-section-title">Contact</h3>

        <div className="account-field-sm">
          <label className="account-field-label" htmlFor="account-email">
            Email
          </label>
          <EmailEditor
            currentEmail={email}
            onChanged={(e) => setUser((u) => (u ? { ...u, email: e } : u))}
          />
        </div>

        <div className="account-field-md">
          <label className="account-field-label" htmlFor="account-phone">
            Phone
          </label>
          <Input
            id="account-phone"
            size="lg"
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="+1 (555) 000-0000"
            autoComplete="tel"
          />
          <p className="account-field-desc">
            Optional. Used for account recovery and security alerts.
          </p>
        </div>
      </section>

      <section className="account-section">
        <h3 className="account-section-title">Verification</h3>

        <div className="account-verification-row">
          <div>
            <label className="account-field-label">Identity verification</label>
            <p className="account-field-desc">
              Required for incorporation, equity issuance, and marketplace access.
            </p>
          </div>
          <Badge variant="muted" size="sm">
            Coming soon
          </Badge>
        </div>
      </section>

      <div className="account-save-row">
        <Button type="button" variant="primary" onClick={handleSave} loading={saving}>
          Save
        </Button>
      </div>
      {feedback && <Banner kind={feedback.type}>{feedback.msg}</Banner>}
    </>
  );
}
