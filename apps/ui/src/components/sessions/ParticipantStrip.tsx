import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Plus } from "lucide-react";
import { apiRequest } from "@/api/client";
import BlockAvatar from "@/components/BlockAvatar";
import { Icon } from "@/components/ui";
import { useAuthStore } from "@/store/auth";
import { useDaemonStore } from "@/store/daemon";
import { entityPathFromId } from "@/lib/entityPath";
import AddParticipantModal from "./AddParticipantModal";

/**
 * Multi-participant strip — quiet horizontal row above any session message
 * stream. Renders the session's participant avatars, an overflow chip when
 * there are more than 5, and a "+ Add" button that opens the picker modal.
 *
 * Mounted by both the agent session surface (`AgentSessionView`) and the
 * universal `<SessionDetail>` primitive (which the inbox surface adopts).
 * One primitive, one canonical shape.
 */

export interface Participant {
  id: string;
  name: string;
  kind: "user" | "agent" | "position" | "external" | string;
  avatar_url?: string | null;
}

const MAX_PARTICIPANTS_INLINE = 5;

interface RawParticipant {
  id?: string;
  identity_id?: string;
  identity_kind?: string;
  name?: string;
  kind?: string;
  avatar_url?: string | null;
}

function normalize(raw: RawParticipant): Participant {
  const id = raw.identity_id ?? raw.id ?? "";
  const kind = (raw.identity_kind ?? raw.kind ?? "agent") as Participant["kind"];
  const name = raw.name ?? id;
  return { id, name, kind, avatar_url: raw.avatar_url ?? null };
}

function ParticipantAvatar({
  p,
  companyId,
  active,
}: {
  p: Participant;
  companyId?: string;
  active: boolean;
}) {
  // Resolve a navigation target so clicking the avatar jumps to that
  // identity's surface. Agent → /<entityBase>/agents/<id>; position
  // → /<entityBase>/roles/<id>; user / external are unlinked (no public
  // surface today).
  const entitiesList = useDaemonStore((s) => s.entities);
  const href =
    companyId && p.id && p.kind === "agent"
      ? entityPathFromId(entitiesList, companyId, "agents", encodeURIComponent(p.id))
      : companyId && p.id && p.kind === "position"
        ? entityPathFromId(entitiesList, companyId, "roles", encodeURIComponent(p.id))
        : undefined;

  // Avatar shape is determined by KIND, not by whether a photo URL exists.
  // Humans/users render as full circles; agents (and agent-adjacent kinds
  // like positions, external) render as slight-rounded squares.
  const shape: "circle" | "rounded-square" = p.kind === "user" ? "circle" : "rounded-square";
  const photoBorderRadius = shape === "circle" ? "999px" : "var(--radius-sm)";

  if (p.avatar_url) {
    const className = `block-avatar-link asv-participant-avatar${active ? " is-processing" : ""}`;
    const img = (
      <img
        src={p.avatar_url}
        alt={p.name}
        width={24}
        height={24}
        style={{
          width: 24,
          height: 24,
          borderRadius: photoBorderRadius,
          objectFit: "cover",
          display: "block",
        }}
      />
    );
    if (href) {
      return (
        <Link
          to={href}
          className={className}
          aria-label={active ? `${p.name} is processing` : p.name}
          title={p.name}
          onClick={(e) => e.stopPropagation()}
        >
          {img}
        </Link>
      );
    }
    return (
      <div
        className={`asv-participant-avatar${active ? " is-processing" : ""}`}
        title={p.name}
        aria-label={active ? `${p.name} is processing` : p.name}
      >
        {img}
      </div>
    );
  }
  return (
    <div
      className={`asv-participant-avatar${active ? " is-processing" : ""}`}
      title={p.name}
      aria-label={active ? `${p.name} is processing` : p.name}
    >
      <BlockAvatar name={p.name || "?"} size={24} href={href} ariaLabel={p.name} shape={shape} />
    </div>
  );
}

export default function ParticipantStrip({
  sessionId,
  companyId,
  activeParticipantIds = [],
}: {
  sessionId: string | null;
  /** Optional entity scope override — needed when the host route doesn't
   *  resolve an entity via `useNav` (e.g. when the inbox surface is
   *  mounted in a context without a matching :companyId/:companyAddress). */
  companyId?: string;
  activeParticipantIds?: string[];
}) {
  const [participants, setParticipants] = useState<Participant[] | null>(null);
  const [showModal, setShowModal] = useState(false);

  const loadParticipants = useCallback(async (id: string) => {
    try {
      const res = await apiRequest<{
        ok?: boolean;
        participants?: RawParticipant[];
      }>(`/sessions/${encodeURIComponent(id)}/participants`);
      const raw = res?.participants;
      if (Array.isArray(raw)) {
        setParticipants(raw.map(normalize));
      } else {
        setParticipants([]);
      }
    } catch {
      setParticipants([]);
    }
  }, []);

  useEffect(() => {
    if (!sessionId) {
      setParticipants(null);
      return;
    }
    void loadParticipants(sessionId);
  }, [sessionId, loadParticipants]);

  // Cross-reference the API's participant list with daemon-store agents and
  // the auth-store user so the avatar + display name match what `MessageItem`
  // renders for the same identity. The /sessions/<id>/participants endpoint
  // omits avatar_url for agents (no daemon photo), and reports humans by their
  // session-time name (often a truncated email prefix), so without this seam
  // the same identity ends up with a different BlockAvatar in the strip vs
  // the message bubble.
  const agents = useDaemonStore((s) => s.agents);
  const currentUser = useAuthStore((s) => s.user);

  const enriched = useMemo(
    () =>
      (participants ?? []).map((p) => {
        if (p.kind === "agent") {
          const a = agents.find((x) => x.id === p.id);
          if (a) {
            return {
              ...p,
              avatar_url: a.avatar ?? p.avatar_url,
              name: a.name ?? p.name,
            };
          }
          return p;
        }
        if (p.kind === "user" && currentUser && currentUser.id === p.id) {
          return {
            ...p,
            avatar_url: currentUser.avatar_url ?? p.avatar_url,
            name: currentUser.name ?? p.name,
          };
        }
        return p;
      }),
    [participants, agents, currentUser],
  );

  if (!sessionId) return null;

  const inline = enriched.slice(0, MAX_PARTICIPANTS_INLINE);
  const overflow = enriched.length - inline.length;
  const activeSet = new Set(activeParticipantIds);

  return (
    <>
      <div className="asv-participant-strip">
        <div className="asv-participant-strip-avatars">
          {inline.map((p) => (
            <ParticipantAvatar
              key={`${p.kind}:${p.id}`}
              p={p}
              companyId={companyId}
              active={activeSet.has(p.id)}
            />
          ))}
          {overflow > 0 && (
            <div
              className="asv-participant-overflow"
              title={`${overflow} more`}
              aria-label={`${overflow} more participants`}
            >
              +{overflow}
            </div>
          )}
        </div>
        <button
          type="button"
          className="sidebar-row-action-btn asv-participant-add-btn"
          aria-label="Add participant"
          title="Add participant"
          data-pill-allowed=""
          onClick={() => setShowModal(true)}
        >
          <Icon icon={Plus} size="sm" />
        </button>
      </div>
      <AddParticipantModal
        open={showModal}
        sessionId={sessionId}
        companyId={companyId}
        onClose={() => setShowModal(false)}
        onAdded={() => {
          setShowModal(false);
          if (sessionId) void loadParticipants(sessionId);
        }}
      />
    </>
  );
}
