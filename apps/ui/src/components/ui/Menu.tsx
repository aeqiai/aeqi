import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Popover } from "./Popover";
import styles from "./Menu.module.css";

export interface MenuItem {
  key: string;
  label: string;
  icon?: ReactNode;
  destructive?: boolean;
  disabled?: boolean;
  onSelect: () => void;
  /** If set, first click shows this label and arms the item; second click fires onSelect. */
  confirmLabel?: string;
}

export interface MenuProps {
  trigger: ReactNode;
  items: MenuItem[];
  placement?: "bottom-start" | "bottom-end" | "top-start" | "top-end";
}

export function Menu({ trigger, items, placement = "bottom-end" }: MenuProps) {
  const [open, setOpen] = useState(false);
  const [armedKey, setArmedKey] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState<number>(-1);
  const menuId = useId();
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const close = useCallback(() => {
    setOpen(false);
    setArmedKey(null);
    setActiveIndex(-1);
  }, []);

  // Reset armed state when menu closes.
  useEffect(() => {
    if (!open) {
      setArmedKey(null);
      setActiveIndex(-1);
    }
  }, [open]);

  // Focus active item when activeIndex changes.
  useEffect(() => {
    if (activeIndex >= 0 && open) {
      itemRefs.current[activeIndex]?.focus();
    }
  }, [activeIndex, open]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const enabledIndices = items
        .map((item, idx) => (item.disabled ? -1 : idx))
        .filter((idx) => idx >= 0);

      if (e.key === "ArrowDown") {
        e.preventDefault();
        const current = enabledIndices.indexOf(activeIndex);
        const next = enabledIndices[(current + 1) % enabledIndices.length] ?? enabledIndices[0];
        if (next !== undefined) setActiveIndex(next);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        const current = enabledIndices.indexOf(activeIndex);
        const prev =
          enabledIndices[(current - 1 + enabledIndices.length) % enabledIndices.length] ??
          enabledIndices[enabledIndices.length - 1];
        if (prev !== undefined) setActiveIndex(prev);
      } else if (e.key === "Escape") {
        e.preventDefault();
        close();
      }
    },
    [items, activeIndex, close],
  );

  const handleItemClick = useCallback(
    (item: MenuItem) => {
      if (item.disabled) return;

      if (item.confirmLabel) {
        if (armedKey === item.key) {
          // Second click — fire.
          item.onSelect();
          close();
        } else {
          // First click — arm.
          setArmedKey(item.key);
        }
      } else {
        item.onSelect();
        close();
      }
    },
    [armedKey, close],
  );

  // Clicking outside an armed item resets the arm.
  const handleMenuMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (armedKey === null) return;
      const target = e.target as HTMLElement;
      const armedBtn = itemRefs.current[items.findIndex((i) => i.key === armedKey)];
      if (armedBtn && !armedBtn.contains(target)) {
        setArmedKey(null);
      }
    },
    [armedKey, items],
  );

  const menuContent = (
    <div
      id={menuId}
      role="menu"
      aria-label="Actions"
      tabIndex={-1}
      className={styles.menu}
      data-open={open || undefined}
      onKeyDown={handleKeyDown}
      onMouseDown={handleMenuMouseDown}
    >
      {items.map((item, idx) => {
        const isArmed = armedKey === item.key;
        const label = isArmed && item.confirmLabel ? item.confirmLabel : item.label;
        const cls = [
          styles.item,
          item.destructive ? styles.destructive : "",
          item.disabled ? styles.disabled : "",
          isArmed ? styles.armed : "",
        ]
          .filter(Boolean)
          .join(" ");

        return (
          <button
            key={item.key}
            ref={(el) => {
              itemRefs.current[idx] = el;
            }}
            role="menuitem"
            type="button"
            className={cls}
            disabled={item.disabled}
            aria-disabled={item.disabled}
            tabIndex={item.disabled ? -1 : 0}
            onClick={() => handleItemClick(item)}
            onMouseEnter={() => !item.disabled && setActiveIndex(idx)}
          >
            {item.icon && (
              <span className={styles.icon} aria-hidden>
                {item.icon}
              </span>
            )}
            <span className={styles.label}>{label}</span>
          </button>
        );
      })}
    </div>
  );

  return (
    <Popover trigger={trigger} open={open} onOpenChange={setOpen} placement={placement}>
      {menuContent}
    </Popover>
  );
}

Menu.displayName = "Menu";
