import { useState } from "react";
import { MoreHorizontal, Save, Trash2, X } from "lucide-react";
import { blockTreeToPlainText } from "@/components/editor/blockEditorContent";
import IdeaLinksPanel from "@/components/IdeaLinksPanel";
import TagsEditor from "@/components/TagsEditor";
import type { Idea, ScopeValue } from "@/lib/types";
import { Button, Icon, IconButton, Menu } from "../ui";
import {
  CopyableRow,
  PropertyGroup,
  ReadOnlyRow,
  compactAddress,
} from "../roles/RoleInspectorPrimitives";
import "@/styles/roles.css";
import IdeaPropertyChips from "./IdeaPropertyChips";
import { SCOPE_HINT, SCOPE_LABEL, SCOPE_PICKER_VALUES } from "./types";

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
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const words = idea
    ? blockTreeToPlainText(idea.content).trim().split(/\s+/).filter(Boolean).length
    : 0;
  const showSaveRow = composing || dirty;
  const hasProperties = idea && Object.keys(idea.properties ?? {}).length > 0;
  const scopeOptions = scopeLocked
    ? [scope]
    : Array.from(new Set<ScopeValue>([scope, ...SCOPE_PICKER_VALUES]));
  const showPrimaryRow = !idea || canTrack || canDelete;

  const copyIdeaId = () => {
    if (!idea) return;
    void navigator.clipboard.writeText(idea.id).then(() => {
      setCopiedField("ideaId");
      setTimeout(() => setCopiedField((current) => (current === "ideaId" ? null : current)), 1500);
    });
  };

  return (
    <div className="role-inspector role-inspector--page ideas-workspace-detail-inspector">
      <header className="role-inspector-topbar ideas-workspace-detail-topbar">
        <span className="role-inspector-object ideas-workspace-detail-object">
          {composing ? "New idea" : "Details"}
        </span>
      </header>

      <div className="role-inspector-body ideas-workspace-detail-body">
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

        <PropertyGroup title="Idea" defaultOpen>
          {scopeLocked ? (
            <ReadOnlyRow label="Scope">
              <span className="role-inspector-meta">{SCOPE_LABEL[scope]}</span>
            </ReadOnlyRow>
          ) : (
            <div className="role-inspector-field-block">
              <span className="role-inspector-row-label">Scope</span>
              <div
                className="role-inspector-field-body ideas-workspace-scope-options"
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
            </div>
          )}
          <ReadOnlyRow label="Type">
            <span className="role-inspector-meta">{idea?.kind ?? "note"}</span>
          </ReadOnlyRow>
          {idea && (
            <CopyableRow
              label="Idea ID"
              title={compactAddress(idea.id)}
              copied={copiedField === "ideaId"}
              onCopy={copyIdeaId}
            />
          )}
          <div className="role-inspector-field-block">
            <span className="role-inspector-row-label">Tags</span>
            <div className="role-inspector-field-body">
              {idea ? (
                <TagsEditor
                  tags={idea.tags ?? []}
                  typed={idea.tags ?? []}
                  suggestions={tagSuggestions}
                  onAdd={onTagAdd}
                  onRemove={onTagRemove}
                />
              ) : (
                <span className="role-inspector-meta">Available after the idea is saved</span>
              )}
            </div>
          </div>
          <div className="role-inspector-field-block">
            <span className="role-inspector-row-label">References</span>
            <div className="role-inspector-field-body">
              {idea ? (
                <IdeaLinksPanel ideaId={idea.id} agentId={agentId} />
              ) : (
                <span className="role-inspector-meta">Available after save</span>
              )}
            </div>
          </div>
        </PropertyGroup>

        {hasProperties && (
          <PropertyGroup title="Properties" defaultOpen={false}>
            <div className="role-inspector-field-block role-inspector-field-block--stacked">
              <span className="role-inspector-row-label">Metadata</span>
              <div className="role-inspector-field-body">
                <IdeaPropertyChips
                  ideaId={idea.id}
                  scopedEntity={scopedEntity}
                  properties={idea.properties}
                />
              </div>
            </div>
          </PropertyGroup>
        )}

        <PropertyGroup title="Document" defaultOpen={false}>
          <ReadOnlyRow label="Children">
            <span className="role-inspector-meta">{childCount}</span>
          </ReadOnlyRow>
          <ReadOnlyRow label="Words">
            <span className="role-inspector-meta">{words}</span>
          </ReadOnlyRow>
        </PropertyGroup>
      </div>
    </div>
  );
}
