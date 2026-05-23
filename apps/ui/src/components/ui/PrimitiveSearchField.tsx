import type React from "react";

export interface PrimitiveSearchFieldProps {
  value: string;
  onChange: (next: string) => void;
  placeholder: string;
  inputRef?: React.RefObject<HTMLInputElement | null>;
  showKbdHint?: boolean;
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  onEscapeEmpty?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  className?: string;
  ariaLabel?: string;
}

export function PrimitiveSearchField({
  value,
  onChange,
  placeholder,
  inputRef,
  showKbdHint = false,
  onKeyDown,
  onEscapeEmpty,
  className,
  ariaLabel,
}: PrimitiveSearchFieldProps) {
  return (
    <span className={["ideas-list-search-field", className].filter(Boolean).join(" ")}>
      <svg
        className="ideas-list-search-glyph"
        width="12"
        height="12"
        viewBox="0 0 12 12"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        aria-hidden
      >
        <circle cx="5.2" cy="5.2" r="3.2" />
        <path d="M7.6 7.6 L10 10" />
      </svg>
      <input
        ref={inputRef}
        className="ideas-list-search"
        type="search"
        aria-label={ariaLabel ?? placeholder}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            if (value) {
              onChange("");
            } else if (onEscapeEmpty) {
              onEscapeEmpty(e);
            } else {
              e.currentTarget.blur();
            }
            return;
          }
          onKeyDown?.(e);
        }}
      />
      {showKbdHint && !value && (
        <kbd className="ideas-list-search-kbd" aria-hidden>
          /
        </kbd>
      )}
      {value && (
        <button
          type="button"
          className="ideas-list-search-clear"
          onClick={() => onChange("")}
          aria-label="Clear search"
        >
          &times;
        </button>
      )}
    </span>
  );
}
