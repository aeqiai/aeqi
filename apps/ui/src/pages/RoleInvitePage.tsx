import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "@/lib/api";
import { Button, Input, Textarea } from "@/components/ui";

type TargetKind = "email" | "open";

const TARGET_OPTIONS: { value: TargetKind; label: string }[] = [
  { value: "email", label: "Email" },
  { value: "open", label: "Open link" },
];

export default function RoleInvitePage() {
  const { entityId = "", roleId = "" } = useParams<{ entityId: string; roleId: string }>();
  const navigate = useNavigate();

  const [targetKind, setTargetKind] = useState<TargetKind>("email");
  const [targetEmail, setTargetEmail] = useState("");
  const [welcomeNote, setWelcomeNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Open link result
  const [openToken, setOpenToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    document.title = "Invite to role · æqi";
  }, []);

  const detailHref = `/c/${encodeURIComponent(entityId)}/roles/${encodeURIComponent(roleId)}`;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (targetKind === "email") {
      const trimmedEmail = targetEmail.trim();
      if (!trimmedEmail) {
        setError("Enter an email address.");
        return;
      }
      if (!trimmedEmail.includes("@")) {
        setError("Enter a valid email address.");
        return;
      }
    }

    setSubmitting(true);
    try {
      const resp = await api.createRoleInvitation(entityId, roleId, {
        target_kind: targetKind,
        ...(targetKind === "email" ? { target_email: targetEmail.trim() } : {}),
        ...(welcomeNote.trim() ? { welcome_note: welcomeNote.trim() } : {}),
      });

      if (targetKind === "open") {
        setOpenToken(resp.invitation.token);
      } else {
        navigate(detailHref, { replace: true });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create invitation.");
      setSubmitting(false);
    }
  };

  const openUrl = openToken ? `${window.location.origin}/invitations/${openToken}` : null;

  const handleCopy = () => {
    if (!openUrl) return;
    navigator.clipboard.writeText(openUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  // Show open-link result
  if (openToken && openUrl) {
    return (
      <div className="asv-main" style={{ padding: "28px 32px", maxWidth: 560 }}>
        <div className="page-header">
          <div className="page-header-breadcrumbs">
            <Link to={`/c/${encodeURIComponent(entityId)}/roles`}>Roles</Link>
            <span>/</span>
            <Link to={detailHref}>Role</Link>
            <span>/</span>
            <span>Invite</span>
          </div>
        </div>

        <div
          style={{
            padding: "20px 24px",
            background: "var(--color-card-elevated, #fff)",
            borderRadius: "var(--radius-md)",
            display: "flex",
            flexDirection: "column",
            gap: "var(--space-4)",
          }}
        >
          <p style={{ fontSize: 13, fontWeight: 500, margin: 0 }}>Open invitation link created</p>
          <p style={{ fontSize: 12, color: "var(--text-secondary)", margin: 0 }}>
            Anyone with this link can claim the role. It expires in 1 hour.
          </p>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "var(--space-2)",
              padding: "10px 12px",
              background: "var(--color-card)",
              borderRadius: "var(--radius-sm)",
              fontFamily: "var(--font-mono)",
              fontSize: 12,
              wordBreak: "break-all",
            }}
          >
            <span style={{ flex: 1 }}>{openUrl}</span>
            <Button variant="secondary" size="sm" onClick={handleCopy} type="button">
              {copied ? "Copied!" : "Copy"}
            </Button>
          </div>
          <div style={{ display: "flex", gap: "var(--space-2)" }}>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => navigate(detailHref, { replace: true })}
              type="button"
            >
              Done
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="asv-main" style={{ padding: "28px 32px", maxWidth: 560 }}>
      <div className="page-header">
        <div className="page-header-breadcrumbs">
          <Link to={`/c/${encodeURIComponent(entityId)}/roles`}>Roles</Link>
          <span>/</span>
          <Link to={detailHref}>Role</Link>
          <span>/</span>
          <span>Invite</span>
        </div>
        <div className="page-header-row">
          <h1 className="page-title">Invite someone</h1>
        </div>
      </div>

      <form
        onSubmit={handleSubmit}
        style={{ display: "flex", flexDirection: "column", gap: "var(--space-6)", maxWidth: 480 }}
      >
        {/* Target type */}
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
          <span
            style={{
              fontSize: 12,
              fontWeight: 500,
              color: "var(--text-muted)",
              textTransform: "uppercase",
              letterSpacing: "0.06em",
            }}
          >
            Invite via
          </span>
          <div style={{ display: "flex", gap: "var(--space-2)" }}>
            {TARGET_OPTIONS.map((opt) => (
              <label
                key={opt.value}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "var(--space-2)",
                  padding: "8px 14px",
                  borderRadius: "var(--radius-md)",
                  background:
                    targetKind === opt.value
                      ? "var(--color-card-elevated, #fff)"
                      : "var(--color-card)",
                  cursor: "pointer",
                  fontSize: 13,
                  fontWeight: 500,
                }}
              >
                <input
                  type="radio"
                  name="target-kind"
                  value={opt.value}
                  checked={targetKind === opt.value}
                  onChange={() => setTargetKind(opt.value)}
                  style={{ accentColor: "var(--accent)" }}
                />
                {opt.label}
              </label>
            ))}
          </div>
        </div>

        {targetKind === "email" && (
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
            <label
              htmlFor="invite-email"
              style={{
                fontSize: 12,
                fontWeight: 500,
                color: "var(--text-muted)",
                textTransform: "uppercase",
                letterSpacing: "0.06em",
              }}
            >
              Email address
            </label>
            <Input
              id="invite-email"
              type="email"
              value={targetEmail}
              onChange={(e) => setTargetEmail(e.target.value)}
              placeholder="colleague@example.com"
              autoFocus
            />
          </div>
        )}

        {targetKind === "open" && (
          <div
            style={{
              padding: "12px 14px",
              background: "var(--color-card)",
              borderRadius: "var(--radius-md)",
              fontSize: 13,
              color: "var(--text-secondary)",
            }}
          >
            An open link lets anyone with the URL claim this role. It expires in 1 hour.
          </div>
        )}

        {/* Welcome note */}
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
          <label
            htmlFor="invite-note"
            style={{
              fontSize: 12,
              fontWeight: 500,
              color: "var(--text-muted)",
              textTransform: "uppercase",
              letterSpacing: "0.06em",
            }}
          >
            Welcome note <span style={{ fontWeight: 400, textTransform: "none" }}>(optional)</span>
          </label>
          <Textarea
            id="invite-note"
            value={welcomeNote}
            onChange={(e) => setWelcomeNote(e.target.value)}
            placeholder="Add a personal message to the recipient…"
            maxLength={500}
            rows={3}
          />
          <span style={{ fontSize: 11, color: "var(--text-muted)", textAlign: "right" }}>
            {welcomeNote.length}/500
          </span>
        </div>

        {error && (
          <div style={{ fontSize: 13, color: "var(--color-error, #c2410c)" }} role="alert">
            {error}
          </div>
        )}

        <div style={{ display: "flex", gap: "var(--space-2)" }}>
          <Button
            variant="secondary"
            type="button"
            onClick={() => navigate(detailHref)}
            disabled={submitting}
          >
            Cancel
          </Button>
          <Button variant="primary" type="submit" loading={submitting}>
            {targetKind === "open" ? "Generate link" : "Send invitation"}
          </Button>
        </div>
      </form>
    </div>
  );
}
