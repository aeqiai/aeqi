import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Button, ConfirmDialog } from "@/components/ui";

type ActivityRow = {
  action: string;
  detail?: string;
  ip?: string;
  user_agent?: string;
  created_at: string;
};

type Session = {
  jti: string;
  ip?: string;
  user_agent?: string;
  created_at: string;
  last_seen_at: string;
  expires_at: string;
  current?: boolean;
};

const LOGIN_ACTIONS = new Set([
  "login",
  "login_success",
  "login_failed",
  "login_attempt",
  "2fa_verified",
  "totp_verified",
  "totp_login_failed",
  "logout",
  "password_changed",
  "oauth_login",
  "session_revoked",
  "sessions_revoked_others",
  "account_created",
]);

function formatAgo(iso: string): string {
  try {
    const diff = Date.now() - new Date(iso).getTime();
    if (diff < 60_000) return "Just now";
    if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
    if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
    return `${Math.floor(diff / 86_400_000)}d ago`;
  } catch {
    return "";
  }
}

type DeviceKind = "macbook" | "windows" | "linux" | "iphone" | "ipad" | "android" | "unknown";

function classifyDevice(ua?: string): { kind: DeviceKind; os: string; browser: string } {
  if (!ua) return { kind: "unknown", os: "Unknown OS", browser: "Browser" };
  const lower = ua.toLowerCase();

  let kind: DeviceKind = "unknown";
  let os = "Unknown OS";
  if (lower.includes("iphone")) {
    kind = "iphone";
    os = "iOS";
  } else if (lower.includes("ipad")) {
    kind = "ipad";
    os = "iPadOS";
  } else if (lower.includes("android")) {
    kind = "android";
    os = "Android";
  } else if (lower.includes("mac os") || lower.includes("macintosh")) {
    kind = "macbook";
    os = "macOS";
  } else if (lower.includes("windows")) {
    kind = "windows";
    os = "Windows";
  } else if (lower.includes("linux")) {
    kind = "linux";
    os = "Linux";
  }

  let browser = "Browser";
  if (lower.includes("edg/")) browser = "Edge";
  else if (lower.includes("chrome/") && !lower.includes("edg/")) browser = "Chrome";
  else if (lower.includes("firefox/")) browser = "Firefox";
  else if (lower.includes("safari/") && !lower.includes("chrome/")) browser = "Safari";

  return { kind, os, browser };
}

function describeUserAgent(ua?: string): string {
  const { browser, os } = classifyDevice(ua);
  return `${browser} on ${os}`;
}

function DeviceIcon({ kind }: { kind: DeviceKind }) {
  switch (kind) {
    case "macbook":
      return (
        <svg viewBox="0 0 48 48" width="44" height="44" aria-hidden="true">
          <rect
            x="6"
            y="10"
            width="36"
            height="22"
            rx="2"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
          />
          <rect x="9" y="13" width="30" height="16" rx="0.6" fill="currentColor" opacity="0.06" />
          <path
            d="M3 34 H45 L43 38 H5 Z"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinejoin="round"
          />
          <line
            x1="20"
            y1="36"
            x2="28"
            y2="36"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
          />
        </svg>
      );
    case "windows":
    case "linux":
      return (
        <svg viewBox="0 0 48 48" width="44" height="44" aria-hidden="true">
          <rect
            x="5"
            y="9"
            width="38"
            height="24"
            rx="2"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
          />
          <rect x="8" y="12" width="32" height="18" rx="0.6" fill="currentColor" opacity="0.06" />
          <path d="M18 39 L30 39" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          <path d="M24 33 L24 39" stroke="currentColor" strokeWidth="1.6" />
        </svg>
      );
    case "iphone":
    case "android":
      return (
        <svg viewBox="0 0 48 48" width="44" height="44" aria-hidden="true">
          <rect
            x="15"
            y="6"
            width="18"
            height="36"
            rx="3"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
          />
          <rect x="17" y="10" width="14" height="26" rx="0.6" fill="currentColor" opacity="0.06" />
          <circle cx="24" cy="39" r="1.2" fill="currentColor" />
          <line
            x1="22"
            y1="8"
            x2="26"
            y2="8"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
          />
        </svg>
      );
    case "ipad":
      return (
        <svg viewBox="0 0 48 48" width="44" height="44" aria-hidden="true">
          <rect
            x="9"
            y="6"
            width="30"
            height="36"
            rx="3"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
          />
          <rect x="11" y="10" width="26" height="26" rx="0.6" fill="currentColor" opacity="0.06" />
          <circle cx="24" cy="39" r="1.2" fill="currentColor" />
        </svg>
      );
    default:
      return (
        <svg viewBox="0 0 48 48" width="44" height="44" aria-hidden="true">
          <circle cx="24" cy="24" r="14" fill="none" stroke="currentColor" strokeWidth="1.6" />
          <text
            x="24"
            y="29"
            textAnchor="middle"
            fontSize="14"
            fontWeight="500"
            fill="currentColor"
          >
            ?
          </text>
        </svg>
      );
  }
}

/**
 * Settings → Devices tab. Active sessions + login & IP history.
 *
 * Sessions come from `/api/auth/sessions` (one row per live JWT in
 * platform.db). Revoking a session marks `revoked_at` so the auth
 * middleware rejects the next request from that token. The current
 * row is flagged by the server based on the request's own jti.
 */
export default function DevicesPanel() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [activity, setActivity] = useState<ActivityRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [busyJti, setBusyJti] = useState<string | null>(null);
  const [revokingOthers, setRevokingOthers] = useState(false);
  const [revokeTarget, setRevokeTarget] = useState<{ jti: string; isCurrent: boolean } | null>(
    null,
  );
  const [revokeOthersOpen, setRevokeOthersOpen] = useState(false);

  const loadSessions = () =>
    api
      .getAuthSessions()
      .then((data) => {
        const list = (data as { sessions?: Session[] }).sessions;
        if (Array.isArray(list)) setSessions(list);
      })
      .catch(() => {});

  useEffect(() => {
    Promise.all([
      loadSessions(),
      api
        .getActivity()
        .then((data: Record<string, unknown>) => {
          const events = (data as { events?: ActivityRow[] }).events;
          if (Array.isArray(events)) setActivity(events);
        })
        .catch(() => {}),
    ]).finally(() => setLoaded(true));
  }, []);

  const askRevoke = (jti: string, isCurrent: boolean) => {
    setRevokeTarget({ jti, isCurrent });
  };

  const performRevoke = async () => {
    if (!revokeTarget) return;
    setBusyJti(revokeTarget.jti);
    try {
      await api.revokeAuthSession(revokeTarget.jti);
      if (revokeTarget.isCurrent) {
        window.location.href = "/login";
        return;
      }
      await loadSessions();
    } catch {
      // Surface failure quietly; refresh in case it actually succeeded.
      await loadSessions();
    } finally {
      setBusyJti(null);
      setRevokeTarget(null);
    }
  };

  const askRevokeOthers = () => setRevokeOthersOpen(true);

  const performRevokeOthers = async () => {
    setRevokingOthers(true);
    try {
      await api.revokeOtherAuthSessions();
      await loadSessions();
    } finally {
      setRevokingOthers(false);
      setRevokeOthersOpen(false);
    }
  };

  const otherSessionCount = sessions.filter((s) => !s.current).length;
  const loginEvents = activity.filter((e) => LOGIN_ACTIONS.has(e.action));

  return (
    <>
      <div className="account-field-lg">
        <label className="account-field-label">Active sessions</label>
        <p className="account-field-desc">
          Devices currently signed into your account. Revoking a session forces that device to sign
          in again.
        </p>

        {!loaded ? null : sessions.length === 0 ? (
          <div className="account-activity-empty">No active sessions.</div>
        ) : (
          <div className="account-device-list">
            {sessions.map((s) => {
              const { kind, os, browser } = classifyDevice(s.user_agent);
              return (
                <div
                  key={s.jti}
                  className={`account-device-item ${s.current ? "account-device-current" : ""}`}
                >
                  <div className="account-device-icon" aria-hidden="true">
                    <DeviceIcon kind={kind} />
                  </div>
                  <div className="account-device-body">
                    <div className="account-device-title">
                      <span>{os}</span>
                      {s.current && <span className="account-device-badge">This device</span>}
                    </div>
                    <div className="account-device-meta">{browser}</div>
                    <div className="account-device-meta account-device-meta--dim">
                      {s.ip ? `${s.ip} · ` : ""}
                      Last active {formatAgo(s.last_seen_at)} · Signed in {formatAgo(s.created_at)}
                    </div>
                  </div>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => askRevoke(s.jti, !!s.current)}
                    loading={busyJti === s.jti}
                    disabled={busyJti !== null}
                  >
                    {s.current ? "Sign out" : "Revoke"}
                  </Button>
                </div>
              );
            })}
          </div>
        )}

        <div className="account-device-actions">
          <Button
            variant="danger"
            size="sm"
            onClick={askRevokeOthers}
            loading={revokingOthers}
            disabled={revokingOthers || otherSessionCount === 0}
          >
            Sign out all other devices
          </Button>
          <span className="account-device-actions-hint">
            {otherSessionCount === 0
              ? "Only this device is signed in."
              : `${otherSessionCount} other ${otherSessionCount === 1 ? "device is" : "devices are"} signed in.`}
          </span>
        </div>
      </div>

      <div className="account-field-lg">
        <label className="account-field-label">Login &amp; IP history</label>
        <p className="account-field-desc">
          Recent sign-ins and authentication events on your account.
        </p>
        {!loaded ? null : loginEvents.length === 0 ? (
          <div className="account-activity-empty">No sign-in activity recorded yet.</div>
        ) : (
          <div className="account-activity-list">
            {loginEvents.slice(0, 30).map((event, i) => {
              const isError = event.action.includes("failed") || event.action.includes("error");
              return (
                <div key={i} className="account-activity-item">
                  <div
                    className={`account-activity-dot ${
                      isError ? "account-activity-dot--error" : "account-activity-dot--success"
                    }`}
                    aria-hidden="true"
                  />
                  <div className="account-activity-body">
                    <span className="account-activity-action">
                      {event.action.replace(/_/g, " ")}
                    </span>
                    {event.detail && (
                      <span className="account-activity-detail">{event.detail}</span>
                    )}
                    {event.user_agent && (
                      <span className="account-activity-detail">
                        {describeUserAgent(event.user_agent)}
                      </span>
                    )}
                  </div>
                  {event.ip && <span className="account-activity-meta">{event.ip}</span>}
                  <span className="account-activity-time">{formatAgo(event.created_at)}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <ConfirmDialog
        open={revokeTarget !== null}
        onClose={() => setRevokeTarget(null)}
        onConfirm={performRevoke}
        title={revokeTarget?.isCurrent ? "Sign out this device" : "Revoke session"}
        confirmLabel={revokeTarget?.isCurrent ? "Sign out" : "Revoke"}
        destructive
        loading={busyJti !== null}
        message={
          revokeTarget?.isCurrent ? (
            <p>You'll be returned to the login screen. Active work in this tab will be lost.</p>
          ) : (
            <p>
              This session will be revoked immediately. The device will need to sign in again to
              continue.
            </p>
          )
        }
      />
      <ConfirmDialog
        open={revokeOthersOpen}
        onClose={() => setRevokeOthersOpen(false)}
        onConfirm={performRevokeOthers}
        title="Sign out other devices"
        confirmLabel="Sign out others"
        destructive
        loading={revokingOthers}
        message={<p>You'll stay signed in here. Every other session is invalidated immediately.</p>}
      />
    </>
  );
}
