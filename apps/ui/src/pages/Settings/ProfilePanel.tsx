import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import UserAvatar from "@/components/UserAvatar";
import { Button, Input } from "@/components/ui";

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

  const handleAvatarChange = async (file: File | null) => {
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      setFeedback({ type: "error", msg: "Image must be under 2 MB." });
      return;
    }
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        await api.updateAvatar(reader.result as string);
        setUser((prev) => (prev ? { ...prev, avatar_url: reader.result as string } : prev));
        setFeedback({ type: "success", msg: "Avatar updated." });
        setTimeout(() => setFeedback(null), 3000);
      } catch (err: unknown) {
        setFeedback({
          type: "error",
          msg: err instanceof Error ? err.message : "Upload failed.",
        });
      }
    };
    reader.readAsDataURL(file);
  };

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
      <div className="account-profile-header">
        <label className="account-avatar-label" aria-label="Change avatar">
          <UserAvatar name={displayName} size={48} src={user?.avatar_url} />
          <div className="account-avatar-badge" aria-hidden="true">
            <svg
              width="10"
              height="10"
              viewBox="0 0 12 12"
              fill="none"
              stroke="#fff"
              strokeWidth="1.5"
              strokeLinecap="round"
            >
              <path d="M6 2.5v7M2.5 6h7" />
            </svg>
          </div>
          <input
            type="file"
            accept="image/*"
            className="account-hidden-input"
            onChange={(e) => handleAvatarChange(e.target.files?.[0] ?? null)}
          />
        </label>
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

      <div className="account-field-sm">
        <label className="account-field-label" htmlFor="account-email">
          Email
        </label>
        <Input id="account-email" size="lg" type="email" value={email} disabled />
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

      <div className="account-kyc-card">
        <div className="account-kyc-row">
          <div>
            <label className="account-field-label">Identity verification</label>
            <p className="account-field-desc">
              Required for incorporation, equity issuance, and marketplace access.
            </p>
          </div>
          <span className="account-badge-coming-soon">Coming soon</span>
        </div>
      </div>

      <Button
        type="button"
        variant="primary"
        onClick={handleSave}
        loading={saving}
        disabled={saving}
      >
        Save
      </Button>
      {feedback && (
        <div
          className={`account-feedback account-feedback-${feedback.type}`}
          role="status"
          aria-live="polite"
        >
          {feedback.msg}
        </div>
      )}
    </>
  );
}
