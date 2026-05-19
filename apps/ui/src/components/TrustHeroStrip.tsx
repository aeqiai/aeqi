import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "@/lib/api";
import { launchPlanById } from "@/lib/pricing";
import { useDaemonStore } from "@/store/daemon";
import BlockAvatar from "./BlockAvatar";
import { Textarea } from "./ui";

/**
 * `TrustHeroStrip` — top of every Company Overview surface.
 *
 * Click-to-edit name + tagline persist via `api.updateEntity`. Public
 * toggle flips `entities.public`. Plan label-link routes to the
 * organization billing tab.
 *
 * In `public` mode the strip renders read-only: no click-to-edit on
 * name or tagline, no plan label, no public/private toggle (the viewer
 * is already on the public profile). Data source switches to
 * `publicEntity` since the daemon store is empty for unauth visitors.
 *
 * All styling moved to overview.css under the `.trust-hero-*` namespace
 * 2026-05-19. No inline styles; tokens only.
 */
interface PublicEntityShape {
  display_name: string;
  tagline: string | null;
}

interface TrustHeroStripProps {
  trustId: string;
  /** Read-only public-profile mode (PublicProfilePage). */
  public?: boolean;
  /** Public-mode data source; required when `public={true}`. */
  publicEntity?: PublicEntityShape;
}

export default function TrustHeroStrip({
  trustId,
  public: isPublicMode = false,
  publicEntity,
}: TrustHeroStripProps) {
  const entities = useDaemonStore((s) => s.entities);
  const fetchEntities = useDaemonStore((s) => s.fetchEntities);
  const entity = entities.find((e) => e.id === trustId);

  const [editingName, setEditingName] = useState(false);
  const [editingTagline, setEditingTagline] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [taglineDraft, setTaglineDraft] = useState("");
  const [isPublic, setIsPublic] = useState<boolean>(entity?.public === true);
  const [savingPublic, setSavingPublic] = useState(false);

  const nameInputRef = useRef<HTMLInputElement>(null);
  const taglineInputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setIsPublic(entity?.public === true);
  }, [entity?.public]);

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
      await api.updateEntity(trustId, { name: trimmed });
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
      await api.updateEntity(trustId, { tagline: trimmed });
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
      await api.updateEntity(trustId, { public: next });
      await fetchEntities();
    } catch (e) {
      console.error("toggle public failed", e);
      setIsPublic(!next);
    } finally {
      setSavingPublic(false);
    }
  };

  const planLabel = (() => {
    if (!entity?.plan) return null;
    const plan = launchPlanById(entity.plan);
    return `${plan.name} · ${plan.price}/mo`;
  })();

  const name = isPublicMode ? (publicEntity?.display_name ?? trustId) : (entity?.name ?? trustId);
  const tagline = isPublicMode ? (publicEntity?.tagline ?? "") : (entity?.tagline ?? "");

  return (
    <header className="trust-hero" aria-label="Trust identity">
      <div className="trust-hero-avatar" aria-hidden>
        <BlockAvatar name={name} size={88} />
      </div>

      <div className="trust-hero-body">
        <span className="trust-hero-eyebrow">TRUST</span>

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
            className="trust-hero-name-input"
          />
        ) : isPublicMode ? (
          <h1 className="trust-hero-name">{name}</h1>
        ) : (
          <button
            type="button"
            onClick={startNameEdit}
            title="Click to rename"
            className="trust-hero-name trust-hero-name--button"
          >
            {name}
          </button>
        )}

        {!isPublicMode && editingTagline ? (
          <Textarea
            bare
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
            className="trust-hero-tagline-input"
          />
        ) : isPublicMode ? (
          tagline ? (
            <p className="trust-hero-tagline">{tagline}</p>
          ) : null
        ) : (
          <button
            type="button"
            onClick={startTaglineEdit}
            title="Click to edit tagline"
            className={
              tagline
                ? "trust-hero-tagline trust-hero-tagline--button"
                : "trust-hero-tagline trust-hero-tagline--button trust-hero-tagline--empty"
            }
          >
            {tagline || "Add a tagline"}
          </button>
        )}

        {!isPublicMode && (
          <div className="trust-hero-chrome">
            {planLabel && (
              <Link
                to="/account/billing"
                className="trust-hero-chrome-link"
                title="Manage workspace billing"
              >
                {planLabel}
              </Link>
            )}
            {planLabel && (
              <span aria-hidden className="trust-hero-chrome-sep">
                ·
              </span>
            )}
            <label
              className="trust-hero-public"
              title={
                isPublic ? "Profile is public at <host>/<slug>" : "Profile is private to members"
              }
            >
              <input
                type="checkbox"
                checked={isPublic}
                onChange={togglePublic}
                disabled={savingPublic}
              />
              <span>{isPublic ? "Public" : "Private"}</span>
            </label>
          </div>
        )}
      </div>
    </header>
  );
}
