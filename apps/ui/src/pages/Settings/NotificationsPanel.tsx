import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { logError } from "@/lib/logging";
import { Banner, Button, Card, EmptyState, Loading } from "@/components/ui";

/**
 * `/account/notifications` — per-channel suppression preferences for the
 * current user. Quest 67-189.2.1.1.
 *
 * Today only the email channel is surfaced (the only one the suppression
 * store carries entries for from the email send-time gate + RFC 8058
 * unsubscribe landing route). When bindings start carrying user_id and
 * other channels light up (Telegram, SMS), the API returns a longer list
 * and this panel renders all of them with the same row affordance.
 */
type Channel = { channel: string; address: string; suppressed: boolean };

export default function NotificationsPanel() {
  const [channels, setChannels] = useState<Channel[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  /** Tracks the channel currently being toggled so we can disable just that row's button. */
  const [pendingChannel, setPendingChannel] = useState<string | null>(null);

  const reload = useCallback(() => {
    setLoading(true);
    setError(null);
    api
      .getAccountNotifications()
      .then((data) => setChannels(data.channels))
      .catch((e: unknown) => {
        const msg = e instanceof Error ? e.message : "Could not load notification settings.";
        logError("notifications.list", e);
        setError(msg);
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  const toggle = useCallback(
    async (channel: Channel) => {
      setPendingChannel(channel.channel);
      // Optimistic flip; revert on error.
      setChannels((prev) =>
        prev
          ? prev.map((c) =>
              c.channel === channel.channel ? { ...c, suppressed: !c.suppressed } : c,
            )
          : prev,
      );
      try {
        if (channel.suppressed) {
          await api.resumeAccountNotification(channel.channel);
        } else {
          await api.stopAccountNotification(channel.channel);
        }
        // Re-fetch to source-of-truth from the suppression store.
        reload();
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Could not update notification settings.";
        logError("notifications.toggle", e);
        // Revert optimistic flip.
        setChannels((prev) =>
          prev
            ? prev.map((c) =>
                c.channel === channel.channel ? { ...c, suppressed: channel.suppressed } : c,
              )
            : prev,
        );
        setError(msg);
      } finally {
        setPendingChannel(null);
      }
    },
    [reload],
  );

  if (loading && channels === null) {
    return <Loading size="md" />;
  }

  return (
    <div className="account-page-panel">
      <h1>Notifications</h1>
      <p className="account-page-lede">
        Choose which channels send you AEQI notifications. Sign-in security and billing receipts
        always go through — these settings only affect activity, activation, and product updates.
      </p>

      {error && <Banner kind="error">{error}</Banner>}

      {channels && channels.length === 0 ? (
        <EmptyState
          title="No notifications yet"
          description="You haven't received any AEQI notifications, so there's nothing to manage here."
        />
      ) : (
        <Card>
          <ul className="account-page-list">
            {channels?.map((ch) => (
              <li key={ch.channel} className="account-page-row">
                <div className="account-page-row-text">
                  <div className="account-page-row-title">{labelForChannel(ch.channel)}</div>
                  <div className="account-page-row-meta">
                    <code>{ch.address}</code> · {ch.suppressed ? "Stopped" : "Active"}
                  </div>
                </div>
                <Button
                  variant={ch.suppressed ? "primary" : "secondary"}
                  disabled={pendingChannel === ch.channel}
                  onClick={() => toggle(ch)}
                >
                  {pendingChannel === ch.channel ? "Saving…" : ch.suppressed ? "Resume" : "Stop"}
                </Button>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

function labelForChannel(channel: string): string {
  switch (channel) {
    case "email":
      return "Email";
    case "telegram":
      return "Telegram";
    case "sms":
      return "SMS";
    default:
      return channel.charAt(0).toUpperCase() + channel.slice(1);
  }
}
