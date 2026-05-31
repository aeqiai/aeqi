import { useEffect, useMemo, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Input } from "@/components/ui/Input";
import { api } from "@/lib/api";
import { apiRequest } from "@/api/client";
import { useDaemonStore } from "@/store/daemon";
import { useNav } from "@/hooks/useNav";
import BlockAvatar from "@/components/BlockAvatar";
import type { Role } from "@/lib/types";

/**
 * Real picker for the multi-participant strip's "+ Add" affordance.
 * Search input filters by name/title/email; results group by kind
 * (Agents · Roles · People). Click a row to POST the chosen participant
 * to `/sessions/<id>/participants`.
 */

type Candidate =
  | { kind: "agent"; id: string; name: string; subtitle?: string }
  | { kind: "position"; id: string; name: string; subtitle?: string }
  | { kind: "user"; id: string; name: string; subtitle?: string; avatar_url?: string | null };

interface AddParticipantModalProps {
  open: boolean;
  sessionId: string;
  /** Override for the entity scope. When omitted, falls back to
   *  useNav().companyId. */
  companyId?: string;
  onClose: () => void;
  onAdded: () => void;
}

function CandidateAvatar({ c }: { c: Candidate }) {
  if (c.kind === "user" && c.avatar_url) {
    return (
      <img
        src={c.avatar_url}
        alt={c.name}
        width={24}
        height={24}
        style={{
          width: 24,
          height: 24,
          borderRadius: "999px",
          objectFit: "cover",
          display: "block",
          flexShrink: 0,
        }}
      />
    );
  }
  return <BlockAvatar name={c.name || "?"} size={24} />;
}

function KindChip({ kind }: { kind: Candidate["kind"] }) {
  const label = kind === "agent" ? "Agent" : kind === "position" ? "Role" : "Person";
  return <span className="add-participant-row-chip">{label}</span>;
}

export default function AddParticipantModal({
  open,
  sessionId,
  companyId: entityIdOverride,
  onClose,
  onAdded,
}: AddParticipantModalProps) {
  const navEntityId = useNav().companyId;
  const companyId = entityIdOverride || navEntityId;
  const agents = useDaemonStore((s) => s.agents);

  const [query, setQuery] = useState("");
  const [roles, setRoles] = useState<Role[]>([]);
  const [submittingKey, setSubmittingKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Reset transient state on open/close transition
  useEffect(() => {
    if (open) {
      setQuery("");
      setError(null);
      setSubmittingKey(null);
    }
  }, [open]);

  // Load roles for the active entity once when opened
  useEffect(() => {
    if (!open || !companyId) return;
    let cancelled = false;
    api
      .getRoles(companyId)
      .then((res) => {
        if (cancelled) return;
        setRoles(res?.roles ?? []);
      })
      .catch(() => {
        if (!cancelled) setRoles([]);
      });
    return () => {
      cancelled = true;
    };
  }, [open, companyId]);

  // Candidate set: agents in scope + all roles (with subtitle = occupant) +
  // unique humans mined from role.occupant_kind === "human".
  const candidates: Candidate[] = useMemo(() => {
    const out: Candidate[] = [];
    const scopedAgents = companyId ? agents.filter((a) => a.company_id === companyId) : agents;
    for (const a of scopedAgents) {
      out.push({
        kind: "agent",
        id: a.id,
        name: a.name ?? a.id,
      });
    }
    for (const r of roles) {
      const subtitle =
        r.occupant_kind === "agent" && r.occupant_id
          ? (agents.find((a) => a.id === r.occupant_id)?.name ?? r.occupant_id)
          : r.occupant_kind === "human"
            ? (r.occupant_name ?? "human occupant")
            : "vacant";
      out.push({
        kind: "position",
        id: r.id,
        name: r.title,
        subtitle,
      });
    }
    const seenUsers = new Set<string>();
    for (const r of roles) {
      if (r.occupant_kind === "human" && r.occupant_id && !seenUsers.has(r.occupant_id)) {
        seenUsers.add(r.occupant_id);
        out.push({
          kind: "user",
          id: r.occupant_id,
          name: r.occupant_name ?? r.occupant_id,
          subtitle: r.title,
          avatar_url: r.occupant_avatar_url ?? null,
        });
      }
    }
    return out;
  }, [agents, roles, companyId]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return candidates;
    return candidates.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        (c.subtitle ?? "").toLowerCase().includes(q) ||
        c.id.toLowerCase().includes(q),
    );
  }, [candidates, query]);

  const grouped = useMemo(() => {
    const groups: Record<Candidate["kind"], Candidate[]> = {
      agent: [],
      position: [],
      user: [],
    };
    for (const c of filtered) {
      groups[c.kind].push(c);
    }
    return groups;
  }, [filtered]);

  const handleAdd = async (c: Candidate) => {
    const key = `${c.kind}:${c.id}`;
    setSubmittingKey(key);
    setError(null);
    try {
      const res = await apiRequest<{ ok: boolean; error?: string }>(
        `/sessions/${encodeURIComponent(sessionId)}/participants`,
        {
          method: "POST",
          body: JSON.stringify({ identity_kind: c.kind, identity_id: c.id }),
        },
      );
      if (!res.ok) {
        setError(res.error ?? "Failed to add participant");
        setSubmittingKey(null);
        return;
      }
      onAdded();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to add participant");
      setSubmittingKey(null);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Add participant" className="add-participant-modal">
      <div className="add-participant-search">
        <Input
          type="search"
          placeholder="Search agents, roles, people…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search candidates"
          autoFocus
        />
      </div>
      {error && (
        <div className="add-participant-error" role="alert">
          {error}
        </div>
      )}
      <div className="add-participant-results">
        {filtered.length === 0 ? (
          <div className="add-participant-empty">No matches</div>
        ) : (
          <>
            {(["agent", "position", "user"] as const).map((kind) => {
              const items = grouped[kind];
              if (items.length === 0) return null;
              const groupLabel =
                kind === "agent" ? "Agents" : kind === "position" ? "Roles" : "People";
              return (
                <div key={kind} className="add-participant-group">
                  <div className="add-participant-group-head">{groupLabel}</div>
                  {items.map((c) => {
                    const key = `${c.kind}:${c.id}`;
                    const isSubmitting = submittingKey === key;
                    return (
                      <button
                        key={key}
                        type="button"
                        className="add-participant-row"
                        onClick={() => handleAdd(c)}
                        disabled={submittingKey !== null}
                      >
                        <CandidateAvatar c={c} />
                        <div className="add-participant-row-meta">
                          <span className="add-participant-row-name">{c.name}</span>
                          {c.subtitle && (
                            <span className="add-participant-row-sub">{c.subtitle}</span>
                          )}
                        </div>
                        <KindChip kind={c.kind} />
                        {isSubmitting && (
                          <span className="add-participant-row-status" aria-hidden>
                            adding…
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              );
            })}
          </>
        )}
      </div>
    </Modal>
  );
}
