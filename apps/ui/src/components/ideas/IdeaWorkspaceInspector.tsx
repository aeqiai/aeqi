import { MoreHorizontal, Save, Trash2, X } from "lucide-react";
import type { Idea, ScopeValue } from "@/lib/types";
import { Button, Icon, IconButton, Menu } from "../ui";
import { PropertyGroup } from "../roles/RoleInspectorPrimitives";
import "@/styles/roles.css";
import IdeaInspectorGroup from "./IdeaInspectorGroup";
import IdeaPropertyChips from "./IdeaPropertyChips";

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
  hideHeader?: boolean;
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
  hideHeader = false,
  onScopeChange,
  onTagAdd,
  onTagRemove,
  onTrackAsQuest,
  onDelete,
  onSave,
  onCancel,
}: IdeaWorkspaceInspectorProps) {
  const showSaveRow = composing || dirty;
  const hasProperties = idea && Object.keys(idea.properties ?? {}).length > 0;
  const showPrimaryRow = !idea || canTrack || canDelete;

  return (
    <div className="role-inspector role-inspector--page ideas-workspace-detail-inspector">
      {!hideHeader && (
        <header className="role-inspector-topbar ideas-workspace-detail-topbar">
          <span className="role-inspector-object ideas-workspace-detail-object">
            {composing ? "New idea" : "Details"}
          </span>
        </header>
      )}

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

        <IdeaInspectorGroup
          idea={idea}
          agentId={agentId}
          scope={scope}
          typeLabel={idea?.kind ?? "note"}
          tagSuggestions={tagSuggestions}
          childCount={idea ? childCount : undefined}
          scopeLocked={scopeLocked}
          emptyStatus="Save to attach tags and references."
          onScopeChange={onScopeChange}
          onTagAdd={onTagAdd}
          onTagRemove={onTagRemove}
        />

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
      </div>
    </div>
  );
}
