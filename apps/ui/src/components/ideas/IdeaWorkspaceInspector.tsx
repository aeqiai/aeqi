import { MoreHorizontal, Save, Trash2, X } from "lucide-react";
import { blockTreeToPlainText } from "@/components/editor/blockEditorContent";
import IdeaLinksPanel from "@/components/IdeaLinksPanel";
import TagsEditor from "@/components/TagsEditor";
import { formatDateTime } from "@/lib/i18n";
import type { Idea, ScopeValue } from "@/lib/types";
import {
  Button,
  Icon,
  IconButton,
  InspectorPanel,
  InspectorRow,
  InspectorSection,
  Menu,
} from "../ui";
import IdeaPropertyChips from "./IdeaPropertyChips";
import { SCOPE_HINT, SCOPE_LABEL, SCOPE_PICKER_VALUES, relativeTime } from "./types";

export interface IdeaWorkspaceInspectorProps {
  idea?: Idea;
  agentId: string;
  scopedEntity?: string | null;
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
  onScopeChange: (scope: ScopeValue) => void;
  onTagAdd: (tag: string) => void;
  onTagRemove: (tag: string) => void;
  onTrackAsQuest: () => void;
  onDelete: () => void;
  onSave: () => void;
  onCancel: () => void;
}

function compactIdeaId(id: string): string {
  if (id.length <= 13) return id;
  return `${id.slice(0, 6)}...${id.slice(-4)}`;
}

export default function IdeaWorkspaceInspector({
  idea,
  agentId,
  scopedEntity,
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
    <InspectorPanel
      className="ideas-workspace-detail-inspector"
      ariaLabel="Idea metadata"
      surface="embedded"
    >
      <header className="ideas-workspace-detail-topbar">
        <span className="ideas-workspace-detail-object">{composing ? "New idea" : "Details"}</span>
        <span
          className="ideas-workspace-detail-meta"
          title={idea?.created_at ? formatDateTime(idea.created_at) : undefined}
        >
          {idea ? updated || "now" : "draft"}
        </span>
      </header>

      <div className="ideas-workspace-detail-body">
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
              <span className="ideas-workspace-draft-note">
                Save to attach tags and references.
              </span>
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

        <InspectorSection
          title="Idea"
          collapsible
          defaultOpen
          className="ideas-workspace-idea-section"
        >
          {scopeLocked ? (
            <InspectorRow label="Scope" tone="raised" className="ideas-workspace-readonly-row">
              {SCOPE_LABEL[scope]}
            </InspectorRow>
          ) : (
            <InspectorRow label="Scope" tone="plain" className="ideas-workspace-inspector-row">
              <div
                className="ideas-workspace-scope-options"
                role="radiogroup"
                aria-label="Idea visibility"
              >
                {scopeOptions.map((value) => (
                  <button
                    key={value}
                    type="button"
                    role="radio"
                    aria-checked={scope === value}
                    title={SCOPE_HINT[value]}
                    className={`ideas-workspace-scope-option${scope === value ? " active" : ""}`}
                    onClick={() => onScopeChange(value)}
                  >
                    <span className={`scope-dot scope-dot--${value}`} aria-hidden />
                    <span>{SCOPE_LABEL[value]}</span>
                  </button>
                ))}
              </div>
            </InspectorRow>
          )}
          <InspectorRow label="Type" tone="raised" className="ideas-workspace-readonly-row">
            {idea?.kind ?? "note"}
          </InspectorRow>
          {idea && (
            <InspectorRow
              label="Idea ID"
              tone="raised"
              className="ideas-workspace-readonly-row ideas-workspace-id-row"
            >
              {compactIdeaId(idea.id)}
            </InspectorRow>
          )}
          <div className="ideas-workspace-inspector-stack ideas-workspace-inspector-stack--inline">
            <span className="ideas-workspace-inspector-label">Tags</span>
            <div className="ideas-workspace-inspector-field">
              {idea ? (
                <TagsEditor
                  tags={idea.tags ?? []}
                  typed={idea.tags ?? []}
                  suggestions={tagSuggestions}
                  onAdd={onTagAdd}
                  onRemove={onTagRemove}
                />
              ) : (
                <span className="ideas-workspace-detail-meta">
                  Available after the idea is saved
                </span>
              )}
            </div>
          </div>
          <div className="ideas-workspace-inspector-stack ideas-workspace-inspector-stack--inline">
            <span className="ideas-workspace-inspector-label">References</span>
            <div className="ideas-workspace-inspector-field">
              {idea ? (
                <IdeaLinksPanel ideaId={idea.id} agentId={agentId} />
              ) : (
                <span className="ideas-workspace-detail-meta">Available after save</span>
              )}
            </div>
          </div>
        </InspectorSection>

        {hasProperties && (
          <InspectorSection title="Properties" collapsible defaultOpen={false}>
            <div className="ideas-workspace-inspector-stack">
              <span className="ideas-workspace-inspector-label">Metadata</span>
              <div className="ideas-workspace-inspector-field">
                <IdeaPropertyChips
                  ideaId={idea.id}
                  scopedEntity={scopedEntity}
                  properties={idea.properties}
                />
              </div>
            </div>
          </InspectorSection>
        )}

        <InspectorSection title="Document" collapsible defaultOpen={false}>
          <InspectorRow label="Children" tone="recessed">
            {childCount}
          </InspectorRow>
          <InspectorRow label="Words" tone="recessed">
            {words}
          </InspectorRow>
        </InspectorSection>
      </div>
    </InspectorPanel>
  );
}
