import { useRef, useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { Menu, Button } from "@/components/ui";
import { BlueprintPickerModal } from "./BlueprintPickerModal";
// `.bp-error` lives in this stylesheet — Import banners reuse it so we
// don't grow a parallel "import error" rule. Side-effect import; safe to
// duplicate (CSSStyleSheets dedupe on the bundler side).
import "@/styles/blueprints-store.css";

interface ImportMenuProps {
  /** Host entity that the blueprint spawn lands in. */
  companyId: string;
  /**
   * Which seed parts the "From a blueprint" path materializes. Pass
   * `["ideas"]` from the Ideas tab, `["quests"]` from the Quests tab.
   */
  parts: string[];
  /** Modal title shown when picking a blueprint. */
  blueprintTitle: string;
  /** Markdown file picker accept attribute (default `.md,.markdown`). */
  accept?: string;
  /** Label for the local file picker row. */
  fileLabel?: string;
  /** Label for the toolbar trigger. */
  triggerLabel?: string;
  /** Icon rendered before the trigger label. */
  triggerIcon?: ReactNode;
  /** Whether to show the blueprint import path. */
  includeBlueprint?: boolean;
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
 *   2. From a blueprint — intentionally disabled for MVP launch until
 *      primitive bundle imports stop materializing company-level side effects.
 *
 * Trigger styled as `<Button variant="secondary" size="sm">` — Import is
 * a secondary toolbar action; the primary slot belongs to `+ New <primitive>`.
 * The dropdown caret is the only visual deviation from a plain secondary button.
 */
export function ImportMenu({
  companyId,
  parts,
  blueprintTitle,
  accept = ".md,.markdown",
  fileLabel = "From markdown",
  triggerLabel = "Import",
  triggerIcon,
  includeBlueprint = true,
  onMarkdownPicked,
  onBlueprintSpawned,
  size = "sm",
}: ImportMenuProps & { size?: "sm" | "md" | "lg" | "xl" }) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const fileInput = (
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
  );

  if (!includeBlueprint) {
    return (
      <>
        <Button
          variant="secondary"
          size={size}
          leadingIcon={triggerIcon}
          onClick={() => fileInputRef.current?.click()}
        >
          {triggerLabel}
        </Button>
        {fileInput}
      </>
    );
  }

  return (
    <>
      <Menu
        placement="bottom-end"
        trigger={
          <Button
            variant="secondary"
            size={size}
            leadingIcon={triggerIcon}
            trailingIcon={<ChevronDown size={13} strokeWidth={1.7} />}
            trailingIconMode="inline"
          >
            {triggerLabel}
          </Button>
        }
        items={[
          {
            key: "markdown",
            label: fileLabel,
            onSelect: () => fileInputRef.current?.click(),
          },
          ...(includeBlueprint
            ? [
                {
                  key: "blueprint",
                  label: "Template imports after primitive bundle audit",
                  disabled: true,
                  onSelect: () => setPickerOpen(true),
                },
              ]
            : []),
        ]}
      />
      {fileInput}
      <BlueprintPickerModal
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        companyId={companyId}
        parts={parts}
        title={blueprintTitle}
        onSpawned={onBlueprintSpawned}
      />
    </>
  );
}
