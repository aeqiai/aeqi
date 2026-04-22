import { useEffect, useMemo, useState } from "react";
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
}

const TIER_ORDER: Tier[] = ["free", "cheap", "balanced", "premium"];

const TIER_LABELS: Record<Tier, { label: string; sublabel: string }> = {
  free: { label: "Free", sublabel: "no cost" },
  cheap: { label: "Cheap", sublabel: "under $1 / Mtok" },
  balanced: { label: "Balanced", sublabel: "$1–$5 / Mtok" },
  premium: { label: "Premium", sublabel: "frontier — use sparingly" },
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

/**
 * Provider-agnostic model picker. Renders the catalog grouped by tier with a
 * "Custom…" escape-hatch for arbitrary slugs. The slug written to the agent is
 * the canonical `{family}/{model-id}` string the backend pricing table already
 * understands. Which provider crate actually handles the call (Anthropic
 * direct, OpenRouter, Ollama, future own-inference) is the orchestrator's
 * concern — this component never cares about transport.
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
  const [customOpen, setCustomOpen] = useState(false);
  const [customDraft, setCustomDraft] = useState("");

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

  const grouped = useMemo(() => {
    if (!models) return null;
    const map = new Map<Tier, ModelEntry[]>();
    for (const t of TIER_ORDER) map.set(t, []);
    for (const m of models) map.get(m.tier)?.push(m);
    return map;
  }, [models]);

  const knownIds = useMemo(() => new Set(models?.map((m) => m.id) ?? []), [models]);
  const isCustom = value.length > 0 && models !== null && !knownIds.has(value);

  // When the current value isn't in the catalog, open the custom row so the
  // user can see + edit the raw slug without any hidden state.
  useEffect(() => {
    if (isCustom) {
      setCustomOpen(true);
      setCustomDraft(value);
    }
  }, [isCustom, value]);

  if (loadError) {
    return (
      <div className="model-picker-error">
        {loadError}
        <input
          className="agent-settings-input"
          type="text"
          defaultValue={value}
          placeholder="e.g. anthropic/claude-sonnet-4-6"
          disabled={disabled}
          onBlur={(e) => {
            const v = e.target.value.trim();
            if (v !== value) onChange(v);
          }}
        />
      </div>
    );
  }

  if (!grouped) {
    return (
      <div className="model-picker-loading">
        <Spinner size="sm" /> Loading catalog…
      </div>
    );
  }

  return (
    <div className="model-picker" role="radiogroup" aria-label="Model">
      {TIER_ORDER.map((tier) => {
        const rows = grouped.get(tier) ?? [];
        if (rows.length === 0) return null;
        const { label, sublabel } = TIER_LABELS[tier];
        return (
          <section key={tier} className={`model-picker-group model-picker-group--${tier}`}>
            <header className="model-picker-group-head">
              <span className="model-picker-group-label">{label}</span>
              <span className="model-picker-group-sub">{sublabel}</span>
            </header>
            <div className="model-picker-rows">
              {rows.map((m) => {
                const checked = m.id === value;
                return (
                  <label key={m.id} className={`model-picker-row${checked ? " is-checked" : ""}`}>
                    <input
                      type="radio"
                      name="agent-model"
                      value={m.id}
                      checked={checked}
                      disabled={disabled}
                      onChange={() => onChange(m.id)}
                    />
                    <span className="model-picker-row-body">
                      <span className="model-picker-row-top">
                        <span className="model-picker-row-name">{m.display_name}</span>
                        <span className="model-picker-row-slug">{m.id}</span>
                      </span>
                      <span className="model-picker-row-bottom">
                        <span className="model-picker-row-notes">{m.notes}</span>
                        <span className="model-picker-row-stats">
                          <span>{formatContext(m.context_window)} ctx</span>
                          <span aria-hidden="true">·</span>
                          <span>
                            in {formatPrice(m.price_in)} / out {formatPrice(m.price_out)}
                          </span>
                        </span>
                      </span>
                    </span>
                  </label>
                );
              })}
            </div>
          </section>
        );
      })}

      <section className="model-picker-group model-picker-group--custom">
        <button
          type="button"
          className="model-picker-custom-toggle"
          onClick={() => setCustomOpen((v) => !v)}
          aria-expanded={customOpen}
        >
          <span className="model-picker-custom-toggle-label">
            Custom slug{isCustom ? " · active" : ""}
          </span>
          <span className="model-picker-custom-toggle-hint">
            Any provider/model-id string the runtime can resolve
          </span>
        </button>
        {customOpen && (
          <div className="model-picker-custom-body">
            <input
              className="model-picker-custom-input"
              type="text"
              value={customDraft}
              placeholder="e.g. openrouter/auto, qwen/qwen3-coder, ollama/mistral"
              spellCheck={false}
              autoComplete="off"
              disabled={disabled}
              onChange={(e) => setCustomDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              }}
              onBlur={() => {
                const v = customDraft.trim();
                if (v && v !== value) onChange(v);
              }}
            />
            <p className="model-picker-custom-note">
              Slug format: <code>family/model-id</code>. The orchestrator picks the provider backend
              based on which keys are configured.
            </p>
          </div>
        )}
      </section>
    </div>
  );
}
