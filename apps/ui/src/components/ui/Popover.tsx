import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { ReactNode } from "react";
import styles from "./Popover.module.css";

export type PopoverPlacement = "bottom-start" | "bottom-end" | "top-start" | "top-end";

export interface PopoverProps {
  /** The element that opens/closes the popover when clicked. */
  trigger: ReactNode;
  /** Content rendered inside the floating panel. */
  children: ReactNode;
  /** Controlled open state. Omit to use uncontrolled behaviour. */
  open?: boolean;
  /** Called when the popover requests an open/close transition. */
  onOpenChange?: (open: boolean) => void;
  /** Which edge of the trigger the popover anchors to. */
  placement?: PopoverPlacement;
  /** Extra class applied to the floating panel. */
  className?: string;
}

export function Popover({
  trigger,
  children,
  open: controlledOpen,
  onOpenChange,
  placement = "bottom-start",
  className,
}: PopoverProps) {
  const isControlled = controlledOpen !== undefined;
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const open = isControlled ? controlledOpen : uncontrolledOpen;

  const id = useId();
  const rootRef = useRef<HTMLDivElement>(null);

  const setOpen = useCallback(
    (next: boolean) => {
      if (!isControlled) setUncontrolledOpen(next);
      onOpenChange?.(next);
    },
    [isControlled, onOpenChange],
  );

  const toggle = useCallback(() => setOpen(!open), [open, setOpen]);

  // Outside-click dismissal.
  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (rootRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open, setOpen]);

  // Esc dismissal + focus return to first focusable element in trigger.
  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        const focusable = rootRef.current?.querySelector<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        );
        focusable?.focus();
      }
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [open, setOpen]);

  const placementKey = placement.replace("-", "_") as
    | "bottom_start"
    | "bottom_end"
    | "top_start"
    | "top_end";

  const panelCls = [styles.panel, styles[placementKey], open ? styles.open : "", className]
    .filter(Boolean)
    .join(" ");

  return (
    <div ref={rootRef} className={styles.root}>
      {/* Trigger wrapper: intercepts clicks in uncontrolled mode. */}
      <div
        className={styles.triggerSlot}
        onClick={isControlled ? undefined : toggle}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={id}
      >
        {trigger}
      </div>
      <div ref={null} id={id} className={panelCls} role="dialog" aria-modal="false">
        {children}
      </div>
    </div>
  );
}

Popover.displayName = "Popover";
