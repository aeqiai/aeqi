import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Popover } from "./Popover";
import styles from "./Combobox.module.css";

export interface ComboboxOption {
  value: string;
  label: string;
  meta?: ReactNode;
  disabled?: boolean;
}

export interface ComboboxProps {
  options: ComboboxOption[];
  value: string | null;
  onChange: (value: string) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyLabel?: string;
  size?: "sm" | "md";
  disabled?: boolean;
  className?: string;
}

export function Combobox({
  options,
  value,
  onChange,
  placeholder = "Select…",
  searchPlaceholder = "Search…",
  emptyLabel = "No matches",
  size = "md",
  disabled,
  className,
}: ComboboxProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);

  const id = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const rowRefs = useRef<Map<string, HTMLButtonElement>>(new Map());

  const selected = options.find((o) => o.value === value) ?? null;

  const filtered = query.trim()
    ? options.filter((o) => o.label.toLowerCase().includes(query.trim().toLowerCase()))
    : options;

  // Keep cursor in range when visible list changes.
  useEffect(() => {
    setCursor((c) => Math.min(c, Math.max(0, filtered.length - 1)));
  }, [filtered.length]);

  // Auto-scroll highlighted option into view.
  useEffect(() => {
    if (!open) return;
    const opt = filtered[cursor];
    if (!opt) return;
    rowRefs.current.get(opt.value)?.scrollIntoView({ block: "nearest" });
  }, [cursor, filtered, open]);

  const openCombobox = useCallback(() => {
    if (disabled) return;
    // Position cursor on current value or 0.
    const idx = value ? filtered.findIndex((o) => o.value === value) : -1;
    setCursor(idx >= 0 ? idx : 0);
    setQuery("");
    setOpen(true);
    requestAnimationFrame(() => searchRef.current?.focus());
  }, [disabled, filtered, value]);

  const closeCombobox = useCallback(() => {
    setOpen(false);
    setQuery("");
    requestAnimationFrame(() => triggerRef.current?.focus());
  }, []);

  const commit = useCallback(
    (val: string) => {
      closeCombobox();
      if (val !== value) onChange(val);
    },
    [closeCombobox, onChange, value],
  );

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      const next = filtered.findIndex((o, i) => i > cursor && !o.disabled);
      if (next >= 0) setCursor(next);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      const candidates = filtered
        .map((_, i) => i)
        .filter((i) => i < cursor && !filtered[i].disabled);
      if (candidates.length > 0) setCursor(candidates[candidates.length - 1]);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const opt = filtered[cursor];
      if (opt && !opt.disabled) commit(opt.value);
    } else if (e.key === "Escape") {
      e.preventDefault();
      closeCombobox();
    }
  };

  const wrapperCls = [styles.wrapper, styles[size], className].filter(Boolean).join(" ");

  return (
    <div className={wrapperCls}>
      <Popover
        open={open}
        onOpenChange={(next) => {
          if (!next) closeCombobox();
        }}
        placement="bottom-start"
        trigger={
          <button
            ref={triggerRef}
            type="button"
            className={styles.trigger}
            disabled={disabled}
            aria-haspopup="listbox"
            aria-expanded={open}
            aria-controls={id}
            onClick={() => (open ? closeCombobox() : openCombobox())}
          >
            <span
              className={[styles.triggerLabel, !selected ? styles.triggerPlaceholder : ""]
                .filter(Boolean)
                .join(" ")}
            >
              {selected ? selected.label : placeholder}
            </span>
            <span
              className={[styles.chevron, open ? styles.chevronOpen : ""].filter(Boolean).join(" ")}
              aria-hidden="true"
            >
              <svg width="10" height="6" viewBox="0 0 10 6" fill="none">
                <path
                  d="M1 1L5 5L9 1"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </span>
          </button>
        }
      >
        <div
          className={styles.panel}
          role="listbox"
          id={id}
          aria-label="Options"
          onKeyDown={onKeyDown}
        >
          <div className={styles.search}>
            <span className={styles.searchIcon} aria-hidden="true">
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                <circle cx="5" cy="5" r="3.5" stroke="currentColor" strokeWidth="1.2" />
                <path
                  d="M7.6 7.6 L10 10"
                  stroke="currentColor"
                  strokeWidth="1.2"
                  strokeLinecap="round"
                />
              </svg>
            </span>
            <input
              ref={searchRef}
              className={styles.searchInput}
              type="text"
              value={query}
              placeholder={searchPlaceholder}
              spellCheck={false}
              autoComplete="off"
              onChange={(e) => {
                setQuery(e.target.value);
                setCursor(0);
              }}
              onKeyDown={onKeyDown}
            />
          </div>

          <div className={styles.list}>
            {filtered.length === 0 && <div className={styles.empty}>{emptyLabel}</div>}
            {filtered.map((opt, idx) => {
              const isActive = idx === cursor;
              const isSelected = opt.value === value;
              const optCls = [
                styles.option,
                isActive ? styles.optionActive : "",
                isSelected ? styles.optionSelected : "",
              ]
                .filter(Boolean)
                .join(" ");
              return (
                <button
                  key={opt.value}
                  ref={(el) => {
                    if (el) rowRefs.current.set(opt.value, el);
                    else rowRefs.current.delete(opt.value);
                  }}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  className={optCls}
                  disabled={opt.disabled}
                  onMouseEnter={() => !opt.disabled && setCursor(idx)}
                  onClick={() => !opt.disabled && commit(opt.value)}
                >
                  <span className={styles.checkmark} aria-hidden="true">
                    {isSelected && (
                      <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                        <path
                          d="M2 6L5 9L10 3"
                          stroke="currentColor"
                          strokeWidth="1.5"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    )}
                  </span>
                  <span className={styles.optionLabel}>{opt.label}</span>
                  {opt.meta != null && <span className={styles.optionMeta}>{opt.meta}</span>}
                </button>
              );
            })}
          </div>
        </div>
      </Popover>
    </div>
  );
}

Combobox.displayName = "Combobox";
