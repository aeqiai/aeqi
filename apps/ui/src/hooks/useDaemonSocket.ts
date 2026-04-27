import { useEffect, useRef } from "react";
import { getScopedEntity } from "@/lib/appMode";
import { useAuthStore } from "@/store/auth";
import { useDaemonStore } from "@/store/daemon";
import { useInboxStore } from "@/store/inbox";
import { useUIStore } from "@/store/ui";

export function useDaemonSocket() {
  const token = useAuthStore((s) => s.token);
  const appMode = useAuthStore((s) => s.appMode);
  const activeEntity = useUIStore((s) => s.activeEntity);
  const pushWorkerEvent = useDaemonStore((s) => s.pushWorkerEvent);
  const setWsConnected = useDaemonStore((s) => s.setWsConnected);
  const fetchQuests = useDaemonStore((s) => s.fetchQuests);
  const fetchAgents = useDaemonStore((s) => s.fetchAgents);
  const pushInboxUpdate = useInboxStore((s) => s.pushInboxUpdate);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (!token) return;

    let closed = false;
    let reconnectTimer: ReturnType<typeof setTimeout>;

    const connect = () => {
      if (closed) return;
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const entity = getScopedEntity();
      const ws = new WebSocket(
        `${protocol}//${window.location.host}/api/ws?token=${token}&root=${encodeURIComponent(entity)}`,
      );
      wsRef.current = ws;

      ws.onopen = () => setWsConnected(true);

      ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data);
          if (msg.event === "worker" && msg.data) {
            pushWorkerEvent(msg.data);
          }
          if (msg.event === "quest_update" || msg.event === "task_update") {
            fetchQuests();
          }
          if (msg.event === "agent_update") {
            fetchAgents();
          }
          if (msg.event === "inbox_update" && msg.data) {
            pushInboxUpdate(msg.data);
          }
        } catch {
          // ignore malformed messages
        }
      };

      ws.onclose = () => {
        setWsConnected(false);
        if (!closed) {
          reconnectTimer = setTimeout(connect, 3000);
        }
      };

      ws.onerror = () => ws.close();
    };

    connect();

    return () => {
      closed = true;
      clearTimeout(reconnectTimer);
      wsRef.current?.close();
      setWsConnected(false);
    };
  }, [
    token,
    appMode,
    activeEntity,
    pushWorkerEvent,
    setWsConnected,
    fetchQuests,
    fetchAgents,
    pushInboxUpdate,
  ]);
}
