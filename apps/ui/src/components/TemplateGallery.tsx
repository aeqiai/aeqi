import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CompanyTemplate } from "@/lib/types";
import "@/styles/templates.css";

/**
 * Shared contract for gallery callers — templates-page, home empty state,
 * anywhere the catalog of companies appears. Mirrors the subset of
 * `CompanyTemplate` the gallery actually renders.
 */
export type TemplateSummary = CompanyTemplate;

/**
 * Identity (persona) summary — the non-company row. These won't render
 * the a/i/e/q counts; they show a single identity-type marker. Sourced
 * from `/api/templates/identities` (leader / researcher / reviewer today).
 */
export interface IdentitySummary {
  slug: string;
  name: string;
  display_name?: string | null;
  description?: string;
}

type Kind = "company" | "identity";

interface Props {
  companyTemplates: TemplateSummary[];
  identityTemplates?: IdentitySummary[];
  onPick: (slug: string, kind: Kind) => void;
  /** Slug that should open the preview drawer on mount (deep-link). */
  initialSlug?: string;
  /** Optional: called when the preview is dismissed. Lets callers clean URL. */
  onPreviewClose?: () => void;
}

interface Cell {
  kind: Kind;
  slug: string;
  name: string;
  tagline?: string;
  description?: string;
  counts: { agents: number; ideas: number; events: number; quests: number };
  raw: TemplateSummary | IdentitySummary;
}

function toCompanyCell(t: TemplateSummary): Cell {
  return {
    kind: "company",
    slug: t.slug,
    name: t.name,
    tagline: t.tagline,
    description: t.description,
    counts: {
      agents: t.seed_agents?.length ?? 0,
      ideas: t.seed_ideas?.length ?? 0,
      events: t.seed_events?.length ?? 0,
      quests: t.seed_quests?.length ?? 0,
    },
    raw: t,
  };
}

function toIdentityCell(i: IdentitySummary): Cell {
  return {
    kind: "identity",
    slug: i.slug,
    name: i.display_name || i.name,
    description: i.description,
    counts: { agents: 1, ideas: 0, events: 0, quests: 0 },
    raw: i,
  };
}

/**
 * TemplateGallery — the reusable catalog surface. An asymmetric grid of
 * flat white cards on paper, each a company (or persona) the user can
 * spawn. Keyboard: j/k or arrow keys cycle cards, Enter opens preview.
 *
 * Visual rules: flat white on paper, hairline border, no drop shadows,
 * a · i · e · q monogram row for counts (no explicit labels). The first
 * card is featured — wider, with tagline visible — to break the uniform
 * grid and give the page a focal point.
 */
export default function TemplateGallery({
  companyTemplates,
  identityTemplates = [],
  onPick,
  initialSlug,
  onPreviewClose,
}: Props) {
  const cells = useMemo<Cell[]>(() => {
    const co = companyTemplates.map(toCompanyCell);
    const id = identityTemplates.map(toIdentityCell);
    return [...co, ...id];
  }, [companyTemplates, identityTemplates]);

  const [focusIdx, setFocusIdx] = useState<number>(0);
  const [previewSlug, setPreviewSlug] = useState<string | null>(null);
  const cardRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const rootRef = useRef<HTMLDivElement | null>(null);

  // Deep-link: open preview for initialSlug once the catalog is present.
  useEffect(() => {
    if (!initialSlug) return;
    const idx = cells.findIndex((c) => c.slug === initialSlug);
    if (idx < 0) return;
    setFocusIdx(idx);
    setPreviewSlug(initialSlug);
    // Scroll the focused card into view so deep-link feels intentional.
    requestAnimationFrame(() => {
      cardRefs.current[idx]?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  }, [initialSlug, cells]);

  const preview = useMemo<Cell | null>(
    () => (previewSlug ? cells.find((c) => c.slug === previewSlug) || null : null),
    [previewSlug, cells],
  );

  const openPreview = useCallback((cell: Cell) => {
    setPreviewSlug(cell.slug);
  }, []);

  const closePreview = useCallback(() => {
    setPreviewSlug(null);
    onPreviewClose?.();
  }, [onPreviewClose]);

  const spawn = useCallback(
    (cell: Cell) => {
      onPick(cell.slug, cell.kind);
    },
    [onPick],
  );

  // Keyboard: j/k + arrows cycle, Enter opens preview. Only active when the
  // gallery root has focus within (i.e. user is actually navigating cards).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!rootRef.current) return;
      if (!rootRef.current.contains(document.activeElement)) return;
      if (preview) return; // preview owns keyboard when open
      if (cells.length === 0) return;
      if (e.key === "j" || e.key === "ArrowDown" || e.key === "ArrowRight") {
        e.preventDefault();
        const next = (focusIdx + 1) % cells.length;
        setFocusIdx(next);
        cardRefs.current[next]?.focus();
      } else if (e.key === "k" || e.key === "ArrowUp" || e.key === "ArrowLeft") {
        e.preventDefault();
        const next = (focusIdx - 1 + cells.length) % cells.length;
        setFocusIdx(next);
        cardRefs.current[next]?.focus();
      } else if (e.key === "Enter") {
        const cell = cells[focusIdx];
        if (cell) {
          e.preventDefault();
          openPreview(cell);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [cells, focusIdx, openPreview, preview]);

  // Preview modal: Esc closes, Enter spawns.
  useEffect(() => {
    if (!preview) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        closePreview();
      } else if (e.key === "Enter") {
        e.preventDefault();
        spawn(preview);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [preview, closePreview, spawn]);

  if (cells.length === 0) {
    return (
      <div className="gallery" ref={rootRef}>
        <p className="gallery-empty">No templates available yet.</p>
      </div>
    );
  }

  return (
    <div className="gallery" ref={rootRef}>
      <div className="gallery-grid" role="list">
        {cells.map((cell, idx) => {
          const featured = idx === 0;
          return (
            <button
              key={`${cell.kind}:${cell.slug}`}
              ref={(el) => {
                cardRefs.current[idx] = el;
              }}
              type="button"
              role="listitem"
              className={`gallery-card${featured ? " is-featured" : ""}`}
              onClick={() => openPreview(cell)}
              onFocus={() => setFocusIdx(idx)}
              aria-label={`${cell.name}${cell.tagline ? ` — ${cell.tagline}` : ""}`}
            >
              <h3 className="gallery-card-name">{cell.name}</h3>
              {cell.tagline && <p className="gallery-card-tagline">{cell.tagline}</p>}
              {featured && cell.description && (
                <p className="gallery-card-desc">{cell.description}</p>
              )}
              <MonogramRow counts={cell.counts} kind={cell.kind} />
            </button>
          );
        })}
      </div>

      {preview && (
        <PreviewDrawer cell={preview} onClose={closePreview} onStart={() => spawn(preview)} />
      )}
    </div>
  );
}

/**
 * a · i · e · q — one letter per primitive in JetBrains Mono, followed by
 * the count. The letters carry the meaning; no "Agents: 3" label. For
 * identity cells we show only `a·1` so the row stays readable.
 */
function MonogramRow({ counts, kind }: { counts: Cell["counts"]; kind: Kind }) {
  if (kind === "identity") {
    return (
      <div className="gallery-monograms">
        <Monogram letter="a" n={counts.agents} />
        <span className="gallery-monogram-tag">persona</span>
      </div>
    );
  }
  return (
    <div className="gallery-monograms" aria-label="seed counts">
      <Monogram letter="a" n={counts.agents} />
      <Monogram letter="i" n={counts.ideas} />
      <Monogram letter="e" n={counts.events} />
      <Monogram letter="q" n={counts.quests} />
    </div>
  );
}

function Monogram({ letter, n }: { letter: string; n: number }) {
  return (
    <span className="gallery-monogram" title={`${letter}: ${n}`}>
      <span className="gallery-monogram-l">{letter}</span>
      <span className="gallery-monogram-n">{n}</span>
    </span>
  );
}

/**
 * Preview drawer — lightweight detail overlay. Doesn't replace the full
 * `TemplatesPage` detail view; it's a quick confirm step before the caller
 * invokes `onPick(slug, kind)` which owns the actual spawn flow.
 */
function PreviewDrawer({
  cell,
  onClose,
  onStart,
}: {
  cell: Cell;
  onClose: () => void;
  onStart: () => void;
}) {
  return (
    <div className="gallery-preview" role="dialog" aria-modal="true" aria-label={cell.name}>
      <div className="gallery-preview-backdrop" onClick={onClose} />
      <div className="gallery-preview-panel">
        <header className="gallery-preview-head">
          <span className="gallery-preview-eyebrow">
            {cell.kind === "company" ? "Company template" : "Identity"}
          </span>
          <h2 className="gallery-preview-name">{cell.name}</h2>
          {cell.tagline && <p className="gallery-preview-tagline">{cell.tagline}</p>}
        </header>
        {cell.description && <p className="gallery-preview-desc">{cell.description}</p>}
        {cell.kind === "company" && <MonogramRow counts={cell.counts} kind={cell.kind} />}
        <footer className="gallery-preview-actions">
          <button type="button" className="gallery-preview-cancel" onClick={onClose}>
            Close
            <kbd className="gallery-kbd">Esc</kbd>
          </button>
          <button type="button" className="gallery-preview-start" onClick={onStart} autoFocus>
            {cell.kind === "company" ? "Start this company" : "Spawn agent"}
            <kbd className="gallery-kbd">↵</kbd>
          </button>
        </footer>
      </div>
    </div>
  );
}
