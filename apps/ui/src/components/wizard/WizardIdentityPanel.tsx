import { type ChangeEvent } from "react";
import { Input } from "@/components/ui";
import { WizardPanel } from "./WizardPanel";
import styles from "./WizardIdentityPanel.module.css";

export interface IdentityState {
  name: string;
  tagline: string;
  slug: string;
}

interface WizardIdentityPanelProps {
  state: IdentityState;
  onChange: (next: IdentityState) => void;
  expanded: boolean;
  onToggle: () => void;
}

/** Derive a URL slug from a display name: lowercase, replace non-alnum with hyphens. */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Identity panel — name, tagline, slug.
 *
 * Name drives slug auto-derivation until the user edits slug manually.
 * Avatar is deferred to generate-from-name (no file upload in this PR).
 */
export function WizardIdentityPanel({
  state,
  onChange,
  expanded,
  onToggle,
}: WizardIdentityPanelProps) {
  const summary = state.name || "Not set";

  function handleNameChange(e: ChangeEvent<HTMLInputElement>) {
    const name = e.target.value;
    // Auto-derive slug while user hasn't typed a custom slug
    const autoSlug = slugify(name);
    onChange({ ...state, name, slug: autoSlug });
  }

  function handleTaglineChange(e: ChangeEvent<HTMLInputElement>) {
    onChange({ ...state, tagline: e.target.value });
  }

  function handleSlugChange(e: ChangeEvent<HTMLInputElement>) {
    onChange({ ...state, slug: slugify(e.target.value) });
  }

  return (
    <WizardPanel
      id="wizard-identity"
      title="Identity"
      summary={summary}
      expanded={expanded}
      onToggle={onToggle}
    >
      <div className={styles.fields}>
        <Input
          label="Company name"
          value={state.name}
          onChange={handleNameChange}
          placeholder="e.g. Atlas Studio"
          autoFocus
        />
        <Input
          label="Tagline"
          value={state.tagline}
          onChange={handleTaglineChange}
          placeholder="One line — what it does."
        />
        <div>
          <Input
            label="Slug"
            value={state.slug}
            onChange={handleSlugChange}
            placeholder="atlas-studio"
            hint={`app.aeqi.ai/c/${state.slug || "your-slug"}`}
          />
        </div>
        <div className={styles.avatarNote}>Avatar — generated from name at create time.</div>
      </div>
    </WizardPanel>
  );
}
