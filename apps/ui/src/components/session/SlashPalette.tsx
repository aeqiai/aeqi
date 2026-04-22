import { useEffect, useRef } from "react";

export type SlashCommand = {
  slug: string;
  label: string;
  hint?: string;
  shortcut?: string;
  run: () => void;
};

type Props = {
  open: boolean;
  query: string;
  commands: SlashCommand[];
  activeIndex: number;
  onActiveChange: (next: number) => void;
  onRun: (cmd: SlashCommand) => void;
  onDismiss: () => void;
};

/**
 * Inline slash-command palette that rises from the composer. Keyboard-first;
 * filter tracks input after the "/" character. The composer keeps focus — the
 * palette is a passive list that mirrors the active index so arrow/Enter
 * handling lives in the composer's keydown handler, not here.
 */
export default function SlashPalette({
  open,
  query,
  commands,
  activeIndex,
  onActiveChange,
  onRun,
  onDismiss,
}: Props) {
  const activeRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  if (!open || commands.length === 0) return null;

  return (
    <div className="asv-slash" role="listbox" aria-label="Slash commands">
      <div className="asv-slash-head">
        <span className="asv-slash-marker">/</span>
        <span className="asv-slash-query">{query || "commands"}</span>
      </div>
      <ul className="asv-slash-list">
        {commands.map((cmd, i) => (
          <li key={cmd.slug}>
            <button
              ref={i === activeIndex ? activeRef : undefined}
              type="button"
              role="option"
              aria-selected={i === activeIndex}
              className={`asv-slash-item${i === activeIndex ? " active" : ""}`}
              onMouseEnter={() => onActiveChange(i)}
              onClick={() => {
                onRun(cmd);
                onDismiss();
              }}
            >
              <span className="asv-slash-slug">/{cmd.slug}</span>
              <span className="asv-slash-label">{cmd.label}</span>
              {cmd.shortcut && <span className="asv-slash-kbd">{cmd.shortcut}</span>}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
