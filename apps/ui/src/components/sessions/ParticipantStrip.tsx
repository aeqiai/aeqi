import { useCallback, useEffect, useState } from "react";
import { apiRequest } from "@/api/client";
import BlockAvatar from "@/components/BlockAvatar";
import AddParticipantModal from "./AddParticipantModal";

/**
 * Multi-participant strip — quiet horizontal row above any session message
 * stream. Renders the session's participant avatars, an overflow chip when
 * there are more than 5, and a "+ Add" button that opens the picker modal.
 *
 * Mounted by both the agent session surface (`AgentSessionView`) and the
 * inbox detail pane (`InboxDetail`). One primitive, one canonical shape.
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

function ParticipantAvatar({ p }: { p: Participant }) {
  if (p.avatar_url) {
    return (
      <div className="asv-participant-avatar" title={p.name}>
        <img
          src={p.avatar_url}
          alt={p.name}
          width={24}
          height={24}
          style={{
            width: 24,
            height: 24,
            borderRadius: "999px",
            objectFit: "cover",
            display: "block",
          }}
        />
      </div>
    );
  }
  return (
    <div className="asv-participant-avatar" title={p.name}>
      <BlockAvatar name={p.name || "?"} size={24} />
    </div>
  );
}

export default function ParticipantStrip({
  sessionId,
  entityId,
}: {
  sessionId: string | null;
  /** Optional entity scope override — needed when the host route doesn't
   *  resolve an entity via `useNav` (e.g. `/me/inbox`). */
  entityId?: string;
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

  if (!sessionId) return null;

  const list = participants ?? [];
  const inline = list.slice(0, MAX_PARTICIPANTS_INLINE);
  const overflow = list.length - inline.length;

  return (
    <>
      <div className="asv-participant-strip">
        <div className="asv-participant-strip-avatars">
          {inline.map((p) => (
            <ParticipantAvatar key={`${p.kind}:${p.id}`} p={p} />
          ))}
          {overflow > 0 && (
            <div className="asv-participant-overflow" title={`${overflow} more`}>
              +{overflow}
            </div>
          )}
        </div>
        <button
          type="button"
          className="sidebar-row-action-btn asv-participant-add-btn"
          aria-label="Add participant"
          title="Add participant"
          onClick={() => setShowModal(true)}
        >
          <svg
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.3"
            strokeLinecap="round"
            strokeLinejoin="round"
            width={14}
            height={14}
          >
            <path d="M8 3v10M3 8h10" />
          </svg>
        </button>
      </div>
      <AddParticipantModal
        open={showModal}
        sessionId={sessionId}
        entityId={entityId}
        onClose={() => setShowModal(false)}
        onAdded={() => {
          setShowModal(false);
          if (sessionId) void loadParticipants(sessionId);
        }}
      />
    </>
  );
}
