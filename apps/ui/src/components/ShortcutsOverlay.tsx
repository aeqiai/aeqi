import { Modal } from "./ui/Modal";
import "@/styles/shortcuts.css";

/**
 * Tiny reference overlay, triggered by `?`. Lists the global shortcuts so
 * users can discover `N`, ⌘K, and the rest without reading the source.
 *
 * Keep it short — if the list outgrows the card, that's a signal the
 * shortcuts surface needs a dedicated settings page, not a longer modal.
 */
// Outer array = alternate chords joined by "or" (both fire the same action).
// Inner array = keys within a chord joined by `sep` — "+" for held-together
// combos, "then" for a sequence (g-prefix nav). Letters in g-prefix match
// the sidebar A-E-Q-I wordmark.
const SHORTCUTS: { keys: string[][]; label: string; sep?: string }[] = [
  { keys: [["⌘", "K"], ["/"]], label: "Open command palette" },
  { keys: [["⌘", "B"]], label: "Toggle sidebar" },
  { keys: [["N"]], label: "Spawn a sub-agent under the current agent" },
  { keys: [["C"]], label: "Focus the composer" },
  { keys: [["J"], ["K"]], label: "Navigate cards in the quest kanban" },
  { keys: [["←"], ["→"], ["↑"], ["↓"]], label: "Walk the agent org chart" },
  { keys: [["+"]], label: "Spawn a sub-agent under the focused org-chart card" },
  { keys: [["G", "A"]], label: "Jump to Agents", sep: "then" },
  { keys: [["G", "E"]], label: "Jump to Events", sep: "then" },
  { keys: [["G", "Q"]], label: "Jump to Quests", sep: "then" },
  { keys: [["G", "I"]], label: "Jump to Ideas", sep: "then" },
  { keys: [["G", "S"]], label: "Jump to Inbox", sep: "then" },
  { keys: [["?"]], label: "Show this list" },
  { keys: [["Esc"]], label: "Close overlays" },
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
              {keys.map((chord, ci) => (
                <span key={ci} className="shortcuts-chord">
                  {chord.map((k, i) => (
                    <span key={i}>
                      <kbd className="shortcuts-kbd">{k}</kbd>
                      {i < chord.length - 1 && <span className="shortcuts-sep">{sep}</span>}
                    </span>
                  ))}
                  {ci < keys.length - 1 && <span className="shortcuts-or">or</span>}
                </span>
              ))}
            </dt>
            <dd className="shortcuts-label">{label}</dd>
          </div>
        ))}
      </dl>
      <div className="shortcuts-footer">
        <a
          className="shortcuts-footer-link"
          href="https://aeqi.ai/docs"
          target="_blank"
          rel="noreferrer noopener"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M3 2.5h7a2 2 0 0 1 2 2v9H5a2 2 0 0 1-2-2v-9z" />
            <path d="M3 11.5a2 2 0 0 1 2-2h7" />
          </svg>
          Open documentation
          <svg
            width="10"
            height="10"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            className="shortcuts-footer-ext"
          >
            <path d="M6 3h7v7M13 3 5 11" />
          </svg>
        </a>
      </div>
    </Modal>
  );
}
