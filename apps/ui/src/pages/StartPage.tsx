import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, BookOpen, Globe, Plus, Rocket, Settings, Users } from "lucide-react";
import { useAgents } from "@/queries/agents";
import { useEntities } from "@/queries/entities";
import { useVisibleIdeas } from "@/queries/ideas";
import { useQuests } from "@/queries/quests";
import TrustAvatar from "@/components/TrustAvatar";
import UserAvatar from "@/components/UserAvatar";
import { timeShort } from "@/lib/format";
import type { InboxItem } from "@/lib/api";
import type { Quest, Trust } from "@/lib/types";
import { sessionDeepUrlFromId } from "@/lib/sessionUrl";
import { useAuthStore } from "@/store/auth";
import { useDaemonStore } from "@/store/daemon";
import { useInboxStore } from "@/store/inbox";
import { useUIStore } from "@/store/ui";
import { LEARN_POSTS } from "./startPageLearnPosts";

const INBOX_PREVIEW_LIMIT = 4;
const CURRENT_ROLE = "Director";

export default function StartPage() {
  const user = useAuthStore((s) => s.user);
  const activeEntityId = useUIStore((s) => s.activeEntity);
  const entities = useEntities();
  const agents = useAgents();
  const events = useDaemonStore((s) => s.events);
  const inboxItems = useInboxStore((s) => s.items);
  const fetchInbox = useInboxStore((s) => s.fetchInbox);

  useEffect(() => {
    fetchInbox().catch(() => {
      // The inbox store owns error presentation; Home keeps the preview quiet.
    });
  }, [fetchInbox]);

  const activeTrust = useMemo(() => {
    if (activeEntityId) {
      const selected = entities.find((entity) => entity.id === activeEntityId);
      if (selected) return selected;
    }
    return entities[0] ?? null;
  }, [activeEntityId, entities]);

  const questParams = useMemo(
    () => (activeTrust ? { root: activeTrust.id } : undefined),
    [activeTrust],
  );
  const quests = useQuests(questParams);
  const { data: visibleIdeas = [] } = useVisibleIdeas(Boolean(activeTrust));

  const actorName = useMemo(
    () => user?.name?.trim() || user?.email?.split("@")[0] || "Operator",
    [user],
  );
  const actorLine = user?.email || "Personal command surface";

  const inboxCount = inboxItems.length;
  const awaitingCount = useMemo(
    () => inboxItems.filter((item) => !!item.awaiting_at).length,
    [inboxItems],
  );
  const inboxLabel =
    awaitingCount > 0
      ? `${awaitingCount} awaiting`
      : inboxCount > 0
        ? `${inboxCount} in Inbox`
        : "Inbox clear";
  const inboxPillState: "review" | "progress" | "idle" =
    awaitingCount > 0 ? "review" : inboxCount > 0 ? "progress" : "idle";

  const trustNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const entity of entities) map.set(entity.id, entity.name);
    return map;
  }, [entities]);

  const activeInboxItems = useMemo(() => {
    if (!activeTrust) return [];
    return inboxItems.filter((item) => item.trust_id === activeTrust.id);
  }, [activeTrust, inboxItems]);

  const currentAgents = useMemo(() => {
    if (!activeTrust) return [];
    return agents.filter((agent) => !agent.trust_id || agent.trust_id === activeTrust.id);
  }, [activeTrust, agents]);

  const runningAgents = useMemo(
    () =>
      currentAgents.filter((agent) =>
        ["active", "online", "running"].includes(agent.status.toLowerCase()),
      ),
    [currentAgents],
  );

  const currentAgentNames = useMemo(
    () => new Set(currentAgents.map((agent) => agent.name)),
    [currentAgents],
  );

  const currentQuests = useMemo(
    () => quests.filter((quest) => quest.status !== "done" && quest.status !== "cancelled"),
    [quests],
  );

  const recentEventCount = useMemo(() => {
    if (!activeTrust) return 0;
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    return events.filter((event) => {
      const timestamp = Date.parse(event.timestamp || event.created_at || "");
      if (Number.isNaN(timestamp) || timestamp < cutoff) return false;
      if (event.metadata?.root === activeTrust.id) return true;
      return Boolean(event.agent && currentAgentNames.has(event.agent));
    }).length;
  }, [activeTrust, currentAgentNames, events]);

  const latestActivity = useMemo(
    () => latestActivityLabel(activeTrust, activeInboxItems, currentQuests),
    [activeTrust, activeInboxItems, currentQuests],
  );

  const inboxPreview = inboxItems.slice(0, INBOX_PREVIEW_LIMIT);

  return (
    <div className="home-page">
      <header className="home-hero">
        <img src="/welcome/start-hero.png" alt="" className="home-hero-image" aria-hidden="true" />
        <Link
          to="/account"
          className="home-hero-settings"
          aria-label="Open account settings"
          title="Account settings"
        >
          <Settings size={16} strokeWidth={1.6} />
        </Link>
        <div className="home-hero-overlay">
          <div className="home-hero-identity">
            <span className="home-hero-avatar" aria-hidden="true">
              <UserAvatar name={actorName} size={58} src={user?.avatar_url} />
            </span>
            <div className="home-hero-text">
              <p className="home-hero-eyebrow">Welcome back</p>
              <h1 className="home-hero-title">{actorName}</h1>
              <p className="home-hero-subtitle">{actorLine}</p>
            </div>
          </div>
        </div>
      </header>

      <section className="home-row-trusts" aria-label="Operating context">
        <OperatingContextCard
          activeTrust={activeTrust}
          activeRole={CURRENT_ROLE}
          inboxCount={activeInboxItems.length}
          questCount={currentQuests.length}
          ideaCount={visibleIdeas.length}
          eventCount={recentEventCount}
          agentCount={runningAgents.length}
          latestActivity={latestActivity}
        />
        <LaunchTrustCard />
      </section>

      <section className="home-row-two" aria-label="Inbox and economy">
        <InboxPreviewCard
          entities={entities}
          inboxItems={inboxPreview}
          inboxLabel={inboxLabel}
          inboxPillState={inboxPillState}
          trustNameById={trustNameById}
        />
        <EconomyCard />
      </section>

      <LearnAeqiSection />
    </div>
  );
}

interface OperatingContextCardProps {
  activeTrust: Trust | null;
  activeRole: string;
  inboxCount: number;
  questCount: number;
  ideaCount: number;
  eventCount: number;
  agentCount: number;
  latestActivity: string;
}

function OperatingContextCard({
  activeTrust,
  activeRole,
  inboxCount,
  questCount,
  ideaCount,
  eventCount,
  agentCount,
  latestActivity,
}: OperatingContextCardProps) {
  if (!activeTrust) {
    return (
      <article className="home-card home-card--context home-card--empty">
        <div className="home-context-panel" aria-label="Current TRUST">
          <h2 className="home-context-heading">TRUST</h2>
          <div className="home-context-empty">
            <span className="home-context-avatar home-context-avatar--ghost" aria-hidden="true">
              <Plus size={26} strokeWidth={1.5} />
            </span>
            <h3 className="home-context-title">No active TRUST</h3>
            <p className="home-context-line">
              Launch a TRUST to create an operating context for roles, agents, quests, and memory.
            </p>
          </div>
          <Link to="/launch" className="home-primary-action">
            Launch TRUST
            <ArrowRight size={14} strokeWidth={1.8} />
          </Link>
        </div>
      </article>
    );
  }

  const activityItems = [
    { label: "Quests", value: questCount, hint: questCount === 1 ? "open" : "open" },
    { label: "Ideas", value: ideaCount, hint: ideaCount === 1 ? "stored" : "stored" },
    { label: "Event triggers", value: eventCount, hint: "last 24h" },
    { label: "Agents", value: agentCount, hint: agentCount === 1 ? "running" : "running" },
  ];

  return (
    <article className="home-card home-card--context">
      <section className="home-context-panel" aria-label="Current TRUST">
        <header className="home-context-head">
          <h2 className="home-context-heading">TRUST</h2>
          <span className="home-card-meta home-context-signal">
            <span className="home-card-meta-dot home-card-meta-dot--idle" aria-hidden="true" />
            {inboxCount > 0 ? `${inboxCount} in Inbox` : "Operating"}
          </span>
        </header>
        <div className="home-context-main">
          <span className="home-context-avatar" aria-hidden="true">
            <TrustAvatar name={activeTrust.name} size={68} />
          </span>
          <div className="home-context-copy">
            <h3 className="home-context-title">{activeTrust.name}</h3>
            <div className="home-context-role-card" aria-label={`Current role ${activeRole}`}>
              <span className="home-context-role-label">Current role</span>
              <span className="home-context-role">{activeRole}</span>
            </div>
          </div>
        </div>
        <dl className="home-context-insights" aria-label="TRUST activity overview">
          {activityItems.map((item) => (
            <div key={item.label}>
              <dt>{item.label}</dt>
              <dd>
                <span className="home-context-insight-value">{item.value}</span>
                <span className="home-context-insight-hint">{item.hint}</span>
              </dd>
            </div>
          ))}
        </dl>
        <div className="home-context-footer">
          <p className="home-context-line">Latest activity: {latestActivity}</p>
          <Link to="/trust" className="home-context-cta">
            Your TRUSTs
            <ArrowRight size={14} strokeWidth={1.8} />
          </Link>
        </div>
      </section>
    </article>
  );
}

function LaunchTrustCard() {
  return (
    <article className="home-card home-card--launch">
      <span className="home-launch-kicker">
        <Rocket size={15} strokeWidth={1.7} aria-hidden="true" />
        Launch
      </span>
      <div className="home-launch-body">
        <h3 className="home-launch-title">Launch a TRUST</h3>
        <p className="home-launch-hint">
          Start from a blueprint or create a blank programmable company.
        </p>
      </div>
      <div className="home-launch-actions">
        <Link to="/blueprints" className="home-step-btn home-step-btn--primary">
          <span className="home-step-btn-label">Browse Blueprints</span>
          <span className="home-step-btn-icon">
            <ArrowRight size={16} strokeWidth={1.8} />
          </span>
        </Link>
        <Link to="/launch" className="home-step-btn">
          <span className="home-step-btn-label">Launch</span>
          <span className="home-step-btn-icon">
            <Plus size={16} strokeWidth={1.8} />
          </span>
        </Link>
      </div>
    </article>
  );
}

interface InboxPreviewCardProps {
  entities: ReadonlyArray<Trust>;
  inboxItems: ReadonlyArray<InboxItem>;
  inboxLabel: string;
  inboxPillState: "review" | "progress" | "idle";
  trustNameById: ReadonlyMap<string, string>;
}

function InboxPreviewCard({
  entities,
  inboxItems,
  inboxLabel,
  inboxPillState,
  trustNameById,
}: InboxPreviewCardProps) {
  return (
    <article className="home-card home-card--inbox">
      <header className="home-inbox-head">
        <h2 className="home-inbox-title">Inbox</h2>
        <span className="home-card-meta home-inbox-signal">
          <span
            className={`home-card-meta-dot home-card-meta-dot--${inboxPillState}`}
            aria-hidden="true"
          />
          {inboxLabel}
        </span>
      </header>
      {inboxItems.length > 0 ? (
        <ul className="home-inbox-list">
          {inboxItems.map((item) => (
            <InboxPreviewRow
              key={item.session_id}
              item={item}
              entities={entities}
              trustNameById={trustNameById}
            />
          ))}
        </ul>
      ) : (
        <div className="home-inbox-empty">
          <span
            className={`home-inbox-empty-rail home-inbox-empty-rail--${inboxPillState}`}
            aria-hidden="true"
          />
          <span className="home-inbox-empty-copy">
            <p className="home-inbox-empty-title">Inbox clear</p>
            <p className="home-inbox-empty-hint">
              No reviews, approvals, failed events, or agent handoffs need attention.
            </p>
          </span>
        </div>
      )}
      <Link to="/inbox" className="home-inbox-cta">
        Inbox
        <ArrowRight size={14} strokeWidth={1.8} />
      </Link>
    </article>
  );
}

function InboxPreviewRow({
  item,
  entities,
  trustNameById,
}: {
  item: InboxItem;
  entities: ReadonlyArray<Trust>;
  trustNameById: ReadonlyMap<string, string>;
}) {
  const subject =
    item.awaiting_subject ||
    item.session_name ||
    item.last_agent_message?.slice(0, 80) ||
    "Untitled session";
  const subjectFromMessage =
    !item.awaiting_subject && !item.session_name && !!item.last_agent_message;
  const preview = subjectFromMessage
    ? ""
    : item.last_agent_message?.replace(/\s+/g, " ").trim() || "";
  const from = item.agent_name || "Agent";
  const time = timeShort(item.awaiting_at || item.last_active);
  const trustLabel = item.trust_id ? trustNameById.get(item.trust_id) || "TRUST" : "Global scope";
  const status = item.awaiting_at ? "in_review" : "in_progress";
  const statusLabel = item.awaiting_at ? "Awaiting you" : "Active";
  const contextLine = preview ? `${from} · ${trustLabel} · ${preview}` : `${from} · ${trustLabel}`;

  return (
    <li className="home-inbox-item">
      <Link
        className="home-inbox-link"
        to={sessionDeepUrlFromId(entities, item.trust_id, item.agent_id, item.session_id)}
      >
        <span
          className={`home-inbox-status home-inbox-status--${status}`}
          aria-label={statusLabel}
          title={statusLabel}
        />
        <span className="home-inbox-body">
          <span className="home-inbox-row">
            <span className="home-inbox-from">Inbox item · {statusLabel}</span>
            <span className="home-inbox-time">{time}</span>
          </span>
          <span className="home-inbox-subject">{subject}</span>
          <span className="home-inbox-preview">{contextLine}</span>
        </span>
      </Link>
    </li>
  );
}

function EconomyCard() {
  return (
    <article className="home-card home-card--economy">
      <div className="home-economy-media">
        <img
          src="/home/economy-mood.png"
          alt=""
          className="home-economy-image"
          aria-hidden="true"
        />
      </div>
      <div className="home-economy-content">
        <header className="home-economy-head">
          <span className="home-economy-label">
            <Globe size={15} strokeWidth={1.7} aria-hidden="true" />
            Economy
          </span>
        </header>
        <div className="home-economy-body">
          <p className="home-economy-lede">Unlock the agent economy.</p>
          <p className="home-economy-aside">
            TRUST listings, open roles, blueprints, and funding opportunities live here.
          </p>
        </div>
        <Link to="/economy" className="home-economy-cta">
          Discover
          <ArrowRight size={16} strokeWidth={1.8} />
        </Link>
      </div>
    </article>
  );
}

function LearnAeqiSection() {
  const [postIndex, setPostIndex] = useState(0);
  const activePost = LEARN_POSTS[postIndex % LEARN_POSTS.length];

  useEffect(() => {
    const interval = window.setInterval(() => {
      setPostIndex((current) => (current + 1) % LEARN_POSTS.length);
    }, 5600);
    return () => window.clearInterval(interval);
  }, []);

  return (
    <section className="home-learn" aria-label="Learn aeqi">
      <article className="home-card home-card--learn">
        <div className="home-learn-head">
          <h2 className="home-learn-title">Learn more</h2>
        </div>
        <div className="home-learn-carousel">
          <a
            className="home-learn-carousel-media"
            href={activePost.href}
            target="_blank"
            rel="noreferrer"
          >
            <img
              key={activePost.image}
              src={activePost.image}
              alt=""
              className="home-learn-carousel-image"
              aria-hidden="true"
            />
          </a>
          <span key={activePost.href} className="home-learn-carousel-copy">
            <a
              className="home-learn-carousel-link"
              href={activePost.href}
              target="_blank"
              rel="noreferrer"
            >
              <span className="home-learn-post-kicker">{activePost.kicker}</span>
              <span className="home-learn-post-title">{activePost.title}</span>
              <span className="home-learn-post-summary">{activePost.summary}</span>
            </a>
            <span className="home-learn-rotation" aria-label="Learning article rotation">
              {LEARN_POSTS.map((post, index) => (
                <button
                  key={post.href}
                  type="button"
                  className={`home-learn-dot${index === postIndex ? " home-learn-dot--active" : ""}`}
                  aria-label={`Show ${post.title}`}
                  onClick={(event) => {
                    event.preventDefault();
                    setPostIndex(index);
                  }}
                />
              ))}
            </span>
          </span>
        </div>
      </article>
      <aside className="home-learn-rail" aria-label="Learn aeqi links">
        <a
          className="home-learn-rail-card"
          href="https://aeqi.ai/docs"
          target="_blank"
          rel="noreferrer"
        >
          <span className="home-learn-rail-kicker">
            <BookOpen size={15} strokeWidth={1.7} aria-hidden="true" />
            Docs
          </span>
          <span className="home-learn-rail-title">Read docs</span>
          <span className="home-learn-rail-copy">TRUSTs, agents, quests, and launch basics.</span>
          <ArrowRight size={15} strokeWidth={1.8} />
        </a>
        <a
          className="home-learn-rail-card"
          href="https://x.com/aeqiai"
          target="_blank"
          rel="noreferrer"
        >
          <span className="home-learn-rail-kicker">
            <Users size={15} strokeWidth={1.7} aria-hidden="true" />
            Community
          </span>
          <span className="home-learn-rail-title">Follow aeqi</span>
          <span className="home-learn-rail-copy">Updates, builds, and operator notes.</span>
          <ArrowRight size={15} strokeWidth={1.8} />
        </a>
      </aside>
    </section>
  );
}

function latestActivityLabel(
  activeTrust: Trust | null,
  inboxItems: ReadonlyArray<InboxItem>,
  quests: ReadonlyArray<Quest>,
) {
  const inboxTime = inboxItems
    .map((item) => item.awaiting_at || item.last_active)
    .filter(Boolean)
    .sort()
    .at(-1);
  const questTime = quests
    .map((quest) => quest.updated_at || quest.created_at)
    .filter(Boolean)
    .sort()
    .at(-1);
  const timestamp = inboxTime || questTime || activeTrust?.last_active;
  return timestamp ? timeShort(timestamp) : "Ready";
}
