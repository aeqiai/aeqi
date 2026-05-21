import { useEffect, useMemo } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, BookOpen, Globe, Inbox as InboxIcon, Plus, Settings } from "lucide-react";
import { useAgents } from "@/queries/agents";
import { useEntities } from "@/queries/entities";
import { useQuests } from "@/queries/quests";
import BlockAvatar from "@/components/BlockAvatar";
import TrustAvatar from "@/components/TrustAvatar";
import UserAvatar from "@/components/UserAvatar";
import { entityPath } from "@/lib/entityPath";
import { timeShort } from "@/lib/format";
import type { InboxItem } from "@/lib/api";
import type { Quest, Trust } from "@/lib/types";
import { sessionDeepUrlFromId } from "@/lib/sessionUrl";
import { useAuthStore } from "@/store/auth";
import { useInboxStore } from "@/store/inbox";
import { useUIStore } from "@/store/ui";

const INBOX_PREVIEW_LIMIT = 4;
const TRUST_PREVIEW_LIMIT = 3;
const CURRENT_ROLE = "Director";

const LEARN_POSTS = [
  {
    title: "The uncompiled institution",
    kicker: "Thesis",
    summary: "Institutions are software that has not been compiled yet.",
    image: "/home/learn-uncompiled-institution.webp",
    href: "https://aeqi.ai/blog/the-uncompiled-institution",
  },
  {
    title: "The agent economy",
    kicker: "Network",
    summary: "Why programmable companies need an economy around them.",
    image: "/home/learn-agent-economy.webp",
    href: "https://aeqi.ai/blog/the-agent-economy",
  },
  {
    title: "The company is the primitive",
    kicker: "Product",
    summary: "A company becomes a programmable object with roles, agents, and ownership.",
    image: "/home/learn-company-primitive.webp",
    href: "https://aeqi.ai/blog/the-company-is-the-primitive",
  },
];

export default function StartPage() {
  const user = useAuthStore((s) => s.user);
  const activeEntityId = useUIStore((s) => s.activeEntity);
  const entities = useEntities();
  const agents = useAgents();
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

  const actorName = useMemo(
    () => user?.name?.trim() || user?.email?.split("@")[0] || "Operator",
    [user],
  );
  const actorLine = user?.email ? `Operator · ${user.email}` : "Personal command surface";

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
  const trustsLabel = `${entities.length} TRUST${entities.length === 1 ? "" : "s"}`;

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

  const currentQuests = useMemo(
    () => quests.filter((quest) => quest.status !== "done" && quest.status !== "cancelled"),
    [quests],
  );

  const latestActivity = useMemo(
    () => latestActivityLabel(activeTrust, activeInboxItems, currentQuests),
    [activeTrust, activeInboxItems, currentQuests],
  );

  const trustPreview = useMemo(() => {
    if (!activeTrust) return entities.slice(0, TRUST_PREVIEW_LIMIT);
    return [activeTrust, ...entities.filter((entity) => entity.id !== activeTrust.id)].slice(
      0,
      TRUST_PREVIEW_LIMIT,
    );
  }, [activeTrust, entities]);

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
        <div className="home-hero-pill" role="status" aria-label="Account snapshot">
          <span className="home-hero-pill-stat">{trustsLabel}</span>
          <span className="home-hero-pill-sep" aria-hidden>
            ·
          </span>
          <span className="home-hero-pill-stat home-hero-pill-stat--inbox">
            <span
              className={`home-hero-pill-dot home-hero-pill-dot--${inboxPillState}`}
              aria-hidden="true"
            />
            {inboxLabel}
          </span>
        </div>
      </header>

      <section className="home-row-trusts" aria-label="Operating context">
        <CurrentContextCard
          activeTrust={activeTrust}
          activeRole={CURRENT_ROLE}
          inboxCount={activeInboxItems.length}
          questCount={currentQuests.length}
          agentCount={currentAgents.length}
          latestActivity={latestActivity}
        />
        <LaunchTrustCard />
        <YourTrustsCard trusts={trustPreview} activeTrustId={activeTrust?.id ?? null} />
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

interface CurrentContextCardProps {
  activeTrust: Trust | null;
  activeRole: string;
  inboxCount: number;
  questCount: number;
  agentCount: number;
  latestActivity: string;
}

function CurrentContextCard({
  activeTrust,
  activeRole,
  inboxCount,
  questCount,
  agentCount,
  latestActivity,
}: CurrentContextCardProps) {
  if (!activeTrust) {
    return (
      <article className="home-card home-card--context home-card--empty">
        <span className="home-card-eyebrow">Current context</span>
        <div className="home-context-empty">
          <span className="home-context-avatar home-context-avatar--ghost" aria-hidden="true">
            <Plus size={26} strokeWidth={1.5} />
          </span>
          <h2 className="home-context-title">No active TRUST</h2>
          <p className="home-context-copy">
            Launch a TRUST to create an operating context for roles, agents, quests, and memory.
          </p>
        </div>
        <Link to="/launch" className="home-primary-action">
          Launch TRUST
          <ArrowRight size={14} strokeWidth={1.8} />
        </Link>
      </article>
    );
  }

  const inboxInsight = inboxCount > 0 ? `${inboxCount} need attention` : "Clear";
  const questInsight = questCount > 0 ? `${questCount} open` : "Board ready";
  const agentInsight = agentCount > 0 ? `${agentCount} running` : "Runtime connected";

  return (
    <article className="home-card home-card--context">
      <div className="home-context-head">
        <span className="home-card-eyebrow">Current context</span>
        <Link
          to={entityPath(activeTrust)}
          className="home-card-link"
          aria-label={`Open TRUST ${activeTrust.name}`}
        >
          Open TRUST
          <ArrowRight size={14} strokeWidth={1.8} />
        </Link>
      </div>
      <div className="home-context-main">
        <span className="home-context-avatar" aria-hidden="true">
          <TrustAvatar name={activeTrust.name} size={68} />
        </span>
        <div className="home-context-copy">
          <h2 className="home-context-title">{activeTrust.name}</h2>
          <p className="home-context-role">{activeRole}</p>
          <p className="home-context-line">You are operating as {activeRole} inside this TRUST.</p>
        </div>
      </div>
      <dl className="home-context-insights">
        <div>
          <dt>Quests</dt>
          <dd>{questInsight}</dd>
        </div>
        <div>
          <dt>Agents</dt>
          <dd>{agentInsight}</dd>
        </div>
        <div>
          <dt>Inbox</dt>
          <dd>{inboxInsight}</dd>
        </div>
        <div>
          <dt>Latest</dt>
          <dd>{latestActivity}</dd>
        </div>
      </dl>
      <div className="home-context-actions" aria-label="Current context shortcuts">
        <Link to={`${entityPath(activeTrust)}/quests`}>Quests</Link>
        <Link to={`${entityPath(activeTrust)}/agents`}>Agents</Link>
        <Link to={`${entityPath(activeTrust)}/quorum`}>Quorum</Link>
      </div>
    </article>
  );
}

function LaunchTrustCard() {
  return (
    <article className="home-card home-card--launch">
      <span className="home-card-eyebrow">Launch</span>
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
          <span className="home-step-btn-label">Launch blank TRUST</span>
          <span className="home-step-btn-icon">
            <Plus size={16} strokeWidth={1.8} />
          </span>
        </Link>
      </div>
    </article>
  );
}

interface YourTrustsCardProps {
  trusts: ReadonlyArray<Trust>;
  activeTrustId: string | null;
}

function YourTrustsCard({ trusts, activeTrustId }: YourTrustsCardProps) {
  return (
    <article className="home-card home-card--your-trusts">
      <header className="home-card-head">
        <div>
          <span className="home-card-eyebrow">Your TRUSTs</span>
          <h3 className="home-your-title">
            {trusts.length > 0 ? `${trusts.length} shown` : "None yet"}
          </h3>
        </div>
        <Link to="/trust" className="home-card-link">
          View all TRUSTs
          <ArrowRight size={14} strokeWidth={1.8} />
        </Link>
      </header>
      {trusts.length > 0 ? (
        <ul className="home-trust-list">
          {trusts.map((trust) => {
            const active = trust.id === activeTrustId;
            return (
              <li key={trust.id}>
                <Link
                  to={entityPath(trust)}
                  className={`home-trust-row${active ? " home-trust-row--active" : ""}`}
                  aria-label={`Open TRUST ${trust.name}${active ? " — active" : ""}`}
                >
                  <TrustAvatar name={trust.name} size={30} />
                  <span className="home-trust-row-copy">
                    <span className="home-trust-row-name">{trust.name}</span>
                    <span className="home-trust-row-role">
                      {CURRENT_ROLE}
                      {active ? " · Active" : ""}
                    </span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="home-your-empty">Launch your first TRUST to create an operating context.</p>
      )}
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
      <header className="home-card-head">
        <span className="home-card-icon">
          <InboxIcon size={16} strokeWidth={1.5} />
        </span>
        <span className="home-card-title">Inbox</span>
        <span className="home-card-meta">
          <span
            className={`home-card-meta-dot home-card-meta-dot--${inboxPillState}`}
            aria-hidden="true"
          />
          {inboxLabel}
        </span>
        <Link to="/inbox" className="home-card-link">
          {inboxItems.length > 0 ? "Review Inbox" : "Open Inbox"}
          <ArrowRight size={14} strokeWidth={1.8} />
        </Link>
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
          <span className="home-inbox-empty-icon" aria-hidden="true">
            <InboxIcon size={28} strokeWidth={1.4} />
          </span>
          <p className="home-inbox-empty-title">Inbox clear</p>
          <p className="home-inbox-empty-hint">
            No reviews, approvals, failed events, or agent handoffs need attention.
          </p>
        </div>
      )}
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
        <span className="home-inbox-avatar" aria-hidden="true">
          <BlockAvatar name={from} size={28} />
        </span>
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
      <img src="/home/economy-mood.png" alt="" className="home-economy-image" aria-hidden="true" />
      <div className="home-economy-content">
        <header className="home-card-head home-economy-head">
          <span className="home-economy-icon" aria-hidden="true">
            <Globe size={18} strokeWidth={1.5} />
          </span>
          <span className="home-card-title">Economy</span>
          <Link to="/economy" className="home-card-link">
            Open Economy
            <ArrowRight size={14} strokeWidth={1.8} />
          </Link>
        </header>
        <div className="home-economy-body">
          <p className="home-economy-lede">Discover the network around programmable companies.</p>
          <p className="home-economy-aside">
            TRUST listings, open roles, blueprints, and funding opportunities live here.
          </p>
        </div>
      </div>
    </article>
  );
}

function LearnAeqiSection() {
  return (
    <section className="home-learn" aria-label="Learn aeqi">
      <article className="home-card home-card--learn">
        <div className="home-learn-head">
          <div>
            <span className="home-card-eyebrow">Learn aeqi</span>
            <h2 className="home-learn-title">Understand programmable companies.</h2>
          </div>
          <div className="home-learn-actions">
            <a href="https://aeqi.ai/docs" target="_blank" rel="noreferrer">
              Open docs
              <BookOpen size={14} strokeWidth={1.8} />
            </a>
          </div>
        </div>
        <div className="home-learn-grid">
          {LEARN_POSTS.map((post, index) => (
            <a
              key={post.href}
              className={`home-learn-post${index === 0 ? " home-learn-post--feature" : ""}`}
              href={post.href}
              target="_blank"
              rel="noreferrer"
            >
              <img src={post.image} alt="" className="home-learn-post-image" aria-hidden="true" />
              <span className="home-learn-post-copy">
                <span className="home-learn-post-kicker">{post.kicker}</span>
                <span className="home-learn-post-title">{post.title}</span>
                <span className="home-learn-post-summary">{post.summary}</span>
              </span>
            </a>
          ))}
        </div>
      </article>
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
