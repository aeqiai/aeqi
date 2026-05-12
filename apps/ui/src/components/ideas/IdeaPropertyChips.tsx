import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { setIdeaProperties } from "@/api/ideas";
import { ideaKeys } from "@/queries/keys";
import { Button, Modal, Input, Select } from "../ui";

/**
 * Tables-in-Ideas Phase 2.1 — Property chips on Idea detail header.
 *
 * Renders the Idea's `properties` JSON as a row of `key: value` chips
 * sitting above the BlockEditor body. Click a chip to edit its value
 * inline (text input that saves on blur or Enter). Known enum keys
 * (status: todo/in_progress/done) get a dropdown; everything else is
 * free-text. "+ Add property" opens a small modal for key+value entry.
 *
 * Writes deep-merge into `properties` via PUT /ideas/:id/properties.
 * Explicit `null` removes a key (used by the X button on each chip).
 */
export interface IdeaPropertyChipsProps {
  ideaId: string;
  properties: Record<string, unknown> | null | undefined;
}

const STATUS_KEY = "status";
const STATUS_OPTIONS = ["todo", "in_progress", "done"] as const;
const STATUS_SELECT_OPTIONS = STATUS_OPTIONS.map((value) => ({ value, label: value }));

function chipValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

export default function IdeaPropertyChips({ ideaId, properties }: IdeaPropertyChipsProps) {
  const queryClient = useQueryClient();
  const props = (properties ?? {}) as Record<string, unknown>;
  const entries = Object.entries(props);

  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [draftValue, setDraftValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const selectRef = useRef<HTMLSelectElement>(null);

  // Focus input when entering edit mode.
  useEffect(() => {
    if (editingKey === null) return;
    const id = requestAnimationFrame(() => {
      if (editingKey === STATUS_KEY) selectRef.current?.focus();
      else inputRef.current?.focus();
    });
    return () => cancelAnimationFrame(id);
  }, [editingKey]);

  async function persist(patch: Record<string, unknown>) {
    setSaving(true);
    setError(null);
    try {
      await setIdeaProperties(ideaId, patch);
      await queryClient.invalidateQueries({ queryKey: ideaKeys.all });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function commitEdit(key: string, raw: string) {
    setEditingKey(null);
    const trimmed = raw.trim();
    const current = props[key];
    if (chipValue(current) === trimmed) return;
    await persist({ [key]: trimmed === "" ? null : trimmed });
  }

  async function removeKey(key: string) {
    await persist({ [key]: null });
  }

  function startEdit(key: string) {
    setDraftValue(chipValue(props[key]));
    setEditingKey(key);
  }

  return (
    <div className="idea-properties" role="group" aria-label="Idea properties">
      {entries.map(([key, value]) => {
        const editing = editingKey === key;
        const display = chipValue(value);
        if (editing && key === STATUS_KEY) {
          const statusOptions =
            STATUS_OPTIONS.includes(draftValue as (typeof STATUS_OPTIONS)[number]) ||
            draftValue === ""
              ? STATUS_SELECT_OPTIONS
              : [...STATUS_SELECT_OPTIONS, { value: draftValue, label: draftValue }];

          return (
            <span className="idea-property-chip is-editing" key={key}>
              <span className="idea-property-chip-key">{key}</span>
              <Select
                ref={selectRef}
                className="idea-property-chip-select"
                size="sm"
                options={statusOptions}
                value={draftValue}
                disabled={saving}
                onChange={setDraftValue}
                onBlur={(e) => commitEdit(key, e.currentTarget.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    e.preventDefault();
                    setEditingKey(null);
                  } else if (e.key === "Enter") {
                    e.preventDefault();
                    commitEdit(key, e.currentTarget.value);
                  }
                }}
              />
            </span>
          );
        }
        if (editing) {
          return (
            <span className="idea-property-chip is-editing" key={key}>
              <span className="idea-property-chip-key">{key}</span>
              <input
                ref={inputRef}
                className="idea-property-chip-input"
                type="text"
                value={draftValue}
                disabled={saving}
                onChange={(e) => setDraftValue(e.target.value)}
                onBlur={() => commitEdit(key, draftValue)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    e.preventDefault();
                    setEditingKey(null);
                  } else if (e.key === "Enter") {
                    e.preventDefault();
                    commitEdit(key, draftValue);
                  }
                }}
              />
            </span>
          );
        }
        return (
          <button
            type="button"
            className="idea-property-chip"
            key={key}
            onClick={() => startEdit(key)}
            title={`Edit ${key}`}
          >
            <span className="idea-property-chip-key">{key}</span>
            <span className="idea-property-chip-sep">:</span>
            <span className="idea-property-chip-val">{display || "—"}</span>
            <span
              className="idea-property-chip-remove"
              role="button"
              tabIndex={-1}
              aria-label={`Remove ${key}`}
              onClick={(e) => {
                e.stopPropagation();
                void removeKey(key);
              }}
            >
              <svg
                width="9"
                height="9"
                viewBox="0 0 13 13"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinecap="round"
                aria-hidden
              >
                <path d="M3.2 3.2 L9.8 9.8 M9.8 3.2 L3.2 9.8" />
              </svg>
            </span>
          </button>
        );
      })}
      <button
        type="button"
        className="idea-property-add"
        onClick={() => setShowAdd(true)}
        disabled={saving}
      >
        + Add property
      </button>
      {error && <span className="idea-properties-error">{error}</span>}
      {showAdd && (
        <AddPropertyModal
          existingKeys={Object.keys(props)}
          onClose={() => setShowAdd(false)}
          onSave={async (key, value) => {
            await persist({ [key]: value });
            setShowAdd(false);
          }}
        />
      )}
    </div>
  );
}

interface AddPropertyModalProps {
  existingKeys: string[];
  onClose: () => void;
  onSave: (key: string, value: string) => Promise<void>;
}

function AddPropertyModal({ existingKeys, onClose, onSave }: AddPropertyModalProps) {
  const [key, setKey] = useState("");
  const [value, setValue] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const k = key.trim();
    if (!k) {
      setError("Key required");
      return;
    }
    if (existingKeys.includes(k)) {
      setError(`Property "${k}" already exists`);
      return;
    }
    setSubmitting(true);
    try {
      await onSave(k, value.trim());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
      setSubmitting(false);
    }
  }

  return (
    <Modal open onClose={onClose} title="Add property">
      <form onSubmit={handleSubmit} className="idea-property-add-form">
        <Input
          label="Key"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder="e.g. priority"
          autoFocus
          required
        />
        <Input
          label="Value"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="e.g. high"
        />
        {error && <span className="idea-property-add-error">{error}</span>}
        <div className="idea-property-add-actions">
          <Button type="button" variant="secondary" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" size="sm" loading={submitting}>
            Add
          </Button>
        </div>
      </form>
    </Modal>
  );
}
