import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ListFilter } from "lucide-react";
import AgentToolSettings from "@/components/AgentToolSettings";
import { ALL_TOOLS } from "@/lib/tools";
import { useDaemonStore } from "@/store/daemon";
import { Button, Icon, PrimitivePageHeader, PrimitiveSearchField, ToolbarRadioPopover } from "./ui";
import "@/styles/overview.css";

type ToolStatusFilter = "all" | "on" | "off";

const STATUS_LABELS: Record<ToolStatusFilter, string> = {
  all: "All",
  on: "On",
  off: "Off",
};

const STATUS_ORDER: ToolStatusFilter[] = ["all", "on", "off"];

export default function TrustToolsTab({ agentId }: { agentId: string }) {
  const agents = useDaemonStore((s) => s.agents);
  const agent = agents.find((a) => a.id === agentId);
  const resolvedAgentId = agent?.id || agentId;
  const denied = useMemo(() => agent?.tool_deny ?? [], [agent?.tool_deny]);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<ToolStatusFilter>("all");
  const [toast, setToast] = useState<{ message: string; isError: boolean } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeCount = ALL_TOOLS.filter((tool) =>
    tool.id === "question.ask" ? !!agent?.can_ask_director : !denied.includes(tool.id),
  ).length;
  const blockedCount = ALL_TOOLS.length - activeCount;
  const visibleTools = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return ALL_TOOLS.filter((tool) => {
      const allowed =
        tool.id === "question.ask" ? !!agent?.can_ask_director : !denied.includes(tool.id);
      if (status === "on" && !allowed) return false;
      if (status === "off" && allowed) return false;
      if (!needle) return true;
      return [tool.label, tool.id, tool.category, tool.description]
        .join(" ")
        .toLowerCase()
        .includes(needle);
    });
  }, [agent?.can_ask_director, denied, query, status]);

  const showToast = useCallback((message: string, isError = false) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ message, isError });
    toastTimer.current = setTimeout(() => setToast(null), 3000);
  }, []);

  useEffect(() => {
    return () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
    };
  }, []);

  return (
    <div className="trust-tools-page trust-primitive-shell">
      {toast && (
        <div
          className={`agent-settings-toast${toast.isError ? " agent-settings-toast--error" : ""}`}
          role="status"
        >
          {toast.message}
        </div>
      )}

      <PrimitivePageHeader
        className="trust-tools-page-header trust-primitive-shell-header"
        title={
          <span className="trust-primitive-page-title">
            <span className="trust-primitive-page-title-text">Tools</span>
            <span className="trust-primitive-page-count" aria-hidden="true">
              {activeCount}
            </span>
          </span>
        }
        aria-label="Tool controls"
      >
        <div className="ideas-toolbar trust-tools-toolbar">
          <PrimitiveSearchField
            placeholder="Search tools"
            value={query}
            onChange={setQuery}
            onEscapeEmpty={(e) => e.currentTarget.blur()}
          />
          <ToolbarRadioPopover
            label="Filter"
            current={STATUS_LABELS[status]}
            glyph={<Icon icon={ListFilter} size="sm" />}
            options={STATUS_ORDER.map((id) => ({ id, label: STATUS_LABELS[id] }))}
            value={status}
            onChange={setStatus}
            indicator={status !== "all"}
          />
        </div>
      </PrimitivePageHeader>

      <main
        className="trust-tools-main trust-tools-page-body trust-primitive-shell-surface"
        aria-label="Trust tools"
      >
        <section className="trust-tools-register trust-tools-card" aria-label="Tool register">
          <div className="trust-tools-register-head">
            <div>
              <p className="trust-tools-register-kicker">Default agent</p>
              <h2 className="trust-tools-register-title">{agent?.name ?? "No agent assigned"}</h2>
            </div>
            <dl className="trust-tools-register-stats" aria-label="Tool policy summary">
              <div>
                <dt>On</dt>
                <dd>{activeCount}</dd>
              </div>
              <div>
                <dt>Off</dt>
                <dd>{blockedCount}</dd>
              </div>
              <div>
                <dt>Shown</dt>
                <dd>{visibleTools.length}</dd>
              </div>
            </dl>
          </div>

          {resolvedAgentId ? (
            <AgentToolSettings
              agent={agent}
              className="trust-tools-list"
              resolvedAgentId={resolvedAgentId}
              showToast={showToast}
              titleId="trust-tools-title"
              showHeader={false}
              showSummary={false}
              tools={visibleTools}
              emptyState={
                <div className="trust-tools-state">
                  No tools match this filter.
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setQuery("");
                      setStatus("all");
                    }}
                  >
                    Clear filter
                  </Button>
                </div>
              }
            />
          ) : (
            <div className="trust-tools-state trust-tools-state--empty">
              Tool access is available after this trust has an agent.
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
