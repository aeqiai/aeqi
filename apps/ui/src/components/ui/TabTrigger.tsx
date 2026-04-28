import { forwardRef } from "react";
import type { ReactNode } from "react";
import styles from "./TabTrigger.module.css";

export interface TabTriggerProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** Whether this trigger is currently active/selected. */
  active: boolean;
  /** Callback fired when the trigger is clicked. */
  onClick: () => void;
  /** Label text or content. */
  children: ReactNode;
  /** Optional icon rendered to the left of the label. */
  leadingIcon?: ReactNode;
  /** Optional badge count rendered to the right of the label. */
  badge?: number;
}

export const TabTrigger = forwardRef<HTMLButtonElement, TabTriggerProps>(function TabTrigger(
  {
    active,
    onClick,
    children,
    leadingIcon,
    badge,
    className,
    disabled = false,
    type = "button",
    ...rest
  },
  ref,
) {
  const cls = [
    styles.trigger,
    active ? styles.active : "",
    disabled ? styles.disabled : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <button
      ref={ref}
      type={type}
      role="tab"
      aria-pressed={active}
      className={cls}
      onClick={onClick}
      disabled={disabled}
      {...rest}
    >
      {leadingIcon && <span className={styles.leadingIcon}>{leadingIcon}</span>}
      <span className={styles.label}>{children}</span>
      {badge != null && badge > 0 && <span className={styles.badge}>{badge}</span>}
    </button>
  );
});

TabTrigger.displayName = "TabTrigger";
