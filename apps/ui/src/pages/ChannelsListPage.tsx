import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, EmptyState, Input, Spinner } from "@/components/ui";
import {
  createChannel,
  listChannelsForEntity,
  type ChannelListItem,
  type InitialParticipant,
} from "@/api/conversation-channels";
import { conversationChannelKeys } from "@/queries/keys";
import NewChannelModal from "@/components/channels/NewChannelModal";
import { useCurrentCompany } from "@/hooks/useCurrentCompany";
import { entityBasePath } from "@/lib/entityPath";

interface ChannelsListPageProps {
  entityId: string;
}

const SearchIcon = () => (
  <svg
    width={13}
    height={13}
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.5}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden
  >
    <circle cx="7" cy="7" r="4.5" />
    <path d="M10 10l3.5 3.5" />
  </svg>
);

const ChannelGlyph = () => (
  <svg
    width={14}
    height={14}
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.5}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden
  >
    <path d="M3.5 6h9M3.5 10h9M6.5 3.5l-1 9M10.5 3.5l-1 9" />
  </svg>
);

function formatRelative(iso: string | null): string {
  if (!iso) return "no messages yet";
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  const delta = Date.now() - t;
  if (delta < 60_000) return "just now";
  if (delta < 3600_000) return `${Math.floor(delta / 60_000)}m`;
  if (delta < 86_400_000) return `${Math.floor(delta / 3600_000)}h`;
  if (delta < 30 * 86_400_000) return `${Math.floor(delta / 86_400_000)}d`;
  return new Date(t).toLocaleDateString();
}

/**
 * `/c/<entity>/channels` — Slack-shaped channels index for a Company.
 *
 * Phase-1 surface: name + last-message preview + participant count + relative
 * timestamp. Toolbar grammar matches `feedback_quests_ideas_parity.md` —
 * search left, "+" right. Sort/filter/view popovers deferred to Phase 1.5.
 *
 * Click → channel detail at `/c/<entity>/channels/<sessionId>`.
 */
export default function ChannelsListPage({ entityId }: ChannelsListPageProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { entity } = useCurrentCompany();
  const base = entity ? entityBasePath(entity) : `/c/${entityId}`;

  const [search, setSearch] = useState("");
  const [showNew, setShowNew] = useState(false);

  useEffect(() => {
    document.title = "channels · æiq";
  }, []);

  const { data, isLoading, error } = useQuery<ChannelListItem[]>({
    queryKey: conversationChannelKeys.byEntity(entityId),
    queryFn: () => listChannelsForEntity(entityId),
    enabled: !!entityId,
    refetchInterval: 15_000,
  });

  const create = useMutation({
    mutationFn: (params: { name: string; participants: InitialParticipant[] }) =>
      createChannel({
        entityId,
        name: params.name,
        participants: params.participants,
      }),
    onSuccess: (res) => {
      void queryClient.invalidateQueries({
        queryKey: conversationChannelKeys.byEntity(entityId),
      });
      setShowNew(false);
      navigate(`${base}/channels/${encodeURIComponent(res.session_id)}`);
    },
  });

  const visible = useMemo(() => {
    const list = data ?? [];
    const q = search.trim().toLowerCase();
    if (!q) return list;
    return list.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        (c.last_message_preview ?? "").toLowerCase().includes(q),
    );
  }, [data, search]);

  return (
    <div className="ideas-list" style={{ padding: "var(--space-4)" }}>
      {/* Toolbar — search left, + right (chrome | paper | ink tier rule) */}
      <div className="ideas-list-head">
        <div className="ideas-toolbar">
          <span className="ideas-list-search-field">
            <span className="ideas-list-search-glyph" aria-hidden>
              <SearchIcon />
            </span>
            <Input
              className="ideas-list-search"
              placeholder="Search channels"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Search channels"
            />
          </span>
          <div style={{ flex: 1 }} />
          <Button variant="primary" size="sm" onClick={() => setShowNew(true)}>
            + New channel
          </Button>
        </div>
      </div>

      <div className="ideas-list-body" style={{ marginTop: "var(--space-3)" }}>
        {isLoading && (
          <div style={{ padding: "var(--space-6)", textAlign: "center" }}>
            <Spinner size="sm" />
          </div>
        )}
        {error instanceof Error && (
          <div
            role="alert"
            style={{
              padding: "var(--space-4)",
              color: "var(--color-text-muted)",
              fontSize: "var(--font-size-sm)",
            }}
          >
            Couldn’t load channels: {error.message}
          </div>
        )}
        {!isLoading && !error && visible.length === 0 && (
          <EmptyState
            title={search ? "No channels match your search." : "No channels yet."}
            description={
              search
                ? "Try a different query or clear the search field."
                : "Channels are where humans and agents talk together. Mention an agent with @ to bring it into the conversation."
            }
            action={
              !search ? (
                <Button variant="primary" size="sm" onClick={() => setShowNew(true)}>
                  + New channel
                </Button>
              ) : undefined
            }
          />
        )}
        {!isLoading && !error && visible.length > 0 && (
          <ul
            style={{
              listStyle: "none",
              margin: 0,
              padding: 0,
              display: "flex",
              flexDirection: "column",
              gap: "var(--space-1)",
            }}
          >
            {visible.map((c) => (
              <li key={c.session_id}>
                <button
                  type="button"
                  onClick={() => navigate(`${base}/channels/${encodeURIComponent(c.session_id)}`)}
                  className="ideas-list-row"
                  style={{
                    width: "100%",
                    background: "transparent",
                    border: 0,
                    textAlign: "left",
                    cursor: "pointer",
                    padding: "var(--space-3)",
                    display: "flex",
                    alignItems: "center",
                    gap: "var(--space-3)",
                    borderRadius: "var(--radius-2)",
                  }}
                >
                  <span
                    aria-hidden
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      width: 28,
                      height: 28,
                      borderRadius: 999,
                      background: "var(--color-bg-subtle)",
                      color: "var(--color-text-muted)",
                      flexShrink: 0,
                    }}
                  >
                    <ChannelGlyph />
                  </span>
                  <span
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      minWidth: 0,
                      flex: 1,
                      gap: 2,
                    }}
                  >
                    <span
                      style={{
                        fontSize: "var(--font-size-sm)",
                        fontWeight: 600,
                        color: "var(--color-text-primary)",
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {c.name}
                    </span>
                    <span
                      style={{
                        fontSize: "var(--font-size-xs)",
                        color: "var(--color-text-muted)",
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {c.last_message_preview ?? "No messages yet"}
                    </span>
                  </span>
                  <span
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "flex-end",
                      gap: 2,
                      flexShrink: 0,
                    }}
                  >
                    <span
                      style={{
                        fontSize: "var(--font-size-xs)",
                        color: "var(--color-text-muted)",
                      }}
                    >
                      {formatRelative(c.last_message_at)}
                    </span>
                    <span
                      style={{
                        fontSize: "var(--font-size-xs)",
                        color: "var(--color-text-muted)",
                      }}
                    >
                      {c.participant_count} {c.participant_count === 1 ? "member" : "members"}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {showNew && (
        <NewChannelModal
          entityId={entityId}
          submitting={create.isPending}
          error={create.error instanceof Error ? create.error.message : null}
          onClose={() => setShowNew(false)}
          onSubmit={(name, participants) => create.mutate({ name, participants })}
        />
      )}
    </div>
  );
}
