import { Modal } from "./ui/Modal";
import "@/styles/shortcuts.css";

/**
 * Tiny reference overlay, triggered by `?`. Lists the global shortcuts so
 * users can discover `N`, ⌘K, and the rest without reading the source.
 *
 * Keep it short — if the list outgrows the card, that's a signal the
 * shortcuts surface needs a dedicated settings page, not a longer modal.
 */
// sep defaults to "+" for chord combos; "then" marks a sequence (g-prefix
// navigation). Letters in g-prefix match the sidebar A-E-Q-I wordmark.
const SHORTCUTS: { keys: string[]; label: string; sep?: string }[] = [
  { keys: ["⌘", "K"], label: "Open command palette" },
  { keys: ["/"], label: "Open command palette" },
  { keys: ["N"], label: "Spawn a sub-agent under the current agent" },
  { keys: ["G", "A"], label: "Jump to Agents", sep: "then" },
  { keys: ["G", "E"], label: "Jump to Events", sep: "then" },
  { keys: ["G", "Q"], label: "Jump to Quests", sep: "then" },
  { keys: ["G", "I"], label: "Jump to Ideas", sep: "then" },
  { keys: ["G", "S"], label: "Jump to Inbox", sep: "then" },
  { keys: ["?"], label: "Show this list" },
  { keys: ["Esc"], label: "Close overlays" },
];

export default function ShortcutsOverlay({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  return (
    <Modal open={open} onClose={onClose} title="Keyboard shortcuts" className="shortcuts-modal">
      <dl className="shortcuts-list">
        {SHORTCUTS.map(({ keys, label, sep = "+" }) => (
          <div className="shortcuts-row" key={label}>
            <dt className="shortcuts-keys">
              {keys.map((k, i) => (
                <span key={i}>
                  <kbd className="shortcuts-kbd">{k}</kbd>
                  {i < keys.length - 1 && <span className="shortcuts-sep">{sep}</span>}
                </span>
              ))}
            </dt>
            <dd className="shortcuts-label">{label}</dd>
          </div>
        ))}
      </dl>
    </Modal>
  );
}
