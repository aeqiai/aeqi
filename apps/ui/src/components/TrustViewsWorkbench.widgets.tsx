import {
  Activity,
  AppWindow,
  BarChart3,
  Bot,
  Eye,
  Globe2,
  LayoutDashboard,
  ListChecks,
  MessageSquare,
  UsersRound,
} from "lucide-react";
import type { ActivityEntry, Agent, EntityViewWidgetKind, Quest, Trust } from "@/lib/types";

interface WidgetDefinition {
  kind: EntityViewWidgetKind;
  label: string;
  description: string;
  source: string;
  icon: typeof LayoutDashboard;
}

export interface WidgetRenderData {
  entity: Trust | undefined;
  basePath: string;
  agents: Agent[];
  quests: Quest[];
  events: ActivityEntry[];
}

export const WIDGETS: WidgetDefinition[] = [
  {
    kind: "identity",
    label: "Identity",
    description: "TRUST status, public surface, and on-chain identity.",
    source: "trust",
    icon: Globe2,
  },
  {
    kind: "sessions",
    label: "Sessions",
    description: "Pinned operating conversations and pending replies.",
    source: "sessions",
    icon: MessageSquare,
  },
  {
    kind: "agents",
    label: "Agents",
    description: "Runtime workers assigned to this TRUST.",
    source: "agents",
    icon: Bot,
  },
  {
    kind: "quests",
    label: "Quests",
    description: "Open execution ledger and current work.",
    source: "quests",
    icon: ListChecks,
  },
  {
    kind: "ideas",
    label: "Ideas",
    description: "Memory, evidence, and reusable context.",
    source: "ideas",
    icon: BarChart3,
  },
  {
    kind: "apps",
    label: "Apps",
    description: "Connected apps and operational integrations.",
    source: "apps",
    icon: AppWindow,
  },
  {
    kind: "events",
    label: "Events",
    description: "Recent automation and audit trail.",
    source: "events",
    icon: Activity,
  },
  {
    kind: "economy",
    label: "Markets",
    description: "Public listing, cap-table readiness, and capital surfaces.",
    source: "economy",
    icon: UsersRound,
  },
  {
    kind: "website",
    label: "Website",
    description: "Public site, data room, and analytics readiness.",
    source: "apps.website",
    icon: Eye,
  },
];

const WIDGET_BY_KIND = new Map(WIDGETS.map((widget) => [widget.kind, widget]));

export function ViewWidget({ kind, data }: { kind: EntityViewWidgetKind; data: WidgetRenderData }) {
  const definition = WIDGET_BY_KIND.get(kind);
  if (!definition) return null;
  const Icon = definition.icon;
  const details = widgetDetails(kind, data);

  return (
    <article className="trust-view-widget">
      <header className="trust-view-widget-head">
        <span className="trust-view-widget-icon">
          <Icon size={16} strokeWidth={1.7} aria-hidden />
        </span>
        <span className="trust-view-widget-copy">
          <strong>{definition.label}</strong>
          <small>{definition.description}</small>
        </span>
      </header>
      <div className="trust-view-widget-metric">
        <span>{details.value}</span>
        <small>{details.label}</small>
      </div>
      <ul className="trust-view-widget-list" aria-label={`${definition.label} signals`}>
        {details.rows.map((row) => (
          <li key={row}>{row}</li>
        ))}
      </ul>
    </article>
  );
}

function widgetDetails(kind: EntityViewWidgetKind, data: WidgetRenderData) {
  const openQuests = data.quests.filter(
    (quest) => quest.status !== "done" && quest.status !== "cancelled",
  );
  const recentEvents = data.events.slice(0, 3);
  const publicState = data.entity?.public ? "Public" : "Private";
  const hasChain = Boolean(data.entity?.trust_address || data.entity?.trust_id);
  const agentRows = data.agents.slice(0, 3).map((agent) => `${agent.name} - ${agent.status}`);
  const questRows = openQuests.slice(0, 3).map((quest) => quest.idea?.name ?? quest.id);
  const eventRows = recentEvents.map((event) => event.summary || event.decision_type).slice(0, 3);

  switch (kind) {
    case "identity":
      return {
        value: publicState,
        label: hasChain ? "on-chain identity indexed" : "platform identity",
        rows: [
          data.entity?.name ?? "Unknown TRUST",
          data.entity?.slug ? `${data.entity.slug}.aeqi.ai` : "No public slug",
          hasChain ? "TRUST address present" : "TRUST address pending",
        ],
      };
    case "sessions":
      return {
        value: "Pinned",
        label: "session view",
        rows: [
          "My sessions is available in the sidebar",
          "Composer and participant chrome mounted",
        ],
      };
    case "agents":
      return {
        value: data.agents.length,
        label: data.agents.length === 1 ? "agent" : "agents",
        rows: agentRows.length > 0 ? agentRows : ["No agents indexed"],
      };
    case "quests":
      return {
        value: openQuests.length,
        label: "open quests",
        rows: questRows.length > 0 ? questRows : ["No open quests indexed"],
      };
    case "ideas":
      return {
        value: "Memory",
        label: "idea graph",
        rows: ["Ideas widget reserved for entity-scoped memory counts", "Open Ideas for evidence"],
      };
    case "apps":
      return {
        value: "Apps",
        label: "integration registry",
        rows: ["Mail, Drive, website, and custom apps stay grouped", "Open Apps for credentials"],
      };
    case "events":
      return {
        value: recentEvents.length,
        label: "recent events",
        rows: eventRows.length > 0 ? eventRows : ["No recent events indexed"],
      };
    case "economy":
      return {
        value: hasChain ? "Ready" : "Pending",
        label: "capital surface",
        rows: ["Markets verify indexed TRUST identity", "Cap-table seed status lives in Markets"],
      };
    case "website":
      return {
        value: data.entity?.slug ? "Live" : "Setup",
        label: "public data room",
        rows: [
          data.entity?.slug ? `${data.entity.slug}.aeqi.ai` : "Public slug not set",
          "Public overview can share selected widgets",
        ],
      };
  }
}
