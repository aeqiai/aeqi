import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "@/lib/api";
import { launchPlanById } from "@/lib/pricing";
import { useDaemonStore } from "@/store/daemon";
import BlockAvatar from "./BlockAvatar";

/**
 * `EntityHeroStrip` — top of every Company Overview surface.
 *
 * Click-to-edit name + tagline persist via `api.updateEntity`. Public
 * toggle flips `entities.public` (Phase 2 ships the public profile page
 * itself; Phase 1 only sets the flag). Plan label-link routes to the
 * organization plan tab.
 *
 * In `public` mode the strip renders read-only: no click-to-edit on name
 * or tagline, no plan label, no public/private toggle (the viewer is
 * already on the public profile, so the toggle would be tautological).
 * The data source switches from the daemon store to the public-profile
 * payload passed in via `publicEntity` — daemon store is empty for
 * unauthenticated visitors. Used by `PublicProfilePage`.
 *
 * Design tokens only; no bespoke colors, no hairline borders. The strip
 * sits above the existing dashboard grid; height is content-driven
 * (inline editor swaps grow vertically without knocking the grid).
 */
interface PublicEntityShape {
  display_name: string;
  tagline: string | null;
}

interface EntityHeroStripProps {
  entityId: string;
  /**
   * When true, render the strip read-only — hides edit affordances, plan
   * label, and public/private toggle. Used by the unauthenticated public
   * profile page.
   */
  public?: boolean;
  /**
   * Public-mode data source. Required when `public={true}` because the
   * daemon store is empty for unauth visitors. Ignored otherwise.
   */
  publicEntity?: PublicEntityShape;
}

export default function EntityHeroStrip({
  entityId,
  public: isPublicMode = false,
  publicEntity,
}: EntityHeroStripProps) {
  const entities = useDaemonStore((s) => s.entities);
  const fetchEntities = useDaemonStore((s) => s.fetchEntities);
  const entity = entities.find((e) => e.id === entityId);

  // Local edit state — switches between display and inline-input modes.
  const [editingName, setEditingName] = useState(false);
  const [editingTagline, setEditingTagline] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [taglineDraft, setTaglineDraft] = useState("");
  const [isPublic, setIsPublic] = useState<boolean>(entity?.public === true);
  const [savingPublic, setSavingPublic] = useState(false);

  const nameInputRef = useRef<HTMLInputElement>(null);
  const taglineInputRef = useRef<HTMLTextAreaElement>(null);

  // Keep public toggle synced with store (it's the source of truth after
  // each fetchEntities refresh).
  useEffect(() => {
    setIsPublic(entity?.public === true);
  }, [entity?.public]);

  // Auto-focus when edit mode opens.
  useEffect(() => {
    if (editingName) {
      nameInputRef.current?.focus();
      nameInputRef.current?.select();
    }
  }, [editingName]);
  useEffect(() => {
    if (editingTagline) {
      taglineInputRef.current?.focus();
      taglineInputRef.current?.select();
    }
  }, [editingTagline]);

  const startNameEdit = () => {
    setNameDraft(entity?.name ?? "");
    setEditingName(true);
  };
  const startTaglineEdit = () => {
    setTaglineDraft(entity?.tagline ?? "");
    setEditingTagline(true);
  };

  const commitName = async () => {
    const trimmed = nameDraft.trim();
    setEditingName(false);
    if (!trimmed || trimmed === entity?.name) return;
    try {
      await api.updateEntity(entityId, { name: trimmed });
      await fetchEntities();
    } catch (e) {
      console.error("rename entity failed", e);
    }
  };

  const commitTagline = async () => {
    const trimmed = taglineDraft.trim();
    setEditingTagline(false);
    if (trimmed === (entity?.tagline ?? "")) return;
    try {
      await api.updateEntity(entityId, { tagline: trimmed });
      await fetchEntities();
    } catch (e) {
      console.error("update tagline failed", e);
    }
  };

  const togglePublic = async () => {
    if (savingPublic) return;
    const next = !isPublic;
    setIsPublic(next);
    setSavingPublic(true);
    try {
      await api.updateEntity(entityId, { public: next });
      await fetchEntities();
    } catch (e) {
      console.error("toggle public failed", e);
      setIsPublic(!next); // rollback
    } finally {
      setSavingPublic(false);
    }
  };

  const planLabel = (() => {
    if (!entity?.plan) return "No plan";
    const plan = launchPlanById(entity.plan);
    return `${plan.name} · ${plan.price}/mo`;
  })();

  const name = isPublicMode ? (publicEntity?.display_name ?? entityId) : (entity?.name ?? entityId);
  const tagline = isPublicMode ? (publicEntity?.tagline ?? "") : (entity?.tagline ?? "");

  return (
    <header
      className="entity-hero-strip"
      style={{
        display: "flex",
        gap: "var(--space-5)",
        alignItems: "flex-start",
        padding: "var(--space-6) 0",
        marginBottom: "var(--space-6)",
      }}
      aria-label="Company hero"
    >
      <div
        style={{
          width: 96,
          height: 96,
          flexShrink: 0,
          borderRadius: "var(--radius-md)",
          overflow: "hidden",
          background: "var(--color-bg-subtle)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <BlockAvatar name={name} size={96} />
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        {!isPublicMode && editingName ? (
          <input
            ref={nameInputRef}
            value={nameDraft}
            onChange={(e) => setNameDraft(e.target.value)}
            onBlur={commitName}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void commitName();
              } else if (e.key === "Escape") {
                setEditingName(false);
              }
            }}
            maxLength={64}
            className="entity-hero-name-input"
            style={{
              font: "inherit",
              fontSize: "var(--font-size-3xl)",
              fontWeight: 600,
              lineHeight: 1.1,
              border: "none",
              background: "transparent",
              padding: 0,
              margin: 0,
              width: "100%",
              color: "var(--color-text-primary)",
              outline: "none",
            }}
          />
        ) : isPublicMode ? (
          <h1
            style={{
              font: "inherit",
              fontSize: "var(--font-size-3xl)",
              fontWeight: 600,
              lineHeight: 1.1,
              padding: 0,
              margin: 0,
              color: "var(--color-text-primary)",
            }}
          >
            {name}
          </h1>
        ) : (
          <button
            type="button"
            onClick={startNameEdit}
            title="Click to rename"
            style={{
              font: "inherit",
              fontSize: "var(--font-size-3xl)",
              fontWeight: 600,
              lineHeight: 1.1,
              border: "none",
              background: "transparent",
              padding: 0,
              margin: 0,
              cursor: "text",
              color: "var(--color-text-primary)",
              textAlign: "left",
              display: "block",
              width: "100%",
            }}
          >
            {name}
          </button>
        )}

        {!isPublicMode && editingTagline ? (
          <textarea
            ref={taglineInputRef}
            value={taglineDraft}
            onChange={(e) => setTaglineDraft(e.target.value)}
            onBlur={commitTagline}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void commitTagline();
              } else if (e.key === "Escape") {
                setEditingTagline(false);
              }
            }}
            maxLength={200}
            placeholder="Add a tagline"
            rows={2}
            style={{
              font: "inherit",
              fontStyle: "italic",
              fontSize: "var(--font-size-sm)",
              lineHeight: 1.4,
              border: "none",
              background: "transparent",
              padding: 0,
              margin: "var(--space-2) 0 0 0",
              width: "100%",
              color: "var(--color-text-secondary)",
              outline: "none",
              resize: "none",
            }}
          />
        ) : isPublicMode ? (
          tagline ? (
            <p
              style={{
                font: "inherit",
                fontStyle: "italic",
                fontSize: "var(--font-size-sm)",
                lineHeight: 1.4,
                padding: 0,
                margin: "var(--space-2) 0 0 0",
                color: "var(--color-text-secondary)",
              }}
            >
              {tagline}
            </p>
          ) : null
        ) : (
          <button
            type="button"
            onClick={startTaglineEdit}
            title="Click to edit tagline"
            style={{
              font: "inherit",
              fontStyle: "italic",
              fontSize: "var(--font-size-sm)",
              lineHeight: 1.4,
              border: "none",
              background: "transparent",
              padding: 0,
              margin: "var(--space-2) 0 0 0",
              cursor: "text",
              color: tagline ? "var(--color-text-secondary)" : "var(--color-text-muted)",
              textAlign: "left",
              display: "block",
              width: "100%",
            }}
          >
            {tagline || "Add a tagline"}
          </button>
        )}

        {!isPublicMode && (
          <div
            style={{
              display: "flex",
              gap: "var(--space-4)",
              alignItems: "center",
              marginTop: "var(--space-4)",
              flexWrap: "wrap",
              fontSize: "var(--font-size-sm)",
              color: "var(--color-text-muted)",
            }}
          >
            <Link
              to="/account/billing"
              style={{
                color: "inherit",
                textDecoration: "none",
                fontVariantNumeric: "tabular-nums",
              }}
              title="Manage workspace billing"
            >
              {planLabel}
            </Link>

            <span aria-hidden style={{ opacity: 0.5 }}>
              ·
            </span>

            <label
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "var(--space-2)",
                cursor: savingPublic ? "wait" : "pointer",
                userSelect: "none",
              }}
              title={
                isPublic ? "Profile is public at <host>/<slug>" : "Profile is private to members"
              }
            >
              <input
                type="checkbox"
                checked={isPublic}
                onChange={togglePublic}
                disabled={savingPublic}
                style={{ accentColor: "var(--color-accent)" }}
              />
              <span>{isPublic ? "Public" : "Private"}</span>
            </label>
          </div>
        )}
      </div>
    </header>
  );
}
