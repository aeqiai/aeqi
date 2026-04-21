import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { Button, Badge, Spinner } from "./ui";

type BaileysState = "spawning" | "connecting" | "awaiting_qr" | "ready" | "disconnected";

interface BaileysStatus {
  state: BaileysState;
  qr: string | null;
  qr_data_url: string | null;
  last_reason: string | null;
  me: string | null;
}

const STATE_COPY: Record<BaileysState, { label: string; variant: "info" | "success" | "warning" }> =
  {
    spawning: { label: "Starting bridge", variant: "info" },
    connecting: { label: "Connecting to WhatsApp", variant: "info" },
    awaiting_qr: { label: "Scan QR to pair", variant: "info" },
    ready: { label: "Paired", variant: "success" },
    disconnected: { label: "Disconnected", variant: "warning" },
  };

/**
 * WhatsApp Baileys pairing panel.
 *
 * Polls `GET /channels/:id/baileys-status` every ~2s while paring. The
 * bridge streams QR codes as they rotate (Baileys rotates every ~20s);
 * we display whichever was last emitted. Once `state === "ready"` we
 * stop re-polling and switch to a sparse heartbeat.
 */
export function BaileysPairingPanel({ channelId }: { channelId: string }) {
  const [status, setStatus] = useState<BaileysStatus | null>(null);
  const [loggingOut, setLoggingOut] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    let cancelled = false;
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;

    async function tick() {
      if (cancelled) return;
      try {
        const resp = await api.getChannelBaileysStatus(channelId);
        if (cancelled) return;
        setStatus(resp.status);
        setError(null);
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "Failed to load status");
      }
      if (cancelled) return;
      const interval = status?.state === "ready" ? 8000 : 2000;
      window.setTimeout(tick, interval);
    }
    tick();
    return () => {
      cancelled = true;
      ac.abort();
    };
    // Re-start polling if the channel id changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelId]);

  const handleLogout = async () => {
    if (!window.confirm("Log out WhatsApp? You'll need to scan a new QR to reconnect.")) return;
    setLoggingOut(true);
    setError(null);
    try {
      await api.logoutChannelBaileys(channelId);
      setStatus((s) =>
        s
          ? { ...s, state: "disconnected", qr: null, qr_data_url: null, last_reason: "logged_out" }
          : s,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Logout failed");
    } finally {
      setLoggingOut(false);
    }
  };

  if (!status) {
    return (
      <div className="baileys-pairing" aria-busy="true">
        <p className="baileys-pairing-hint">
          <Spinner size="sm" />
          Loading pairing status…
        </p>
      </div>
    );
  }

  const copy = STATE_COPY[status.state];

  return (
    <div className="baileys-pairing">
      <div className="baileys-pairing-header">
        <Badge variant={copy.variant}>{copy.label}</Badge>
        {status.me && <span className="baileys-pairing-me">{status.me}</span>}
      </div>

      {status.state === "awaiting_qr" && status.qr_data_url && (
        <div className="baileys-pairing-qr">
          <img src={status.qr_data_url} alt="WhatsApp pairing QR code" width={260} height={260} />
          <ol className="baileys-pairing-steps">
            <li>Open WhatsApp on your phone</li>
            <li>Tap Settings → Linked Devices</li>
            <li>Tap “Link a Device” and scan this code</li>
          </ol>
        </div>
      )}

      {status.state === "awaiting_qr" && !status.qr_data_url && (
        <p className="baileys-pairing-hint">Waiting for QR from the bridge…</p>
      )}

      {status.state === "ready" && (
        <div className="baileys-pairing-ready">
          <p>This device is paired. Incoming messages will be routed to this agent.</p>
          <Button variant="danger" size="sm" onClick={handleLogout} loading={loggingOut}>
            {loggingOut ? "Logging out…" : "Log out and reset"}
          </Button>
        </div>
      )}

      {status.state === "disconnected" && (
        <p className="baileys-pairing-hint">
          Bridge is disconnected
          {status.last_reason ? ` (${status.last_reason})` : ""}. Waiting to reconnect…
        </p>
      )}

      {(status.state === "spawning" || status.state === "connecting") && (
        <p className="baileys-pairing-hint">Bringing the WhatsApp bridge online…</p>
      )}

      {error && <div className="channel-form-error">{error}</div>}
    </div>
  );
}
