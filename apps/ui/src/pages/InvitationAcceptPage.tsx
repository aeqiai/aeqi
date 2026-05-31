import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "@/lib/api";
import { logError } from "@/lib/logging";
import type { InvitationDetail } from "@/lib/types";
import { useAuthStore } from "@/store/auth";
import { useDaemonStore } from "@/store/daemon";
import { entityPathFromId } from "@/lib/entityPath";
import { Button, Select, Loading } from "@/components/ui";
import Wordmark from "@/components/Wordmark";

/**
 * Public invitation accept page — /invitations/:token
 *
 * Three branches:
 * 1. Status != "pending": show "no longer valid"
 * 2. Logged in: show accept-as picker with directed entities
 * 3. Not logged in: show sign-in / create-account CTAs
 */
export default function InvitationAcceptPage() {
  const { token = "" } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const authToken = useAuthStore((s) => s.token);
  const authMode = useAuthStore((s) => s.authMode);
  const fetchAuthMode = useAuthStore((s) => s.fetchAuthMode);
  const daemonEntities = useDaemonStore((s) => s.entities);

  const [invitation, setInvitation] = useState<InvitationDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Directed entities (only fetched when logged in)
  const [directedEntities, setDirectedEntities] = useState<
    Array<{ company_id: string; display_name: string }>
  >([]);
  const [asEntityId, setAsEntityId] = useState("");

  const [accepting, setAccepting] = useState(false);
  const [declining, setDeclining] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  // Determine auth state
  const isLoggedIn = (() => {
    if (authMode === "none") return true;
    return !!authToken;
  })();

  useEffect(() => {
    fetchAuthMode();
  }, [fetchAuthMode]);

  useEffect(() => {
    document.title = "aeqi";
    if (!token) {
      setLoadError("Invalid invitation link.");
      setLoading(false);
      return;
    }
    api
      .getInvitation(token)
      .then((r) => {
        setInvitation(r.invitation);
      })
      .catch(() => {
        setLoadError("Invitation not found or has expired.");
      })
      .finally(() => setLoading(false));
  }, [token]);

  // Fetch directed entities once we know the user is logged in
  useEffect(() => {
    if (!isLoggedIn) return;
    api
      .getDirectedEntities()
      .then((r) => {
        setDirectedEntities(r.entities);
        if (r.entities.length > 0) setAsEntityId(r.entities[0].company_id);
      })
      .catch((e) => logError("invitation.list-entities", e));
  }, [isLoggedIn]);

  const handleAccept = async () => {
    if (!asEntityId) {
      setActionError("Select which company to accept as.");
      return;
    }
    setAccepting(true);
    setActionError(null);
    try {
      await api.acceptInvitation(token, asEntityId);
      // Navigate to the company that now holds the role
      const entity = directedEntities.find((e) => e.company_id === invitation?.company_id);
      if (entity) {
        navigate(entityPathFromId(daemonEntities, entity.company_id, "roles"), { replace: true });
      } else {
        navigate("/", { replace: true });
      }
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Could not accept invitation.");
      setAccepting(false);
    }
  };

  const handleDecline = async () => {
    setDeclining(true);
    setActionError(null);
    try {
      await api.declineInvitation(token);
      navigate("/", { replace: true });
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Could not decline invitation.");
      setDeclining(false);
    }
  };

  const entityOptions = directedEntities.map((e) => ({
    value: e.company_id,
    label: e.display_name,
  }));

  return (
    <main
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        background: "var(--color-bg-base, #f5f5f5)",
        padding: "var(--space-6) var(--space-4)",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 440,
          display: "flex",
          flexDirection: "column",
          gap: "var(--space-6)",
        }}
      >
        {/* Logo */}
        <div style={{ display: "flex", justifyContent: "center", marginBottom: "var(--space-2)" }}>
          <Link to="/" aria-label="aeqi home">
            <Wordmark size={28} />
          </Link>
        </div>

        {/* Card */}
        <div
          style={{
            background: "var(--color-card-elevated)",
            borderRadius: "var(--radius-lg)",
            padding: "var(--space-6) var(--space-8)",
            display: "flex",
            flexDirection: "column",
            gap: "var(--space-5)",
          }}
        >
          {loading && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 8,
                color: "var(--color-text-muted)",
                fontSize: "var(--font-size-sm)",
                padding: "var(--space-4) 0",
              }}
            >
              <Loading size="sm" /> Loading invitation…
            </div>
          )}

          {!loading && loadError && (
            <>
              <h1 style={{ fontSize: "var(--font-size-lg)", fontWeight: 600, margin: 0 }}>
                Invitation not found
              </h1>
              <p
                style={{
                  fontSize: "var(--font-size-base)",
                  color: "var(--color-text-secondary)",
                  margin: 0,
                }}
              >
                {loadError}
              </p>
              <Link
                to="/"
                style={{ fontSize: "var(--font-size-sm)", color: "var(--color-text-secondary)" }}
              >
                Return home
              </Link>
            </>
          )}

          {!loading && invitation && invitation.status !== "pending" && (
            <>
              <h1 style={{ fontSize: "var(--font-size-lg)", fontWeight: 600, margin: 0 }}>
                Invitation no longer valid
              </h1>
              <p
                style={{
                  fontSize: "var(--font-size-base)",
                  color: "var(--color-text-secondary)",
                  margin: 0,
                }}
              >
                This invitation has been{" "}
                {invitation.status === "redeemed"
                  ? "already accepted"
                  : invitation.status === "declined"
                    ? "declined"
                    : "expired"}
                .
              </p>
              <Link
                to="/"
                style={{ fontSize: "var(--font-size-sm)", color: "var(--color-text-secondary)" }}
              >
                Return home
              </Link>
            </>
          )}

          {!loading && invitation && invitation.status === "pending" && (
            <>
              {/* Header */}
              <div>
                <p
                  style={{
                    fontSize: "var(--font-size-sm)",
                    color: "var(--color-text-muted)",
                    margin: "0 0 4px",
                  }}
                >
                  {invitation.inviter_name} invited you
                </p>
                <h1
                  style={{
                    fontSize: "var(--font-size-xl)",
                    fontWeight: 600,
                    margin: 0,
                    lineHeight: 1.3,
                  }}
                >
                  Join{" "}
                  <span style={{ color: "var(--accent)" }}>{invitation.entity_display_name}</span>
                  {invitation.role_title ? (
                    <>
                      {" "}
                      as <span style={{ fontStyle: "italic" }}>{invitation.role_title}</span>
                    </>
                  ) : null}
                </h1>
              </div>

              {/* Welcome note */}
              {invitation.welcome_note && (
                <blockquote
                  style={{
                    margin: 0,
                    padding: "var(--space-3) var(--space-4)",
                    background: "var(--color-card)",
                    borderRadius: "var(--radius-md)",
                    fontSize: "var(--font-size-sm)",
                    color: "var(--color-text-secondary)",
                    fontStyle: "italic",
                  }}
                >
                  {invitation.welcome_note}
                </blockquote>
              )}

              {/* Logged in — accept/decline flow */}
              {isLoggedIn && (
                <>
                  {entityOptions.length > 0 ? (
                    <div
                      style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}
                    >
                      <label
                        htmlFor="accept-as"
                        style={{
                          fontSize: "var(--font-size-xs)",
                          fontWeight: 500,
                          color: "var(--color-text-muted)",
                          textTransform: "uppercase",
                          letterSpacing: "0.06em",
                        }}
                      >
                        Accept as
                      </label>
                      <Select
                        id="accept-as"
                        options={entityOptions}
                        value={asEntityId}
                        onChange={setAsEntityId}
                        fullWidth
                      />
                      <p
                        style={{
                          fontSize: "var(--font-size-xs)",
                          color: "var(--color-text-muted)",
                          margin: 0,
                        }}
                      >
                        The selected company will hold this role in {invitation.entity_display_name}
                        .
                      </p>
                    </div>
                  ) : (
                    <div
                      style={{
                        padding: "var(--space-3) var(--space-4)",
                        background: "var(--color-card)",
                        borderRadius: "var(--radius-md)",
                        fontSize: "var(--font-size-sm)",
                        color: "var(--color-text-secondary)",
                      }}
                    >
                      You have no companies to accept with yet. Create your personal company first,
                      then come back and claim the role.
                      <div style={{ marginTop: "var(--space-3)" }}>
                        <Button
                          variant="primary"
                          size="sm"
                          onClick={() =>
                            navigate(
                              `/launch?blueprint=personal-os&invitation=${encodeURIComponent(token)}`,
                            )
                          }
                        >
                          Create company and continue
                        </Button>
                      </div>
                    </div>
                  )}

                  {actionError && (
                    <div
                      style={{ fontSize: "var(--font-size-sm)", color: "var(--color-error)" }}
                      role="alert"
                    >
                      {actionError}
                    </div>
                  )}

                  <div style={{ display: "flex", gap: "var(--space-2)" }}>
                    <Button
                      variant="secondary"
                      onClick={handleDecline}
                      loading={declining}
                      disabled={accepting}
                    >
                      Decline
                    </Button>
                    <Button
                      variant="primary"
                      onClick={handleAccept}
                      loading={accepting}
                      disabled={declining || entityOptions.length === 0}
                    >
                      Accept
                    </Button>
                  </div>
                </>
              )}

              {/* Not logged in */}
              {!isLoggedIn && (
                <>
                  {invitation.target_email && (
                    <p
                      style={{
                        fontSize: "var(--font-size-sm)",
                        color: "var(--color-text-secondary)",
                        margin: 0,
                      }}
                    >
                      This invitation is addressed to <strong>{invitation.target_email}</strong>.
                    </p>
                  )}

                  <p
                    style={{
                      fontSize: "var(--font-size-sm)",
                      color: "var(--color-text-secondary)",
                      margin: 0,
                    }}
                  >
                    Sign in or create an account to claim this role.
                  </p>

                  <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
                    <Button
                      variant="primary"
                      fullWidth
                      onClick={() =>
                        navigate(`/login?next=${encodeURIComponent(`/invitations/${token}`)}`)
                      }
                    >
                      Sign in
                    </Button>
                    <Button
                      variant="secondary"
                      fullWidth
                      onClick={() => navigate(`/signup?invitation=${token}`)}
                    >
                      Create account
                    </Button>
                  </div>
                </>
              )}
            </>
          )}
        </div>
      </div>
    </main>
  );
}
