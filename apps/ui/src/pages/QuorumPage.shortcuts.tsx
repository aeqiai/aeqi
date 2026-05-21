/**
 * Quorum surface — keyboard shortcuts + cheat-sheet popover.
 *
 * iter-6 left "keyboard shortcuts" on the NEXT list; iter-7 closes it.
 * The page is dense enough that an operator scanning a long proposals
 * table benefits from the same key-driven workflow the rest of the app
 * already ships (chat composer, sidebar nav). We add five bindings
 * scoped to the page:
 *
 *   - `n` opens the New Proposal modal (when allowed by the header CTA)
 *   - `c` toggles compare mode (when allowed by the active filter)
 *   - `v` opens the detail modal for the currently selected row
 *   - `↑` / `↓` moves the selected row up/down through the visible list
 *   - `Esc` closes any open modal (already handled by the Modal primitive)
 *
 * Shortcuts are ignored when focus is inside an input/textarea/select or
 * any element with `contentEditable`, so the chat composer / search box
 * / proposal-body field stay first-class typing surfaces.
 *
 * The cheat-sheet renders as a `?` icon-button in the proposals toolbar
 * (next to the filter chips). Click opens a Popover listing each binding
 * + a one-line description.
 */
import { useEffect } from "react";

import { Button, Inline, Popover, Stack } from "@/components/ui";
import styles from "./QuorumPage.module.css";

/**
 * Map of which shortcut surfaces the cheat-sheet exposes. Each row is a
 * single key (visible as a kbd-styled tile) + description (plain text).
 */
export interface ShortcutBinding {
  /** Display label — the actual key, rendered as a kbd-style tile. */
  key: string;
  /** Plain-English description of what the binding does. */
  description: string;
}

export const QUORUM_SHORTCUTS: readonly ShortcutBinding[] = [
  { key: "n", description: "Open new-proposal draft" },
  { key: "c", description: "Toggle compare mode (when ≥2 active proposals)" },
  { key: "v", description: "View detail of selected proposal" },
  { key: "↑ ↓", description: "Move selection through the proposals table" },
  { key: "Esc", description: "Close any open modal" },
];

/**
 * Returns `true` when the active focus target is a typing surface and
 * we should NOT swallow the key event. Mirrors the Quests / Composer
 * shortcut guard so the rules stay consistent across the app.
 */
function isEditableFocus(): boolean {
  const el = document.activeElement;
  if (!el) return false;
  const tag = el.tagName.toLowerCase();
  if (tag === "input" || tag === "textarea" || tag === "select") return true;
  // contentEditable returns "true" / "false" / "inherit" / "plaintext-only"
  if ((el as HTMLElement).isContentEditable) return true;
  return false;
}

/**
 * Hook installer. Wires a single window-level keydown listener that
 * dispatches to the supplied callbacks. Each callback can be undefined —
 * the matching binding is silently dropped when the action isn't
 * available in the current page state (no configs yet, no rows, etc).
 *
 * Returns nothing; effects clean up the listener on unmount or when any
 * callback identity changes (which is rare — callers should wrap them
 * with `useCallback` to keep the listener stable).
 */
export function useQuorumKeyboardShortcuts(opts: {
  onNew?: () => void;
  onToggleCompare?: () => void;
  onViewSelected?: () => void;
  onMoveSelection?: (delta: 1 | -1) => void;
  /** Modifier-key guard: when `true` shortcuts fire even with meta/ctrl. */
  allowWithMod?: boolean;
}): void {
  const { onNew, onToggleCompare, onViewSelected, onMoveSelection, allowWithMod = false } = opts;
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Skip shortcuts when typing in a form control — the operator is
      // mid-edit and shouldn't have their keystroke intercepted.
      if (isEditableFocus()) return;
      // Skip when a modifier is held (cmd/ctrl/alt) unless the caller
      // opted in. Most browser shortcuts (cmd+s, ctrl+f, …) should pass
      // through untouched.
      if (!allowWithMod && (e.metaKey || e.ctrlKey || e.altKey)) return;

      const key = e.key;
      switch (key) {
        case "n":
        case "N":
          if (onNew) {
            e.preventDefault();
            onNew();
          }
          break;
        case "c":
        case "C":
          if (onToggleCompare) {
            e.preventDefault();
            onToggleCompare();
          }
          break;
        case "v":
        case "V":
          if (onViewSelected) {
            e.preventDefault();
            onViewSelected();
          }
          break;
        case "ArrowDown":
          if (onMoveSelection) {
            e.preventDefault();
            onMoveSelection(1);
          }
          break;
        case "ArrowUp":
          if (onMoveSelection) {
            e.preventDefault();
            onMoveSelection(-1);
          }
          break;
        default:
          break;
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onNew, onToggleCompare, onViewSelected, onMoveSelection, allowWithMod]);
}

/**
 * `ShortcutsCheatSheet` — the `?` icon-button rendered in the proposals
 * toolbar. Click reveals a Popover listing every binding with its
 * description. Lives next to the filter chips so operators discover the
 * shortcuts where they'd naturally look for filter / sort controls.
 *
 * The popover renders the bindings as a 2-column key/description grid
 * with kbd-style tiles for the key tokens — same visual treatment used
 * across the rest of the app's keybinding surfaces.
 */
export function ShortcutsCheatSheet() {
  return (
    <Popover
      trigger={
        <Button
          variant="ghost"
          size="sm"
          aria-label="Keyboard shortcuts"
          title="Keyboard shortcuts"
        >
          ?
        </Button>
      }
      placement="bottom-end"
    >
      <Stack gap="2" className={styles.shortcutsPanel}>
        <span className={styles.shortcutsHeading}>Keyboard shortcuts</span>
        <div className={styles.shortcutsGrid} role="list">
          {QUORUM_SHORTCUTS.map((binding) => (
            <Inline key={binding.key} gap="3" align="center" role="listitem">
              <span className={styles.shortcutsKbd} aria-hidden="true">
                {binding.key}
              </span>
              <span className={styles.shortcutsDescription}>{binding.description}</span>
            </Inline>
          ))}
        </div>
        <span className={styles.shortcutsFootnote}>
          Shortcuts pause while you're typing in an input.
        </span>
      </Stack>
    </Popover>
  );
}
