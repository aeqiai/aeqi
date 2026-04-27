import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";
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
  /**
   * Render the panel via a portal to `document.body` with `position:
   * fixed`, recomputed against the trigger's bounding rect. Use this
   * when the trigger is inside an `overflow:auto`/`overflow:hidden`
   * scroll container that would otherwise clip the panel — kanban
   * column bodies, list-view scroll regions, modal bodies. Default is
   * inline positioning, which preserves the back-compat behaviour for
   * every existing call site.
   */
  portal?: boolean;
}

export function Popover({
  trigger,
  children,
  open: controlledOpen,
  onOpenChange,
  placement = "bottom-start",
  className,
  portal = false,
}: PopoverProps) {
  const isControlled = controlledOpen !== undefined;
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const open = isControlled ? controlledOpen : uncontrolledOpen;

  const id = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const setOpen = useCallback(
    (next: boolean) => {
      if (!isControlled) setUncontrolledOpen(next);
      onOpenChange?.(next);
    },
    [isControlled, onOpenChange],
  );

  const toggle = useCallback(() => setOpen(!open), [open, setOpen]);

  // Outside-click dismissal. In portal mode the panel is no longer a
  // DOM child of root, so the hit-test has to check both the trigger
  // root and the portaled panel.
  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      const target = e.target as Node;
      if (rootRef.current?.contains(target)) return;
      if (panelRef.current?.contains(target)) return;
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

  // Portal positioning — fixed coords derived from the trigger's
  // bounding rect, recomputed on open and on scroll/resize so the
  // panel tracks the trigger when ancestors scroll. Reads each
  // placement's anchor edge so `bottom-end` / `top-end` line up with
  // the trigger's right edge instead of its left.
  const [coords, setCoords] = useState<{
    top?: number;
    bottom?: number;
    left?: number;
    right?: number;
  }>({});

  useLayoutEffect(() => {
    if (!portal || !open) return;
    const update = () => {
      const rect = rootRef.current?.getBoundingClientRect();
      if (!rect) return;
      const gap = 4;
      switch (placement) {
        case "bottom-start":
          setCoords({ top: rect.bottom + gap, left: rect.left });
          break;
        case "bottom-end":
          setCoords({ top: rect.bottom + gap, right: window.innerWidth - rect.right });
          break;
        case "top-start":
          setCoords({ bottom: window.innerHeight - rect.top + gap, left: rect.left });
          break;
        case "top-end":
          setCoords({
            bottom: window.innerHeight - rect.top + gap,
            right: window.innerWidth - rect.right,
          });
          break;
      }
    };
    update();
    window.addEventListener("resize", update);
    // Capture-mode listener so nested scroll containers (kanban
    // column body, list scroll region) also retrigger the recompute.
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [portal, open, placement]);

  return (
    <div ref={rootRef} className={styles.root}>
      {/* Trigger wrapper: intercepts clicks in BOTH controlled and
          uncontrolled mode. setOpen() always fires onOpenChange when
          provided and only mutates internal state when uncontrolled,
          so wiring `toggle` here is safe in either mode and is what
          lets controlled consumers (Menu, IdeasFilterPopover, ...)
          actually open via the trigger button. */}
      <div
        className={styles.triggerSlot}
        onClick={toggle}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={id}
      >
        {trigger}
      </div>
      {portal ? (
        createPortal(
          <div
            ref={panelRef}
            id={id}
            className={panelCls}
            role="dialog"
            aria-modal="false"
            style={{ position: "fixed", ...coords }}
          >
            {children}
          </div>,
          document.body,
        )
      ) : (
        <div ref={panelRef} id={id} className={panelCls} role="dialog" aria-modal="false">
          {children}
        </div>
      )}
    </div>
  );
}

Popover.displayName = "Popover";
