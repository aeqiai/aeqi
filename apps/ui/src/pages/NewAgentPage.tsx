import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { api } from "@/lib/api";
import { useUIStore } from "@/store/ui";
import { useDaemonStore } from "@/store/daemon";
import BlockAvatar from "@/components/BlockAvatar";
import { Spinner } from "@/components/ui";
import "@/styles/welcome.css";
import "@/styles/templates.css";
import "@/styles/modals.css";

interface IdentityOption {
  slug: string;
  name: string;
  description?: string;
}

/**
 * /new — agent creation page (root or sub-agent).
 *
 * Query params:
 *   - ?parent=<agentId>  → sub-agent mode: spawn under an existing agent
 *                         using the identity-template picker.
 *   - (no params)        → root mode: either jump to the company template
 *                         store or create an empty root agent inline.
 *
 * This is a full page, not a modal. Creation of agents is a first-class
 * act in AEQI — a modal would undersell it.
 */
export default function NewAgentPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const setActiveRoot = useUIStore((s) => s.setActiveRoot);
  const fetchAgents = useDaemonStore((s) => s.fetchAgents);
  const allAgents = useDaemonStore((s) => s.agents);

  const parentId = (searchParams.get("parent") || "").trim();
  const subAgentMode = parentId.length > 0;
  const parentAgent = useMemo(
    () => (subAgentMode ? allAgents.find((a) => a.id === parentId) : null),
    [allAgents, parentId, subAgentMode],
  );

  useEffect(() => {
    document.title = subAgentMode ? "new sub-agent · æqi" : "new agent · æqi";
  }, [subAgentMode]);

  // Daemon store may be cold on direct URL load (/new lives outside
  // AppLayout, which is the usual bootstrap). Fetch once so parentAgent
  // resolves to a real label instead of the "this agent" fallback.
  useEffect(() => {
    if (subAgentMode && allAgents.length === 0) {
      fetchAgents().catch(() => {
        /* non-fatal — label falls back, spawn still works */
      });
    }
  }, [subAgentMode, allAgents.length, fetchAgents]);

  return subAgentMode ? (
    <SubAgentForm
      navigate={navigate}
      parentId={parentId}
      parentLabel={parentAgent?.display_name || parentAgent?.name || "this agent"}
      onSpawned={async (newId) => {
        await fetchAgents();
        navigate(`/${encodeURIComponent(newId)}`);
      }}
    />
  ) : (
    <RootForm
      navigate={navigate}
      onCreated={async (rootId) => {
        setActiveRoot(rootId);
        await fetchAgents();
        navigate(`/${encodeURIComponent(rootId)}`);
      }}
    />
  );
}

/* ── Root mode: either go to /templates or create an empty root ──────── */

function RootForm({
  navigate,
  onCreated,
}: {
  navigate: (to: string) => void;
  onCreated: (rootId: string) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [tagline, setTagline] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const handleCreate = async () => {
    if (!name.trim() || creating) return;
    setCreating(true);
    setError("");
    try {
      const resp = await api.createRoot({
        name: name.trim(),
        tagline: tagline.trim() || undefined,
      });
      const rootId =
        (resp as Record<string, unknown>).id ||
        (resp as Record<string, unknown>).root ||
        name.trim();
      if (imageUrl) localStorage.setItem("aeqi_root_avatar", imageUrl);
      if (tagline.trim()) localStorage.setItem("aeqi_root_tagline", tagline.trim());
      await onCreated(rootId as string);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to create agent");
      setCreating(false);
    }
  };

  return (
    <div className="new-co-page">
      <div className="new-co-container new-co-animate">
        <BackLink onClick={() => navigate("/")} label="Back" />

        <button type="button" className="tpl-promo-card" onClick={() => navigate("/templates")}>
          <span className="tpl-promo-icon" aria-hidden="true">
            <TemplateGridIcon />
          </span>
          <span className="tpl-promo-body">
            <span className="tpl-promo-title">Start from a template</span>
            <span className="tpl-promo-sub">
              Pre-threaded companies — agents, events, ideas, and quests already alive.
            </span>
          </span>
          <ArrowRight className="tpl-promo-arrow" />
        </button>

        <div className="tpl-divider">
          <span className="tpl-divider-label">Or start empty</span>
        </div>

        <div className="new-co-hero">
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            style={{ display: "none" }}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              const reader = new FileReader();
              reader.onload = () => setImageUrl(reader.result as string);
              reader.readAsDataURL(file);
              e.target.value = "";
            }}
          />
          <div className="new-co-identity">
            <button
              type="button"
              className="new-co-avatar"
              onClick={() => fileRef.current?.click()}
              aria-label="Upload avatar"
              title="Upload avatar"
            >
              {imageUrl ? (
                <img src={imageUrl} alt="" className="new-co-avatar-img" />
              ) : (
                <BlockAvatar name={name || "W"} size={56} />
              )}
              <span className="new-co-avatar-overlay">
                <UploadIcon />
              </span>
            </button>
            <div className="new-co-identity-fields">
              <input
                className="new-co-name-input"
                placeholder="Agent name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && name.trim()) handleCreate();
                }}
                autoFocus
              />
              <input
                className="new-co-tagline-input"
                placeholder="Add a tagline..."
                value={tagline}
                onChange={(e) => setTagline(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && name.trim()) handleCreate();
                }}
              />
            </div>
          </div>
        </div>

        {error && <div className="new-co-error">{error}</div>}

        <button
          type="button"
          className="new-co-submit"
          onClick={handleCreate}
          disabled={!name.trim() || creating}
          aria-busy={creating}
        >
          {creating ? (
            <>
              <Spinner size="sm" />
              Creating…
            </>
          ) : (
            <>
              Create empty agent <kbd className="new-co-kbd">↵</kbd>
            </>
          )}
        </button>

        <p className="new-co-hint">
          An empty agent starts with no threads. You can rename or re-skin it anytime.
        </p>
      </div>
    </div>
  );
}

/* ── Sub-agent mode: identity-template picker + optional overrides ───── */

function SubAgentForm({
  navigate,
  parentId,
  parentLabel,
  onSpawned,
}: {
  navigate: (to: string) => void;
  parentId: string;
  parentLabel: string;
  onSpawned: (newAgentId: string) => Promise<void>;
}) {
  const [templates, setTemplates] = useState<IdentityOption[]>([]);
  const [loadingTemplates, setLoadingTemplates] = useState(true);
  const [template, setTemplate] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [systemPrompt, setSystemPrompt] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    api
      .getIdentityTemplates()
      .then((data) => {
        setTemplates(
          (data.identities || []).map((t) => ({
            slug: t.slug,
            name: t.name || t.slug,
            description: t.description,
          })),
        );
      })
      .catch(() => {
        setTemplates([]);
      })
      .finally(() => setLoadingTemplates(false));
  }, []);

  const canSubmit = template.trim().length > 0 && !submitting;

  // Keyboard shortcuts: ⌘/Ctrl-Enter submits from anywhere on the page
  // (including the textarea), Escape cancels back to the parent's Agents
  // tab. Plain Enter in single-line inputs also submits for symmetry
  // with the root-form flow.
  const handleCancel = () => navigate(`/${encodeURIComponent(parentId)}/agents`);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !submitting) {
        handleCancel();
        return;
      }
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && canSubmit) {
        e.preventDefault();
        void handleSubmit();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canSubmit, submitting]);

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError("");
    try {
      const resp = await api.spawnAgent({
        template: template.trim(),
        parent_id: parentId,
        ...(displayName.trim() ? { display_name: displayName.trim() } : {}),
        ...(systemPrompt.trim() ? { system_prompt: systemPrompt.trim() } : {}),
      });
      const newId =
        (resp as Record<string, unknown>)?.agent &&
        ((resp as Record<string, unknown>).agent as Record<string, unknown>)?.id;
      if (typeof newId === "string" && newId.length > 0) {
        await onSpawned(newId);
      } else {
        await onSpawned(parentId);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to spawn agent.");
      setSubmitting(false);
    }
  };

  return (
    <div className="new-co-page">
      <div className="new-co-container new-co-animate">
        <BackLink
          onClick={() => navigate(`/${encodeURIComponent(parentId)}/agents`)}
          label={`Back to ${parentLabel}`}
        />

        <header className="new-sub-hero">
          <p className="new-sub-eyebrow">Spawn sub-agent</p>
          <h1 className="new-sub-title">
            New agent under <span className="new-sub-parent">{parentLabel}</span>
          </h1>
          <p className="new-sub-desc">
            Pick an identity, give it a name, and it joins the tree as a direct child.
          </p>
        </header>

        <section className="new-sub-section">
          <div className="new-sub-section-head">
            <span className="new-sub-label">Identity</span>
            {loadingTemplates && (
              <span className="new-sub-loading">
                <Spinner size="sm" />
                loading…
              </span>
            )}
          </div>
          <div className="cam-template-grid" role="radiogroup" aria-label="Identity template">
            {templates.map((t) => {
              const active = template === t.slug;
              return (
                <button
                  key={t.slug}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  className={`cam-template-card${active ? " is-active" : ""}`}
                  onClick={() => setTemplate(t.slug)}
                  title={t.description || t.name}
                >
                  <span className="cam-template-card-dot" />
                  <span className="cam-template-card-name">{t.name}</span>
                </button>
              );
            })}
            {!loadingTemplates && templates.length === 0 && (
              <p className="new-sub-empty">
                No identity templates available — runtime catalog is empty.
              </p>
            )}
          </div>
        </section>

        <section className="new-sub-section">
          <label className="new-sub-label" htmlFor="new-sub-name">
            Name
            <span className="new-sub-optional"> · optional</span>
          </label>
          <input
            id="new-sub-name"
            className="new-co-name-input"
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && canSubmit) {
                e.preventDefault();
                void handleSubmit();
              }
            }}
            placeholder={template ? `e.g. Senior ${template}` : "Display name"}
            autoFocus
          />
        </section>

        <section className="new-sub-section">
          <label className="new-sub-label" htmlFor="new-sub-prompt">
            Identity
            <span className="new-sub-optional"> · override</span>
          </label>
          <textarea
            id="new-sub-prompt"
            className="new-sub-textarea"
            value={systemPrompt}
            onChange={(e) => setSystemPrompt(e.target.value)}
            placeholder="Leave blank to inherit from the identity template."
            rows={4}
          />
        </section>

        {error && <div className="new-co-error">{error}</div>}

        <div className="new-sub-actions">
          <button
            type="button"
            className="new-sub-cancel"
            onClick={handleCancel}
            disabled={submitting}
            title="Esc"
          >
            Cancel
          </button>
          <button
            type="button"
            className="new-co-submit"
            onClick={handleSubmit}
            disabled={!canSubmit}
            aria-busy={submitting}
          >
            {submitting ? (
              <>
                <Spinner size="sm" />
                Spawning…
              </>
            ) : (
              <>
                Spawn agent <kbd className="new-co-kbd">↵</kbd>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Small shared bits ───────────────────────────────────────────────── */

function BackLink({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button type="button" className="new-co-back" onClick={onClick}>
      <svg
        width="14"
        height="14"
        viewBox="0 0 14 14"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      >
        <path d="M8.5 3L4.5 7l4 4" />
      </svg>
      {label}
    </button>
  );
}

function TemplateGridIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="2" y="2" width="5" height="5" rx="1" />
      <rect x="9" y="2" width="5" height="5" rx="1" />
      <rect x="2" y="9" width="5" height="5" rx="1" />
      <rect x="9" y="9" width="5" height="5" rx="1" />
    </svg>
  );
}

function ArrowRight({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="14"
      height="14"
      viewBox="0 0 14 14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
    >
      <path d="M5 3l4 4-4 4" />
    </svg>
  );
}

function UploadIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
    >
      <path d="M2 11l3.5-3.5L8 10l3-4 3 3M2 14h12" />
    </svg>
  );
}
