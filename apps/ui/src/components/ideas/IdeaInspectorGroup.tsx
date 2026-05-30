import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import IdeaLinksPanel from "@/components/IdeaLinksPanel";
import TagsEditor from "@/components/TagsEditor";
import { blockTreeToPlainText } from "@/components/editor/blockEditorContent";
import type { Idea, ScopeValue } from "@/lib/types";
import {
  CopyableRow,
  PropertyGroup,
  ReadOnlyRow,
  compactAddress,
} from "../roles/RoleInspectorPrimitives";
import IdeasScopePopover from "./IdeasScopePopover";
import { SCOPE_LABEL } from "./types";

interface IdeaInspectorGroupProps {
  idea?: Idea | null;
  agentId: string;
  scope: ScopeValue;
  typeLabel: string;
  tagSuggestions: string[];
  tagError?: string | null;
  childCount?: number;
  scopeLocked?: boolean;
  emptyStatus?: string;
  onScopeChange?: (scope: ScopeValue) => void;
  onTagAdd: (tag: string) => void;
  onTagRemove: (tag: string) => void;
}

function EditableControlRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="role-inspector-row idea-inspector-control-row">
      <span className="role-inspector-row-label">{label}</span>
      <div className="role-inspector-row-control idea-inspector-control">{children}</div>
    </div>
  );
}

export default function IdeaInspectorGroup({
  idea,
  agentId,
  scope,
  typeLabel,
  tagSuggestions,
  tagError,
  childCount,
  scopeLocked = false,
  emptyStatus = "No canonical idea linked",
  onScopeChange,
  onTagAdd,
  onTagRemove,
}: IdeaInspectorGroupProps) {
  const [copied, setCopied] = useState(false);
  const words = useMemo(() => {
    if (!idea) return 0;
    return blockTreeToPlainText(idea.content).trim().split(/\s+/).filter(Boolean).length;
  }, [idea]);

  function copyIdeaId() {
    if (!idea) return;
    void navigator.clipboard.writeText(idea.id).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    });
  }

  return (
    <PropertyGroup title="Idea" defaultOpen>
      {idea ? (
        <>
          {scopeLocked || !onScopeChange ? (
            <ReadOnlyRow label="Scope">
              <span className="role-inspector-meta">{SCOPE_LABEL[scope] ?? scope}</span>
            </ReadOnlyRow>
          ) : (
            <EditableControlRow label="Scope">
              <IdeasScopePopover scope={scope} onChange={onScopeChange} />
            </EditableControlRow>
          )}
          <ReadOnlyRow label="Type">
            <span className="role-inspector-meta">{typeLabel}</span>
          </ReadOnlyRow>
          <CopyableRow
            label="Idea ID"
            title={compactAddress(idea.id)}
            copied={copied}
            onCopy={copyIdeaId}
          />
          <div className="role-inspector-field-block">
            <span className="role-inspector-row-label">Tags</span>
            <div className="role-inspector-field-body">
              <TagsEditor
                tags={idea.tags ?? []}
                typed={idea.tags ?? []}
                suggestions={tagSuggestions}
                onAdd={onTagAdd}
                onRemove={onTagRemove}
              />
              {tagError && <span className="role-inspector-error">{tagError}</span>}
            </div>
          </div>
          <div className="role-inspector-field-block">
            <span className="role-inspector-row-label">References</span>
            <div className="role-inspector-field-body">
              <IdeaLinksPanel ideaId={idea.id} agentId={idea.agent_id ?? agentId} />
            </div>
          </div>
          {typeof childCount === "number" && (
            <ReadOnlyRow label="Children">
              <span className="role-inspector-meta">{childCount}</span>
            </ReadOnlyRow>
          )}
          <ReadOnlyRow label="Words">
            <span className="role-inspector-meta">{words}</span>
          </ReadOnlyRow>
        </>
      ) : (
        <ReadOnlyRow label="Status">
          <span className="role-inspector-meta">{emptyStatus}</span>
        </ReadOnlyRow>
      )}
    </PropertyGroup>
  );
}
