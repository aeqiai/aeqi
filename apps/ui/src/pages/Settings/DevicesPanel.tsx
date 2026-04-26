import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui";

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

function describeUserAgent(ua?: string): string {
  if (!ua) return "Unknown device";
  const lower = ua.toLowerCase();
  let os = "Unknown OS";
  if (lower.includes("mac os") || lower.includes("macintosh")) os = "macOS";
  else if (lower.includes("windows")) os = "Windows";
  else if (lower.includes("android")) os = "Android";
  else if (lower.includes("iphone") || lower.includes("ios")) os = "iOS";
  else if (lower.includes("linux")) os = "Linux";

  let browser = "Browser";
  if (lower.includes("edg/")) browser = "Edge";
  else if (lower.includes("chrome/") && !lower.includes("edg/")) browser = "Chrome";
  else if (lower.includes("firefox/")) browser = "Firefox";
  else if (lower.includes("safari/") && !lower.includes("chrome/")) browser = "Safari";

  return `${browser} on ${os}`;
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

  const revoke = async (jti: string, isCurrent: boolean) => {
    const msg = isCurrent
      ? "Sign out this device? You'll be returned to the login screen."
      : "Sign out this device? The session will be revoked immediately.";
    if (!window.confirm(msg)) return;
    setBusyJti(jti);
    try {
      await api.revokeAuthSession(jti);
      if (isCurrent) {
        window.location.href = "/login";
        return;
      }
      await loadSessions();
    } catch {
      // Surface failure quietly; refresh in case it actually succeeded.
      await loadSessions();
    } finally {
      setBusyJti(null);
    }
  };

  const revokeOthers = async () => {
    if (
      !window.confirm(
        "Sign out every other device? You'll stay signed in here, but every other session is invalidated.",
      )
    )
      return;
    setRevokingOthers(true);
    try {
      await api.revokeOtherAuthSessions();
      await loadSessions();
    } finally {
      setRevokingOthers(false);
    }
  };

  const otherSessionCount = sessions.filter((s) => !s.current).length;
  const loginEvents = activity.filter((e) => LOGIN_ACTIONS.has(e.action));

  return (
    <>
      <div className="account-field-lg">
        <div className="account-device-header">
          <div>
            <label className="account-field-label">Active sessions</label>
            <p className="account-field-desc">
              Devices currently signed into your account. Revoking a session forces that device to
              sign in again.
            </p>
          </div>
          {otherSessionCount > 0 && (
            <Button
              variant="secondary"
              size="sm"
              onClick={revokeOthers}
              loading={revokingOthers}
              disabled={revokingOthers}
            >
              Sign out other sessions
            </Button>
          )}
        </div>

        {!loaded ? null : sessions.length === 0 ? (
          <div className="account-activity-empty">No active sessions.</div>
        ) : (
          <div className="account-device-list">
            {sessions.map((s) => (
              <div
                key={s.jti}
                className={`account-device-item ${s.current ? "account-device-current" : ""}`}
              >
                <div className="account-device-body">
                  <div className="account-device-title">
                    <span>{describeUserAgent(s.user_agent)}</span>
                    {s.current && <span className="account-device-badge">This device</span>}
                  </div>
                  <div className="account-device-meta">
                    {s.ip ? `${s.ip} · ` : ""}
                    Last active {formatAgo(s.last_seen_at)} · Signed in {formatAgo(s.created_at)}
                  </div>
                </div>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => revoke(s.jti, !!s.current)}
                  loading={busyJti === s.jti}
                  disabled={busyJti !== null}
                >
                  {s.current ? "Sign out" : "Revoke"}
                </Button>
              </div>
            ))}
          </div>
        )}
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
    </>
  );
}
