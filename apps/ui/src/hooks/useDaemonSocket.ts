import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { activityKeys, agentKeys, entityKeys, questKeys, runtimeKeys } from "@/queries/keys";
import { getScopedEntity } from "@/lib/appMode";
import { useAuthStore } from "@/store/auth";
import { useDaemonStore } from "@/store/daemon";
import { useInboxStore } from "@/store/inbox";
import { useUIStore } from "@/store/ui";

export function useDaemonSocket() {
  const queryClient = useQueryClient();
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
      const entity = getScopedEntity();
      // No active entity = no scope to subscribe to. The backend proxy
      // requires `root` to route to a runtime; opening with `root=`
      // (empty) just produces a wss handshake error and a reconnect
      // loop. User-scope routes (`/`, `/account`) hit this every time.
      if (!entity) {
        setWsConnected(false);
        return;
      }
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
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
            void queryClient.invalidateQueries({ queryKey: activityKeys.all });
          }
          if (msg.event === "quest_update" || msg.event === "task_update") {
            fetchQuests();
            void queryClient.invalidateQueries({ queryKey: questKeys.all });
            void queryClient.invalidateQueries({ queryKey: activityKeys.all });
            void queryClient.invalidateQueries({ queryKey: runtimeKeys.cost });
          }
          if (msg.event === "agent_update") {
            fetchAgents();
            void queryClient.invalidateQueries({ queryKey: agentKeys.all });
            void queryClient.invalidateQueries({ queryKey: entityKeys.all });
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
    queryClient,
    appMode,
    activeEntity,
    pushWorkerEvent,
    setWsConnected,
    fetchQuests,
    fetchAgents,
    pushInboxUpdate,
  ]);
}
