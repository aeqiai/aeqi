import { useEffect, useRef } from "react";
import { getScopedRoot } from "@/lib/appMode";
import { useAuthStore } from "@/store/auth";
import { useDaemonStore } from "@/store/daemon";
import { useUIStore } from "@/store/ui";

export function useDaemonSocket() {
  const token = useAuthStore((s) => s.token);
  const appMode = useAuthStore((s) => s.appMode);
  const activeRoot = useUIStore((s) => s.activeRoot);
  const pushWorkerEvent = useDaemonStore((s) => s.pushWorkerEvent);
  const setWsConnected = useDaemonStore((s) => s.setWsConnected);
  const fetchQuests = useDaemonStore((s) => s.fetchQuests);
  const fetchAgents = useDaemonStore((s) => s.fetchAgents);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (!token) return;

    let closed = false;
    let reconnectTimer: ReturnType<typeof setTimeout>;

    const connect = () => {
      if (closed) return;
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const root = getScopedRoot();
      const ws = new WebSocket(
        `${protocol}//${window.location.host}/api/ws?token=${token}&root=${encodeURIComponent(root)}`,
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
  }, [token, appMode, activeRoot, pushWorkerEvent, setWsConnected, fetchQuests, fetchAgents]);
}
