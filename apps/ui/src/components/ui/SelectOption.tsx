import { forwardRef } from "react";
import type { ReactNode } from "react";
import styles from "./SelectOption.module.css";

export interface SelectOptionProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** Whether this option is currently selected. */
  selected?: boolean;
  /** Optional icon rendered to the left of the label. */
  leadingIcon?: ReactNode;
  /** Optional secondary text rendered to the right of the label (e.g. keyboard shortcut). */
  trailingHint?: string;
  /** Suppress the leading dot indicator on selected rows. Use when the menu
   * is already a single-pick disclosure (e.g. CompanySwitcher) where the
   * selected row's identity is implicit from the trigger above — the dot
   * adds redundant signal. The selected background tint stays. */
  noIndicator?: boolean;
}

export const SelectOption = forwardRef<HTMLButtonElement, SelectOptionProps>(function SelectOption(
  {
    selected = false,
    leadingIcon,
    trailingHint,
    noIndicator = false,
    className,
    children,
    disabled,
    ...rest
  },
  ref,
) {
  const cls = [
    styles.option,
    selected ? styles.selected : "",
    leadingIcon ? styles.withLeadingIcon : "",
    trailingHint ? styles.withTrailingHint : "",
    noIndicator ? styles.noIndicator : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <button
      ref={ref}
      type="button"
      role="option"
      aria-selected={selected}
      className={cls}
      disabled={disabled}
      {...rest}
    >
      {leadingIcon && <span className={styles.leadingIcon}>{leadingIcon}</span>}
      <span className={styles.label}>{children}</span>
      {trailingHint && <span className={styles.trailingHint}>{trailingHint}</span>}
    </button>
  );
});

SelectOption.displayName = "SelectOption";
