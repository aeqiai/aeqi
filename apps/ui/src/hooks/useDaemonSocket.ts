import { useEffect, useRef } from "react";
import { useAuthStore } from "@/store/auth";
import { useDaemonStore } from "@/store/daemon";

export function useDaemonSocket() {
  const token = useAuthStore((s) => s.token);
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
      const ws = new WebSocket(`${protocol}//${window.location.host}/api/ws?token=${token}`);
      wsRef.current = ws;

      ws.onopen = () => setWsConnected(true);

      ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data);
          if (msg.event === "worker" && msg.data) {
            pushWorkerEvent(msg.data);
          }
          if (msg.event === "task_update") {
            fetchQuests();
          }
          if (msg.event === "agent_update") {
            fetchAgents();
          }
        } catch {}
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
  }, [token, pushWorkerEvent, setWsConnected, fetchQuests, fetchAgents]);
}
