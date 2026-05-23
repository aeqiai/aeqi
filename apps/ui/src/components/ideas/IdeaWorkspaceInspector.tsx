import type { ReactNode } from "react";
import { MoreHorizontal, Save, Trash2, X } from "lucide-react";
import { blockTreeToPlainText } from "@/components/editor/blockEditorContent";
import IdeaLinksPanel from "@/components/IdeaLinksPanel";
import TagsEditor from "@/components/TagsEditor";
import { formatDateTime } from "@/lib/i18n";
import type { Idea, ScopeValue } from "@/lib/types";
import { Button, Icon, IconButton, Menu } from "../ui";
import IdeaPropertyChips from "./IdeaPropertyChips";
import { SCOPE_HINT, SCOPE_LABEL, SCOPE_PICKER_VALUES, relativeTime } from "./types";

export interface IdeaWorkspaceInspectorProps {
  idea?: Idea;
  agentId: string;
  composing: boolean;
  childCount: number;
  scope: ScopeValue;
  tagSuggestions: string[];
  dirty: boolean;
  canCommit: boolean;
  busy: boolean;
  error: string | null;
  canTrack: boolean;
  canDelete: boolean;
  scopeLocked?: boolean;
  importMenu: ReactNode;
  onScopeChange: (scope: ScopeValue) => void;
  onTagAdd: (tag: string) => void;
  onTagRemove: (tag: string) => void;
  onTrackAsQuest: () => void;
  onDelete: () => void;
  onSave: () => void;
  onCancel: () => void;
}

export default function IdeaWorkspaceInspector({
  idea,
  agentId,
  composing,
  childCount,
  scope,
  tagSuggestions,
  dirty,
  canCommit,
  busy,
  error,
  canTrack,
  canDelete,
  scopeLocked = false,
  importMenu,
  onScopeChange,
  onTagAdd,
  onTagRemove,
  onTrackAsQuest,
  onDelete,
  onSave,
  onCancel,
}: IdeaWorkspaceInspectorProps) {
  const words = idea
    ? blockTreeToPlainText(idea.content).trim().split(/\s+/).filter(Boolean).length
    : 0;
  const updated = idea ? relativeTime(idea.created_at) : "";
  const showSaveRow = composing || dirty;
  const hasProperties = idea && Object.keys(idea.properties ?? {}).length > 0;
  const scopeOptions = scopeLocked
    ? [scope]
    : Array.from(new Set<ScopeValue>([scope, ...SCOPE_PICKER_VALUES]));
  const showPrimaryRow = !idea || canTrack || canDelete;
  return (
    <>
      <div className="ideas-workspace-inspector-head">
        <span>{composing ? "New idea" : "Details"}</span>
        {idea ? (
          <small title={idea.created_at ? formatDateTime(idea.created_at) : undefined}>
            {updated || "now"}
          </small>
        ) : (
          <small>draft</small>
        )}
      </div>
      {showPrimaryRow && (
        <div className="ideas-workspace-inspector-primary">
          {idea && canTrack ? (
            <Button
              variant="secondary"
              size="sm"
              onClick={onTrackAsQuest}
              className="ideas-workspace-track-btn"
            >
              Track as quest
            </Button>
          ) : !idea ? (
            <span className="ideas-workspace-draft-note">Save to attach tags and references.</span>
          ) : (
            <span aria-hidden />
          )}
          {idea && canDelete && (
            <Menu
              placement="bottom-end"
              trigger={
                <IconButton aria-label="Idea actions" size="sm" variant="ghost">
                  <Icon icon={MoreHorizontal} size="sm" />
                </IconButton>
              }
              items={[
                {
                  key: "delete",
                  label: "Delete",
                  confirmLabel: "Confirm delete",
                  destructive: true,
                  disabled: !canDelete || busy,
                  icon: <Icon icon={Trash2} size="sm" />,
                  onSelect: onDelete,
                },
              ]}
            />
          )}
        </div>
      )}
      {showSaveRow && (
        <div className="ideas-workspace-save-row">
          <Button
            variant="secondary"
            size="sm"
            onClick={onCancel}
            disabled={busy}
            leadingIcon={<Icon icon={X} size="sm" />}
          >
            Cancel
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={onSave}
            disabled={busy || !canCommit}
            loading={busy}
            leadingIcon={<Icon icon={Save} size="sm" />}
          >
            Save
          </Button>
        </div>
      )}
      {error && (
        <div className="bp-error ideas-workspace-inspector-error" role="alert">
          {error}
        </div>
      )}
      <div className="quest-detail-context ideas-workspace-section ideas-workspace-scope">
        <h2>Scope</h2>
        <div className="ideas-workspace-scope-options" role="radiogroup" aria-label="Idea scope">
          {scopeOptions.map((value) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={scope === value}
              title={SCOPE_HINT[value]}
              className={`ideas-workspace-scope-option${scope === value ? " active" : ""}`}
              disabled={scopeLocked}
              onClick={() => onScopeChange(value)}
            >
              <span className={`scope-dot scope-dot--${value}`} aria-hidden />
              <span>{SCOPE_LABEL[value]}</span>
            </button>
          ))}
        </div>
      </div>
      <dl className="quest-detail-meta ideas-workspace-meta">
        <div className="quest-detail-meta-row">
          <dt>children</dt>
          <dd>{childCount}</dd>
        </div>
        <div className="quest-detail-meta-row">
          <dt>words</dt>
          <dd>{words}</dd>
        </div>
        <div className="quest-detail-meta-row">
          <dt>kind</dt>
          <dd>{idea?.kind ?? "note"}</dd>
        </div>
      </dl>
      {hasProperties && (
        <div className="quest-detail-context ideas-workspace-section ideas-workspace-properties">
          <h2>Properties</h2>
          <IdeaPropertyChips ideaId={idea.id} properties={idea.properties} />
        </div>
      )}
      <div className="quest-detail-context ideas-workspace-section ideas-workspace-tags">
        <h2>Tags</h2>
        {idea ? (
          <TagsEditor
            tags={idea.tags ?? []}
            typed={idea.tags ?? []}
            suggestions={tagSuggestions}
            onAdd={onTagAdd}
            onRemove={onTagRemove}
          />
        ) : (
          <p>Available after the idea is saved.</p>
        )}
      </div>
      <div className="quest-detail-context ideas-workspace-section ideas-workspace-refs">
        <h2>References</h2>
        {idea ? (
          <IdeaLinksPanel ideaId={idea.id} agentId={agentId} />
        ) : (
          <p>Available after save.</p>
        )}
      </div>
      <div className="quest-detail-context ideas-workspace-section ideas-workspace-import">
        <h2>Import</h2>
        {importMenu}
      </div>
    </>
  );
}
