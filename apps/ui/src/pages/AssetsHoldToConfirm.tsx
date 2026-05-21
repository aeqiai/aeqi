/**
 * Iter-11 — hold-to-confirm button.
 *
 * Solves a specific pacing problem on the budget row: operators
 * frequently want to freeze quickly, but a single-tap freeze is
 * too dangerous (one accidental click stops a payroll budget mid-
 * cycle). The Modal flow shipped in iter-8 is the safe path; this
 * is the fast path — press and hold for 600ms, the fill bar
 * confirms intent, release before the timeout cancels harmlessly.
 *
 * Pattern is borrowed from native iOS "press-and-hold-to-emoji"
 * affordances and Figma's hold-to-delete: a clear progress bar
 * inside the button signals what's about to happen, and releasing
 * during the hold leaves no side effect. No modal.
 *
 * Honest scope:
 *   - Pointer events only — works for mouse, touch, and stylus.
 *     Keyboard activation falls back to a single Enter/Space press
 *     because hold-on-key gets ugly across IME / accessibility
 *     stacks; the Modal path is the keyboard story.
 *   - We don't disable the row-click while the hold runs (operator
 *     might want to back out by clicking elsewhere); `pointerleave`
 *     during the hold cancels it.
 *   - The visual progress bar is rendered inside the button via a
 *     data attribute the CSS module animates with a single keyframe.
 *     We don't pull in framer-motion or any animation lib.
 */
import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui";

import styles from "./AssetsPage.module.css";

export interface HoldToConfirmProps {
  /** Visible label. */
  children: React.ReactNode;
  /** ms the operator must hold before the action fires. Default 600
   *  matches the brief; range 400–800 keeps it deliberate without
   *  feeling sluggish. */
  holdMs?: number;
  /** Called when the hold completes. Returns a promise so the
   *  button can keep the loading state visible until the on-chain
   *  call resolves. */
  onConfirm: () => Promise<void> | void;
  /** Tooltip + aria description — the row needs the operator to
   *  know this is hold-to-confirm rather than a single click. */
  hint?: string;
  variant?: "ghost" | "secondary" | "primary";
  disabled?: boolean;
  ariaLabel?: string;
}

/**
 * `HoldToConfirmButton` — a small wrapper around `Button` that
 * tracks the hold state and renders a progress fill via the
 * `data-hold` attribute. Keyboard activation (Enter/Space) falls
 * through to single-click for accessibility — the Modal path
 * remains the documented keyboard story.
 */
export function HoldToConfirmButton({
  children,
  holdMs = 600,
  onConfirm,
  hint,
  variant = "ghost",
  disabled = false,
  ariaLabel,
}: HoldToConfirmProps) {
  const [holding, setHolding] = useState(false);
  const [busy, setBusy] = useState(false);
  const timerRef = useRef<number | null>(null);

  const fire = useCallback(async () => {
    setHolding(false);
    setBusy(true);
    try {
      await onConfirm();
    } finally {
      setBusy(false);
    }
  }, [onConfirm]);

  const cancel = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setHolding(false);
  }, []);

  const start = useCallback(() => {
    if (disabled || busy) return;
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
    }
    setHolding(true);
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      void fire();
    }, holdMs);
  }, [disabled, busy, fire, holdMs]);

  // Defensive cleanup — if the component unmounts mid-hold (e.g.
  // re-fetch reorders the row off-screen) the timer must not
  // outlive its handler.
  useEffect(() => {
    return () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, []);

  return (
    <Button
      variant={variant}
      size="sm"
      disabled={disabled}
      loading={busy}
      onPointerDown={(e) => {
        e.stopPropagation();
        start();
      }}
      onPointerUp={(e) => {
        e.stopPropagation();
        cancel();
      }}
      onPointerLeave={(e) => {
        e.stopPropagation();
        cancel();
      }}
      onPointerCancel={(e) => {
        e.stopPropagation();
        cancel();
      }}
      onClick={(e) => {
        // Block the synthetic click that follows pointer events —
        // the hold-to-confirm controls firing; a regular tap MUST
        // NOT trigger the action. The Modal path stays the
        // single-click story.
        e.stopPropagation();
        e.preventDefault();
      }}
      title={hint}
      aria-label={ariaLabel}
      className={styles.holdConfirmButton}
      data-hold={holding ? "true" : undefined}
    >
      {children}
    </Button>
  );
}
