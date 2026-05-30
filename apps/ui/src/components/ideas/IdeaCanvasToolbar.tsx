import { Button, Tooltip } from "../ui";
import IdeasScopePopover from "./IdeasScopePopover";
import type { Idea, ScopeValue } from "@/lib/types";
import type { SaveState } from "../IdeaCanvas";
import type { ReactNode } from "react";

export interface IdeaCanvasToolbarProps {
  isEdit: boolean;
  showCompose: boolean;
  dirty: boolean;
  idea?: Idea;
  headerScope: ScopeValue;
  setComposeScope: (s: ScopeValue) => void;
  saveState: SaveState;
  deleteArmed: boolean;
  setDeleteArmed: (b: boolean) => void;
  onBack: () => void;
  onNew: () => void;
  onTrackAsQuest: () => void;
  onDeleteClick: () => void;
  onCancel: () => void;
  onSave: () => void | Promise<unknown>;
  importMenu?: ReactNode;
}

export default function IdeaCanvasToolbar({
  isEdit,
  showCompose,
  dirty,
  idea,
  headerScope,
  setComposeScope,
  saveState,
  deleteArmed,
  setDeleteArmed,
  onBack,
  onNew,
  onTrackAsQuest,
  onDeleteClick,
  onCancel,
  onSave,
  importMenu,
}: IdeaCanvasToolbarProps) {
  return (
    <div className="ideas-toolbar ideas-canvas-toolbar">
      <Tooltip content="Back to ideas">
        <Button
          variant="secondary"
          size="sm"
          onClick={onBack}
          leadingIcon={
            <svg
              width="13"
              height="13"
              viewBox="0 0 13 13"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <path d="M8 3 L4.5 6.5 L8 10" />
            </svg>
          }
        >
          Ideas
        </Button>
      </Tooltip>
      {!showCompose && (
        <Tooltip content="New idea (N)">
          <Button
            variant="primary"
            size="sm"
            onClick={onNew}
            leadingIcon={
              <svg
                width="13"
                height="13"
                viewBox="0 0 13 13"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                aria-hidden
              >
                <path d="M6.5 2.5v8M2.5 6.5h8" />
              </svg>
            }
          >
            Idea
          </Button>
        </Tooltip>
      )}
      {!showCompose && importMenu}
      <IdeasScopePopover
        scope={headerScope}
        locked={isEdit}
        onChange={!isEdit ? setComposeScope : undefined}
      />
      <div className="ideas-toolbar-spacer" aria-hidden />
      {isEdit && idea && (
        <Tooltip content="Track this idea as a quest">
          <Button
            variant="secondary"
            size="sm"
            onClick={onTrackAsQuest}
            leadingIcon={
              <svg
                width="13"
                height="13"
                viewBox="0 0 13 13"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden
              >
                <path d="M2.5 6.5h8M6.5 2.5v8" />
              </svg>
            }
          >
            Track as quest
          </Button>
        </Tooltip>
      )}
      {isEdit && (
        <Tooltip content={deleteArmed ? "Click again to confirm delete" : "Delete idea"}>
          <Button
            variant="danger"
            size="sm"
            onClick={onDeleteClick}
            onBlur={() => setDeleteArmed(false)}
            leadingIcon={
              <svg
                width="13"
                height="13"
                viewBox="0 0 13 13"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                aria-hidden
              >
                <path d="M3.2 3.2 L9.8 9.8 M9.8 3.2 L3.2 9.8" />
              </svg>
            }
          >
            {deleteArmed ? "Confirm" : "Delete"}
          </Button>
        </Tooltip>
      )}
      {(showCompose || dirty) && (
        <>
          <Tooltip content="Cancel">
            <Button
              variant="secondary"
              size="sm"
              onClick={onCancel}
              leadingIcon={
                <svg
                  width="13"
                  height="13"
                  viewBox="0 0 13 13"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  aria-hidden
                >
                  <path d="M3.2 3.2 L9.8 9.8 M9.8 3.2 L3.2 9.8" />
                </svg>
              }
            >
              Cancel
            </Button>
          </Tooltip>
          <Tooltip content={isEdit ? "Save (⌘↵)" : "Save idea (⌘↵)"}>
            <Button
              variant="primary"
              size="sm"
              onClick={onSave}
              disabled={saveState === "saving"}
              loading={saveState === "saving"}
              leadingIcon={
                <svg
                  width="13"
                  height="13"
                  viewBox="0 0 13 13"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden
                >
                  <path d="M2.8 6.6 L5.4 9.2 L10.2 4" />
                </svg>
              }
            >
              Save
            </Button>
          </Tooltip>
        </>
      )}
    </div>
  );
}
