import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Settings } from "lucide-react";
import { api } from "@/lib/api";
import { useDaemonStore } from "@/store/daemon";
import { entityBasePath } from "@/lib/entityPath";
import CompanyAvatar from "./CompanyAvatar";
import { Textarea } from "./ui";

/**
 * `CompanyHeroStrip` — compact Company identity header.
 *
 * Private Views uses this as cockpit chrome, not a second Home hero. Public
 * profile mode can still carry the atmospheric image because that route has no
 * surrounding operator shell.
 */
interface PublicEntityShape {
  display_name: string;
  tagline: string | null;
}

interface CompanyHeroStripProps {
  companyId: string;
  /** Read-only public-profile mode (PublicProfilePage). */
  public?: boolean;
  /** Public-mode data source; required when `public={true}`. */
  publicEntity?: PublicEntityShape;
  /**
   * Optional right-side slot. The company Views landing surfaces a
   * consolidated Execution + Ownership panel here; public mode and
   * minimal embeds can leave it undefined.
   */
  aside?: React.ReactNode;
}

export default function CompanyHeroStrip({
  companyId,
  public: isPublicMode = false,
  publicEntity,
  aside,
}: CompanyHeroStripProps) {
  const entities = useDaemonStore((s) => s.entities);
  const fetchEntities = useDaemonStore((s) => s.fetchEntities);
  const entity = entities.find((e) => e.id === companyId);

  const [editingName, setEditingName] = useState(false);
  const [editingTagline, setEditingTagline] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [taglineDraft, setTaglineDraft] = useState("");

  const nameInputRef = useRef<HTMLInputElement>(null);
  const taglineInputRef = useRef<HTMLTextAreaElement>(null);

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
      await api.updateEntity(companyId, { name: trimmed });
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
      await api.updateEntity(companyId, { tagline: trimmed });
      await fetchEntities();
    } catch (e) {
      console.error("update tagline failed", e);
    }
  };

  const name = isPublicMode
    ? (publicEntity?.display_name ?? companyId)
    : (entity?.name ?? companyId);
  const tagline = isPublicMode ? (publicEntity?.tagline ?? "") : (entity?.tagline ?? "");
  const settingsPath = !isPublicMode && entity ? `${entityBasePath(entity)}/settings` : null;

  return (
    <header
      className={`company-hero${isPublicMode ? " company-hero--public" : ""}${
        aside ? " company-hero--with-bar" : ""
      }`}
      aria-label="Company identity"
    >
      {isPublicMode && (
        <img
          src="/welcome/start-hero.png"
          alt=""
          className="company-hero-image"
          aria-hidden="true"
        />
      )}
      <div className="company-hero-identity">
        <div className="company-hero-avatar" aria-hidden>
          <CompanyAvatar name={name} size={88} />
        </div>

        <div className="company-hero-body">
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
              className="company-hero-name-input"
            />
          ) : isPublicMode ? (
            <h1 className="company-hero-name">{name}</h1>
          ) : (
            <button
              type="button"
              onClick={startNameEdit}
              title="Click to rename"
              className="company-hero-name company-hero-name--button"
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
              className="company-hero-tagline-input"
            />
          ) : isPublicMode ? (
            tagline ? (
              <p className="company-hero-tagline">{tagline}</p>
            ) : null
          ) : (
            <button
              type="button"
              onClick={startTaglineEdit}
              title="Click to edit tagline"
              className={
                tagline
                  ? "company-hero-tagline company-hero-tagline--button"
                  : "company-hero-tagline company-hero-tagline--button company-hero-tagline--empty"
              }
            >
              {tagline || "Add a tagline"}
            </button>
          )}
        </div>
        {settingsPath && (
          <Link
            to={settingsPath}
            className="company-hero-settings"
            aria-label="Open COMPANY settings"
            title="COMPANY settings"
          >
            <Settings size={16} strokeWidth={1.6} />
          </Link>
        )}
      </div>

      {aside && <div className="company-hero-footer">{aside}</div>}
    </header>
  );
}
