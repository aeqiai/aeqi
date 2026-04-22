import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/api";
import { Spinner } from "./ui";

type Tier = "free" | "cheap" | "balanced" | "premium";

interface ModelEntry {
  id: string;
  display_name: string;
  family: string;
  tier: Tier;
  context_window: number;
  price_in: number;
  price_out: number;
  notes: string;
  recommended: boolean;
  tags: string[];
}

const TIER_ORDER: Tier[] = ["free", "cheap", "balanced", "premium"];

const TIER_LABELS: Record<Tier, { label: string; sublabel: string }> = {
  free: { label: "Free", sublabel: "no cost" },
  cheap: { label: "Cheap", sublabel: "under $1 / Mtok" },
  balanced: { label: "Balanced", sublabel: "$1–$5 / Mtok" },
  premium: { label: "Premium", sublabel: "frontier" },
};

function formatContext(n: number): string {
  if (n >= 1_000_000) return `${Math.round(n / 1_000_000)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}K`;
  return String(n);
}

function formatPrice(p: number): string {
  if (p === 0) return "free";
  if (p < 1) return `$${p.toFixed(2)}`;
  return `$${p.toFixed(p >= 10 ? 0 : 1)}`;
}

function priceLabel(m: Pick<ModelEntry, "price_in" | "price_out">): string {
  if (m.price_in === 0 && m.price_out === 0) return "free";
  return `${formatPrice(m.price_in)}/${formatPrice(m.price_out)}`;
}

/**
 * Provider-agnostic model picker. Single-row trigger opens a searchable
 * combobox of the catalog. The slug written to the agent is the canonical
 * `{family}/{model-id}` string; the orchestrator picks the transport.
 */
export default function ModelPicker({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (slug: string) => void | Promise<void>;
  disabled?: boolean;
}) {
  const [models, setModels] = useState<ModelEntry[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const [customDraft, setCustomDraft] = useState("");

  const rootRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const rowRefs = useRef<Map<string, HTMLButtonElement>>(new Map());

  useEffect(() => {
    let cancelled = false;
    api
      .getModels()
      .then((res) => {
        if (cancelled) return;
        if (res.ok) setModels(res.models);
        else setLoadError("Couldn’t load the model catalog");
      })
      .catch((err) => {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : "Failed to load models");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const current = useMemo(() => models?.find((m) => m.id === value) ?? null, [models, value]);
  const isCustom = value.length > 0 && models !== null && !current;

  const filteredByTier = useMemo(() => {
    if (!models) return null;
    const q = query.trim().toLowerCase();
    const hit = (m: ModelEntry) =>
      !q ||
      m.id.toLowerCase().includes(q) ||
      m.display_name.toLowerCase().includes(q) ||
      m.family.toLowerCase().includes(q) ||
      m.notes.toLowerCase().includes(q) ||
      m.tags.some((t) => t.toLowerCase().includes(q));

    const map = new Map<Tier, ModelEntry[]>();
    for (const t of TIER_ORDER) map.set(t, []);
    for (const m of models) if (hit(m)) map.get(m.tier)?.push(m);
    // Recommended first within each tier.
    for (const t of TIER_ORDER) {
      const arr = map.get(t)!;
      arr.sort((a, b) => Number(b.recommended) - Number(a.recommended));
    }
    return map;
  }, [models, query]);

  const flatVisible = useMemo(() => {
    if (!filteredByTier) return [] as ModelEntry[];
    return TIER_ORDER.flatMap((t) => filteredByTier.get(t) ?? []);
  }, [filteredByTier]);

  // Keep cursor in range when the visible list changes.
  useEffect(() => {
    if (cursor >= flatVisible.length) setCursor(Math.max(0, flatVisible.length - 1));
  }, [flatVisible.length, cursor]);

  const openPicker = useCallback(() => {
    if (disabled) return;
    setOpen(true);
    setQuery("");
    // Start cursor on the current value, or first recommended, or 0.
    const idx = flatVisibleIndexFor(models, value);
    setCursor(idx);
    setCustomDraft(isCustom ? value : "");
    // focus search after the popover mounts
    requestAnimationFrame(() => searchRef.current?.focus());
  }, [disabled, models, value, isCustom]);

  const closePicker = useCallback(() => {
    setOpen(false);
    setQuery("");
  }, []);

  const commit = useCallback(
    async (slug: string) => {
      closePicker();
      if (slug && slug !== value) await onChange(slug);
    },
    [closePicker, onChange, value],
  );

  // Outside click closes the popover.
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (!rootRef.current) return;
      if (!rootRef.current.contains(e.target as Node)) closePicker();
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open, closePicker]);

  // Scroll highlighted row into view.
  useEffect(() => {
    if (!open) return;
    const row = flatVisible[cursor];
    if (!row) return;
    const el = rowRefs.current.get(row.id);
    el?.scrollIntoView({ block: "nearest" });
  }, [cursor, flatVisible, open]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setCursor((c) => Math.min(flatVisible.length - 1, c + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setCursor((c) => Math.max(0, c - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const pick = flatVisible[cursor];
      if (pick) void commit(pick.id);
    } else if (e.key === "Escape") {
      e.preventDefault();
      closePicker();
    }
  };

  if (loadError) {
    return (
      <div className="mp-error">
        <span className="mp-error-msg">{loadError}</span>
        <input
          className="mp-error-input"
          type="text"
          defaultValue={value}
          placeholder="e.g. anthropic/claude-sonnet-4.6"
          spellCheck={false}
          autoComplete="off"
          disabled={disabled}
          onBlur={(e) => {
            const v = e.target.value.trim();
            if (v && v !== value) void onChange(v);
          }}
        />
      </div>
    );
  }

  if (!models) {
    return (
      <div className="mp-loading">
        <Spinner size="sm" />
        <span>Loading catalog…</span>
      </div>
    );
  }

  return (
    <div ref={rootRef} className={`mp${open ? " mp--open" : ""}${disabled ? " mp--disabled" : ""}`}>
      <button
        type="button"
        className="mp-trigger"
        onClick={() => (open ? closePicker() : openPicker())}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="mp-trigger-main">
          <span className="mp-trigger-name">
            {current?.display_name ?? (isCustom ? "Custom slug" : "Choose a model")}
          </span>
          <span className="mp-trigger-slug">{value || "—"}</span>
        </span>
        <span className="mp-trigger-meta">
          {current && (
            <>
              <span className="mp-tier-pill" data-tier={current.tier}>
                {TIER_LABELS[current.tier].label}
              </span>
              <span className="mp-trigger-stats">
                {formatContext(current.context_window)} · {priceLabel(current)}
              </span>
            </>
          )}
          {!current && isCustom && (
            <span className="mp-tier-pill mp-tier-pill--custom">Custom</span>
          )}
          <svg className="mp-chevron" width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
            <path
              d="M3 4.5 L6 7.5 L9 4.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
      </button>

      {open && (
        <div className="mp-popover" role="listbox" aria-label="Model catalog" onKeyDown={onKeyDown}>
          <div className="mp-search">
            <svg
              className="mp-search-icon"
              width="12"
              height="12"
              viewBox="0 0 12 12"
              aria-hidden="true"
            >
              <circle cx="5" cy="5" r="3.5" fill="none" stroke="currentColor" strokeWidth="1.2" />
              <path
                d="M7.6 7.6 L10 10"
                stroke="currentColor"
                strokeWidth="1.2"
                strokeLinecap="round"
              />
            </svg>
            <input
              ref={searchRef}
              className="mp-search-input"
              type="text"
              value={query}
              placeholder="Search models — name, family, tag"
              spellCheck={false}
              autoComplete="off"
              onChange={(e) => {
                setQuery(e.target.value);
                setCursor(0);
              }}
              onKeyDown={onKeyDown}
            />
            <span className="mp-search-hint">
              <kbd>↑↓</kbd> move · <kbd>↵</kbd> select · <kbd>esc</kbd> close
            </span>
          </div>

          <div className="mp-list">
            {flatVisible.length === 0 && (
              <div className="mp-empty">
                No models match <em>{query}</em>. Try a family like <code>deepseek</code> or a tag
                like <code>code</code>.
              </div>
            )}
            {TIER_ORDER.map((tier) => {
              const rows = filteredByTier?.get(tier) ?? [];
              if (rows.length === 0) return null;
              const { label, sublabel } = TIER_LABELS[tier];
              return (
                <div key={tier} className="mp-group">
                  <div className="mp-group-head">
                    <span className="mp-group-label" data-tier={tier}>
                      {label}
                    </span>
                    <span className="mp-group-sub">{sublabel}</span>
                    <span className="mp-group-count">
                      {rows.length} {rows.length === 1 ? "model" : "models"}
                    </span>
                  </div>
                  {rows.map((m) => {
                    const active = flatVisible[cursor]?.id === m.id;
                    const selected = m.id === value;
                    return (
                      <button
                        key={m.id}
                        ref={(el) => {
                          if (el) rowRefs.current.set(m.id, el);
                          else rowRefs.current.delete(m.id);
                        }}
                        type="button"
                        role="option"
                        aria-selected={selected}
                        className={`mp-row${active ? " mp-row--active" : ""}${selected ? " mp-row--selected" : ""}`}
                        onMouseEnter={() => {
                          const idx = flatVisible.findIndex((x) => x.id === m.id);
                          if (idx >= 0) setCursor(idx);
                        }}
                        onClick={() => void commit(m.id)}
                      >
                        <span className="mp-row-star" aria-hidden="true">
                          {m.recommended ? "★" : selected ? "●" : ""}
                        </span>
                        <span className="mp-row-body">
                          <span className="mp-row-top">
                            <span className="mp-row-name">{m.display_name}</span>
                            <span className="mp-row-stats">
                              <span>{formatContext(m.context_window)}</span>
                              <span aria-hidden="true">·</span>
                              <span>{priceLabel(m)}</span>
                            </span>
                          </span>
                          <span className="mp-row-mid">
                            <span className="mp-row-slug">{m.id}</span>
                            {m.tags.length > 0 && (
                              <span className="mp-row-tags">
                                {m.tags.map((t) => (
                                  <span key={t} className="mp-row-tag">
                                    {t}
                                  </span>
                                ))}
                              </span>
                            )}
                          </span>
                          <span className="mp-row-notes">{m.notes}</span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              );
            })}
          </div>

          <div className="mp-custom">
            <label className="mp-custom-label">
              <span>Custom slug</span>
              <span className="mp-custom-hint">
                any <code>family/model-id</code> the runtime can resolve
              </span>
            </label>
            <div className="mp-custom-row">
              <input
                className="mp-custom-input"
                type="text"
                value={customDraft}
                placeholder="openrouter/auto, qwen/qwen3-coder, ollama/mistral…"
                spellCheck={false}
                autoComplete="off"
                onChange={(e) => setCustomDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    const v = customDraft.trim();
                    if (v) void commit(v);
                  } else if (e.key === "Escape") {
                    e.preventDefault();
                    closePicker();
                  }
                }}
              />
              <button
                type="button"
                className="mp-custom-apply"
                disabled={!customDraft.trim() || customDraft.trim() === value}
                onClick={() => {
                  const v = customDraft.trim();
                  if (v) void commit(v);
                }}
              >
                Use
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function flatVisibleIndexFor(models: ModelEntry[] | null, value: string): number {
  if (!models) return 0;
  const ordered = TIER_ORDER.flatMap((t) =>
    models
      .filter((m) => m.tier === t)
      .sort((a, b) => Number(b.recommended) - Number(a.recommended)),
  );
  const idx = ordered.findIndex((m) => m.id === value);
  return idx >= 0 ? idx : 0;
}
