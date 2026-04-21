import { Modal } from "./ui/Modal";
import "@/styles/shortcuts.css";

/**
 * Tiny reference overlay, triggered by `?`. Lists the global shortcuts so
 * users can discover `N`, ⌘K, and the rest without reading the source.
 *
 * Keep it short — if the list outgrows the card, that's a signal the
 * shortcuts surface needs a dedicated settings page, not a longer modal.
 */
const SHORTCUTS: { keys: string[]; label: string }[] = [
  { keys: ["⌘", "K"], label: "Open command palette" },
  { keys: ["N"], label: "Spawn a sub-agent under the current agent" },
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
        {SHORTCUTS.map(({ keys, label }) => (
          <div className="shortcuts-row" key={label}>
            <dt className="shortcuts-keys">
              {keys.map((k, i) => (
                <span key={i}>
                  <kbd className="shortcuts-kbd">{k}</kbd>
                  {i < keys.length - 1 && <span className="shortcuts-sep">+</span>}
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
