import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowRight, BookOpen, Globe, Plus, Rocket, Users } from "lucide-react";
import OperatingContextCard from "@/components/trust/OperatingContextCard";
import InboxEmptyCanvas from "@/components/inbox/InboxEmptyCanvas";
import { useAgents } from "@/queries/agents";
import { useEntities } from "@/queries/entities";
import { makeRailRow, SessionRailRowContent } from "@/components/sessions/SessionRail";
import UserAvatar from "@/components/UserAvatar";
import { api } from "@/lib/api";
import { entityPath } from "@/lib/entityPath";
import { timeShort } from "@/lib/format";
import { formatHeroClock } from "@/lib/i18n";
import { getInboxSignal, visibleInboxSignalLabel } from "@/lib/inboxState";
import type { InboxItem } from "@/lib/api";
import type { Role, Trust } from "@/lib/types";
import { sessionDeepUrlFromId } from "@/lib/sessionUrl";
import { useAuthStore } from "@/store/auth";
import { useInboxStore } from "@/store/inbox";
import { useUIStore } from "@/store/ui";
import { LEARN_POSTS } from "./startPageLearnPosts";
import { pickFeaturedRole } from "./startPageUtils";
import "@/styles/roles.css";

const INBOX_PREVIEW_LIMIT = 4;

export default function StartPage() {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const activeEntityId = useUIStore((s) => s.activeEntity);
  const entities = useEntities();
  const agents = useAgents();
  const inboxItems = useInboxStore((s) => s.items);
  const fetchInbox = useInboxStore((s) => s.fetchInbox);
  const [roles, setRoles] = useState<Role[]>([]);
  const [rolesLoading, setRolesLoading] = useState(false);
  const [heroClock, setHeroClock] = useState(() => new Date());

  useEffect(() => {
    fetchInbox().catch(() => {
      // The inbox store owns error presentation; Home keeps the preview quiet.
    });
  }, [fetchInbox]);

  useEffect(() => {
    const interval = window.setInterval(() => setHeroClock(new Date()), 30_000);
    return () => window.clearInterval(interval);
  }, []);

  const activeTrust = useMemo(() => {
    if (activeEntityId) {
      const selected = entities.find((entity) => entity.id === activeEntityId);
      if (selected) return selected;
    }
    return entities[0] ?? null;
  }, [activeEntityId, entities]);

  useEffect(() => {
    if (!activeTrust) {
      setRoles([]);
      setRolesLoading(false);
      return;
    }

    let cancelled = false;
    setRolesLoading(true);
    api
      .getRoles(activeTrust.id)
      .then((resp) => {
        if (!cancelled) setRoles(resp.roles ?? []);
      })
      .catch(() => {
        if (!cancelled) setRoles([]);
      })
      .finally(() => {
        if (!cancelled) setRolesLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [activeTrust]);

  const actorName = useMemo(
    () => user?.name?.trim() || user?.email?.split("@")[0] || "Operator",
    [user],
  );
  const actorEmail = user?.email?.trim() || "Personal command surface";
  const heroClockLine = useMemo(() => formatHeroClock(heroClock), [heroClock]);

  const trustNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const entity of entities) map.set(entity.id, entity.name);
    return map;
  }, [entities]);

  const currentAgents = useMemo(() => {
    if (!activeTrust) return [];
    return agents.filter((agent) => !agent.trust_id || agent.trust_id === activeTrust.id);
  }, [activeTrust, agents]);

  const agentNames = useMemo(() => {
    const map = new Map<string, string>();
    for (const agent of currentAgents) map.set(agent.id, agent.name);
    return map;
  }, [currentAgents]);

  const agentAvatars = useMemo(() => {
    const map = new Map<string, string>();
    for (const agent of currentAgents) {
      if (agent.avatar) map.set(agent.id, agent.avatar);
    }
    return map;
  }, [currentAgents]);

  const activeRole = useMemo(() => pickFeaturedRole(roles, user?.id), [roles, user?.id]);
  const handleSelectRole = useCallback(
    (role: Role) => {
      if (!activeTrust) return;
      navigate(entityPath(activeTrust, "roles", encodeURIComponent(role.id)));
    },
    [activeTrust, navigate],
  );

  const inboxPreview = inboxItems.slice(0, INBOX_PREVIEW_LIMIT);

  return (
    <div className="home-page">
      <header className="home-hero">
        <img src="/welcome/start-hero.png" alt="" className="home-hero-image" aria-hidden="true" />
        <div className="home-hero-overlay">
          <div className="home-hero-identity">
            <span className="home-hero-avatar" aria-hidden="true">
              <UserAvatar name={actorName} size={64} src={user?.avatar_url} />
            </span>
            <div className="home-hero-text">
              <p className="home-hero-eyebrow">{heroClockLine}</p>
              <h1 className="home-hero-title">Welcome back</h1>
              <p className="home-hero-subtitle">{actorName}</p>
              <p className="home-hero-email">{actorEmail}</p>
            </div>
          </div>
        </div>
      </header>

      <section className="home-row-trusts" aria-label="Operating context">
        <OperatingContextCard
          activeTrust={activeTrust}
          activeRole={activeRole}
          rolesLoading={rolesLoading}
          agentNames={agentNames}
          agentAvatars={agentAvatars}
          onSelectRole={handleSelectRole}
        />
        <LaunchTrustCard />
      </section>

      <section className="home-row-two" aria-label="Inbox and economy">
        <InboxPreviewCard
          entities={entities}
          inboxItems={inboxPreview}
          trustNameById={trustNameById}
        />
        <EconomyCard />
      </section>

      <LearnAeqiSection />
    </div>
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
  trustNameById: ReadonlyMap<string, string>;
}

function InboxPreviewCard({ entities, inboxItems, trustNameById }: InboxPreviewCardProps) {
  return (
    <article className="home-card home-card--inbox">
      <header className="home-inbox-head">
        <h2 className="home-inbox-title">Inbox</h2>
        <Link to="/inbox" className="home-inbox-cta">
          Inbox
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
        <InboxEmptyCanvas
          title="Inbox clear"
          hint="No reviews, approvals, failed events, or agent handoffs need attention."
          kind="empty"
          className="home-inbox-empty-canvas"
        />
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
  const signal = getInboxSignal({ awaiting: !!item.awaiting_at });
  const signalLabel = visibleInboxSignalLabel(signal);
  const contextLine = [signalLabel, from, trustLabel, preview].filter(Boolean).join(" · ");
  const row = makeRailRow({
    id: item.session_id,
    primary: subject,
    secondary: contextLine,
    time,
    status: signal.rowStatus,
    awaiting: signal.awaiting,
    isoTimestamp: item.awaiting_at || item.last_active,
    wrapPrimary: true,
  });

  return (
    <li className="home-inbox-item">
      <Link
        className="home-inbox-link sessions-rail-row sessions-rail-row--multi"
        to={sessionDeepUrlFromId(entities, item.trust_id, item.agent_id, item.session_id)}
        aria-label={`${signal.label}: ${subject}`}
      >
        <SessionRailRowContent item={row} />
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
          <span className="home-step-btn-label">Explore Economy</span>
          <span className="home-step-btn-icon">
            <ArrowRight size={16} strokeWidth={1.8} />
          </span>
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
