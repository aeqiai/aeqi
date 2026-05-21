/**
 * `useTableRowHighlight` — apply a `data-quorum-selected="true"`
 * attribute to a Table primitive's selected row without forking the
 * primitive.
 *
 * Looks up `tbody tr[data-row-key]` children of the passed-in wrapper
 * ref and toggles the attr to match `selectedKey`. Scrolls the marked
 * row into view via `nearest` block alignment so arrow-key driven
 * selection feels responsive without jolting the viewport.
 *
 * Lifted out of `QuorumPage.proposals-section.tsx` for the 600-line
 * lint cap. The hook is intentionally specific to the quorum-style
 * highlight; if another page needs the same pattern it can rename and
 * promote to a shared place.
 */
import { useEffect, type RefObject } from "react";

export function useTableRowHighlight(
  wrapperRef: RefObject<HTMLElement | null>,
  selectedKey: string | null,
  deps: ReadonlyArray<unknown>,
): void {
  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;
    const trs = wrapper.querySelectorAll<HTMLTableRowElement>("tbody tr[data-row-key]");
    let hit: HTMLTableRowElement | null = null;
    for (const tr of Array.from(trs)) {
      const match = selectedKey !== null && tr.dataset.rowKey === selectedKey;
      if (match) {
        tr.setAttribute("data-quorum-selected", "true");
        hit = tr;
      } else {
        tr.removeAttribute("data-quorum-selected");
      }
    }
    if (hit !== null) {
      hit.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedKey, wrapperRef, ...deps]);
}
