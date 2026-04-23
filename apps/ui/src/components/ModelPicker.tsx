import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { Combobox, Spinner } from "./ui";
import type { ComboboxOption } from "./ui";

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

/** Build ComboboxOption list: recommended-first within each tier, with tier headers. */
function buildOptions(models: ModelEntry[]): ComboboxOption[] {
  const opts: ComboboxOption[] = [];
  for (const tier of TIER_ORDER) {
    const rows = models
      .filter((m) => m.tier === tier)
      .sort((a, b) => Number(b.recommended) - Number(a.recommended));
    if (rows.length === 0) continue;
    const { label, sublabel } = TIER_LABELS[tier];
    // Tier header as a disabled separator.
    opts.push({
      value: `__tier_${tier}`,
      label: `${label} — ${sublabel}`,
      disabled: true,
      meta: (
        <span className="mp-group-count">
          {rows.length} {rows.length === 1 ? "model" : "models"}
        </span>
      ),
    });
    for (const m of rows) {
      opts.push({
        value: m.id,
        label: m.display_name,
        meta: (
          <span className="mp-row-meta">
            <span className="mp-row-stats">
              {formatContext(m.context_window)} · {priceLabel(m)}
            </span>
            <span className="mp-tier-pill" data-tier={m.tier}>
              {m.recommended ? "★ " : ""}
              {TIER_LABELS[m.tier].label}
            </span>
          </span>
        ),
      });
    }
  }
  return opts;
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
  const [customDraft, setCustomDraft] = useState("");

  useEffect(() => {
    let cancelled = false;
    api
      .getModels()
      .then((res) => {
        if (cancelled) return;
        if (res.ok) setModels(res.models);
        else setLoadError("Couldn't load the model catalog");
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

  const options = useMemo(() => (models ? buildOptions(models) : []), [models]);

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

  const triggerLabel = current?.display_name ?? (isCustom ? "Custom slug" : undefined);
  const triggerSub = value || "—";

  const customSlugFooter = (
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
              if (v && v !== value) void onChange(v);
            }
          }}
        />
        <button
          type="button"
          className="mp-custom-apply"
          disabled={!customDraft.trim() || customDraft.trim() === value}
          onClick={() => {
            const v = customDraft.trim();
            if (v && v !== value) void onChange(v);
          }}
        >
          Use
        </button>
      </div>
    </div>
  );

  return (
    <div className={`mp${disabled ? " mp--disabled" : ""}`}>
      <Combobox
        options={options}
        value={isCustom ? null : value || null}
        onChange={(slug) => void onChange(slug)}
        placeholder={
          triggerLabel ? (
            <span className="mp-trigger-main">
              <span className="mp-trigger-name">{triggerLabel}</span>
              <span className="mp-trigger-slug">{triggerSub}</span>
            </span>
          ) : (
            "Choose a model"
          )
        }
        searchPlaceholder="Search models — name, family, tag"
        emptyLabel="No models match. Try a family name or tier."
        disabled={disabled}
        className="mp-combobox"
        footer={customSlugFooter}
      />
    </div>
  );
}
