import { createContext, useCallback, useContext, useMemo, useState } from "react";
import type { ReactNode } from "react";

/**
 * EquityPrefillContext — lightweight cross-section pipe inside the Equity
 * page for "click a cap-table row, prefill the action form".
 *
 * Each prefill carries a `nonce` so consumer hooks fire even when the
 * selected address hasn't changed (clicking the same row twice should
 * still scroll and prefill). Consumers `useEffect` on `(nonce, address)`
 * and copy into local state.
 *
 * Why context and not URL state: prefill is a transient UI affordance,
 * not a sharable view. A URL param would survive refreshes and trigger
 * the actions on cold load — wrong for "issue more LAUNCH to this
 * holder" gestures.
 */
export interface EquityPrefill {
  /** Target address for ShareControls' Mint form. */
  mintTo?: string;
  /** Target address for ShareControls' Transfer form. */
  transferTo?: string;
  /** Target address for VestingControls' recipient field. */
  vestingRecipient?: string;
  /** Monotonic nonce so identical addresses still re-prefill. */
  nonce: number;
}

interface EquityPrefillContextValue {
  prefill: EquityPrefill;
  /**
   * Mint to the given holder. Scrolls share-controls into view.
   */
  mintTo(address: string): void;
  /**
   * Transfer to the given holder. Scrolls share-controls into view.
   */
  transferTo(address: string): void;
  /**
   * Vest to the given holder. Scrolls vesting-controls into view.
   */
  vestingRecipient(address: string): void;
}

const EquityPrefillContext = createContext<EquityPrefillContextValue | null>(null);

const SHARE_CONTROLS_ANCHOR = "equity-share-controls";
const VESTING_CONTROLS_ANCHOR = "equity-vesting-controls";

function scrollTo(anchorId: string) {
  if (typeof document === "undefined") return;
  const el = document.getElementById(anchorId);
  if (!el) return;
  el.scrollIntoView({ behavior: "smooth", block: "start" });
}

export function EquityPrefillProvider({ children }: { children: ReactNode }) {
  const [prefill, setPrefill] = useState<EquityPrefill>({ nonce: 0 });

  const mintTo = useCallback((address: string) => {
    setPrefill((p) => ({ nonce: p.nonce + 1, mintTo: address }));
    scrollTo(SHARE_CONTROLS_ANCHOR);
  }, []);
  const transferTo = useCallback((address: string) => {
    setPrefill((p) => ({ nonce: p.nonce + 1, transferTo: address }));
    scrollTo(SHARE_CONTROLS_ANCHOR);
  }, []);
  const vestingRecipient = useCallback((address: string) => {
    setPrefill((p) => ({ nonce: p.nonce + 1, vestingRecipient: address }));
    scrollTo(VESTING_CONTROLS_ANCHOR);
  }, []);

  const value = useMemo(
    () => ({ prefill, mintTo, transferTo, vestingRecipient }),
    [prefill, mintTo, transferTo, vestingRecipient],
  );

  return <EquityPrefillContext.Provider value={value}>{children}</EquityPrefillContext.Provider>;
}

export function useEquityPrefill(): EquityPrefillContextValue {
  const ctx = useContext(EquityPrefillContext);
  if (!ctx) {
    // Default no-op shape so components don't have to null-check —
    // outside the Equity page the prefill simply doesn't fire.
    return {
      prefill: { nonce: 0 },
      mintTo: () => {},
      transferTo: () => {},
      vestingRecipient: () => {},
    };
  }
  return ctx;
}

export const EQUITY_ANCHORS = {
  shareControls: SHARE_CONTROLS_ANCHOR,
  vestingControls: VESTING_CONTROLS_ANCHOR,
};
