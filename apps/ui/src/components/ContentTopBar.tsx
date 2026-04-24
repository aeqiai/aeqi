import { Link, useNavigate, useParams } from "react-router-dom";
import { useDaemonStore } from "@/store/daemon";
import { useAuthStore } from "@/store/auth";
import { Button } from "@/components/ui";
import AgentAvatar from "./AgentAvatar";
import BudgetMeter from "./BudgetMeter";

/**
 * Content top bar — the layout navigation row.
 *
 * Always mounted, architectural, matching the sidebar tint so the header
 * band reads as one continuous strip across the viewport. Carries:
 * breadcrumb context (home / profile / {agent} / {section}), agent-scoped
 * actions (Settings), and the budget meter.
 *
 * Global chrome affordances (search pill, shortcuts `?`) live in the
 * left sidebar — the topbar stays purely about in-scope navigation.
 * Primary "New X" CTAs still live inline in each tab's body — the tab's
 * own picker owns its "+" button. The topbar is *navigation + context*,
 * never the primary CTA surface.
 */

// Only the four W-primitives earn a breadcrumb. `sessions` is the
// agent's default surface (no crumb), and settings/tools/channels are
// carried by the lit Settings button + the settings-shell sub-tab row
// below; repeating them here is just noise.
const PRIMITIVE_WORDS: Record<string, string> = {
  agents: "Agents",
  events: "Events",
  quests: "Quests",
  ideas: "Ideas",
};

export default function ContentTopBar() {
  const { tab, agentId } = useParams<{ tab?: string; agentId?: string }>();
  const navigate = useNavigate();
  const cost = useDaemonStore((s) => s.cost);
  const agents = useDaemonStore((s) => s.agents);
  const appMode = useAuthStore((s) => s.appMode);

  const agent = agents.find((a) => a.id === agentId || a.name === agentId);
  const section = tab || "sessions";
  const primitiveWord = PRIMITIVE_WORDS[section];
  // The crumb is always a link once a primitive + agent are resolved —
  // from an item detail it pops back to the list, from compose mode it
  // sheds the `?compose=1` param, from the list itself the nav is a
  // no-op. React Router collapses identical destinations, so this is
  // safe and the affordance stays consistent.
  const crumbIsLink = Boolean(primitiveWord && agent);

  const settingsActive = section === "settings" || section === "tools" || section === "channels";
  const showCrumb = Boolean(primitiveWord);

  const agentName = agent ? agent.name : "";

  return (
    <div className="content-topbar">
      <div className="content-topbar-title">
        {agent &&
          (section === "sessions" ? (
            <span className="content-topbar-agent">
              <span className="content-topbar-agent-avatar" aria-hidden>
                <AgentAvatar name={agentName} />
              </span>
              <span className="content-topbar-agent-name">{agentName}</span>
            </span>
          ) : (
            <Link
              to={`/${encodeURIComponent(agent.id)}`}
              className="content-topbar-agent content-topbar-agent-link"
              title={`Back to ${agentName}'s home`}
            >
              <span className="content-topbar-agent-avatar" aria-hidden>
                <AgentAvatar name={agentName} />
              </span>
              <span className="content-topbar-agent-name">{agentName}</span>
            </Link>
          ))}
        {agent && showCrumb && <span className="content-topbar-sep">/</span>}
        {showCrumb &&
          (crumbIsLink ? (
            <Link
              to={`/${encodeURIComponent(agent!.id)}/${section}`}
              className="content-topbar-crumb content-topbar-crumb-link"
              title={`Back to ${primitiveWord?.toLowerCase()}`}
            >
              {primitiveWord}
            </Link>
          ) : (
            <span className="content-topbar-crumb">{primitiveWord}</span>
          ))}
      </div>

      <div className="content-topbar-right">
        {agent && (
          <Button
            variant="secondary"
            size="sm"
            className={`topbar-settings-btn${settingsActive ? " active" : ""}`}
            onClick={() => navigate(`/${encodeURIComponent(agent.id)}/settings`)}
            title="Agent settings — model, tools, channels"
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <circle cx="8" cy="8" r="2" />
              <path d="M8 1.5v2M8 12.5v2M14.5 8h-2M3.5 8h-2M12.7 3.3l-1.4 1.4M4.7 11.3l-1.4 1.4M12.7 12.7l-1.4-1.4M4.7 4.7l-1.4-1.4" />
            </svg>
            Settings
          </Button>
        )}
        {appMode !== "platform" && (
          <BudgetMeter
            spent={(cost?.spent_today_usd as number) ?? 0}
            cap={agent?.budget_usd ?? (cost?.daily_budget_usd as number) ?? 0}
          />
        )}
      </div>
    </div>
  );
}
