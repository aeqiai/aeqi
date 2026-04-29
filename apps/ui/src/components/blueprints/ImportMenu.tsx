import { useRef, useState } from "react";
import { Menu, Button } from "@/components/ui";
import { BlueprintPickerModal } from "./BlueprintPickerModal";
// `.bp-error` lives in this stylesheet — Import banners reuse it so we
// don't grow a parallel "import error" rule. Side-effect import; safe to
// duplicate (CSSStyleSheets dedupe on the bundler side).
import "@/styles/blueprints-store.css";

interface ImportMenuProps {
  /** Host entity that the blueprint spawn lands in. */
  entityId: string;
  /**
   * Which seed parts the "From a blueprint" path materializes. Pass
   * `["ideas"]` from the Ideas tab, `["quests"]` from the Quests tab.
   */
  parts: string[];
  /** Modal title shown when picking a blueprint. */
  blueprintTitle: string;
  /** Markdown file picker accept attribute (default `.md,.markdown`). */
  accept?: string;
  /** Called once the user has picked one or more markdown files. The
   *  caller is responsible for parsing + uploading; the menu only
   *  hands the files over and dismisses. */
  onMarkdownPicked: (files: FileList) => void;
  /** Called after a successful blueprint spawn so the host page can
   *  refresh the relevant primitive's list. */
  onBlueprintSpawned: () => void;
}

/**
 * `Import ▾` button + menu. Two paths:
 *   1. From markdown — opens a hidden `<input type=file multiple>`.
 *   2. From a blueprint — opens `BlueprintPickerModal` with `parts`
 *      so the spawn only seeds the named primitive.
 *
 * Trigger styled as `<Button variant="primary" size="sm">` to match
 * `+ New <primitive>` in the same toolbar — the dropdown caret is the
 * only visual deviation.
 */
export function ImportMenu({
  entityId,
  parts,
  blueprintTitle,
  accept = ".md,.markdown",
  onMarkdownPicked,
  onBlueprintSpawned,
}: ImportMenuProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  return (
    <>
      <Menu
        placement="bottom-end"
        trigger={
          <Button variant="primary" size="sm">
            <span>Import</span>
            <svg
              width="9"
              height="9"
              viewBox="0 0 9 9"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
              style={{ marginLeft: 2 }}
            >
              <path d="M2 3.2 L4.5 5.7 L7 3.2" />
            </svg>
          </Button>
        }
        items={[
          {
            key: "markdown",
            label: "From markdown",
            onSelect: () => fileInputRef.current?.click(),
          },
          {
            key: "blueprint",
            label: "From a blueprint",
            onSelect: () => setPickerOpen(true),
          },
        ]}
      />
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept={accept}
        style={{ display: "none" }}
        onChange={(e) => {
          const files = e.target.files;
          if (files && files.length > 0) onMarkdownPicked(files);
          // Reset so picking the same file twice in a row still fires onChange.
          e.target.value = "";
        }}
      />
      <BlueprintPickerModal
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        entityId={entityId}
        parts={parts}
        title={blueprintTitle}
        onSpawned={onBlueprintSpawned}
      />
    </>
  );
}
