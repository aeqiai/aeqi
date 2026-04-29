import { useState, useId, useRef, useCallback, useEffect } from "react";
import { createPortal } from "react-dom";
import styles from "./Tooltip.module.css";

export interface TooltipProps {
  content: string;
  position?: "top" | "bottom" | "left" | "right";
  portal?: boolean;
  children: React.ReactNode;
}

export function Tooltip({ content, position = "top", portal = false, children }: TooltipProps) {
  const [visible, setVisible] = useState(false);
  const id = useId();
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const triggerRef = useRef<HTMLSpanElement>(null);
  const [bubbleCoords, setBubbleCoords] = useState({ top: 0, left: 0 });

  const show = useCallback(() => {
    timerRef.current = setTimeout(() => setVisible(true), 200);
  }, []);

  const hide = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setVisible(false);
  }, []);

  // Compute portal bubble position
  const computeCoords = useCallback(() => {
    if (!portal || !triggerRef.current) return;

    const triggerRect = triggerRef.current.getBoundingClientRect();
    let top = 0;
    let left = 0;

    switch (position) {
      case "top":
        top = triggerRect.top - 8 - 24; // gap + bubble height (approx)
        left = triggerRect.left + triggerRect.width / 2;
        break;
      case "bottom":
        top = triggerRect.bottom + 8;
        left = triggerRect.left + triggerRect.width / 2;
        break;
      case "left":
        top = triggerRect.top + triggerRect.height / 2;
        left = triggerRect.left - 8 - 50; // gap + bubble width (approx)
        break;
      case "right":
        top = triggerRect.top + triggerRect.height / 2;
        left = triggerRect.right + 8;
        break;
    }

    setBubbleCoords({ top, left });
  }, [portal, position]);

  useEffect(() => {
    if (!portal || !visible) return;

    computeCoords();

    const handleScroll = () => computeCoords();
    const handleResize = () => computeCoords();

    window.addEventListener("scroll", handleScroll, true); // capture phase
    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("scroll", handleScroll, true);
      window.removeEventListener("resize", handleResize);
    };
  }, [portal, visible, computeCoords]);

  const bubbleElement = (
    <span
      id={id}
      role="tooltip"
      className={[styles.bubble, styles[position], visible ? styles.visible : ""]
        .filter(Boolean)
        .join(" ")}
      style={
        portal
          ? {
              position: "fixed",
              top: `${bubbleCoords.top}px`,
              left: `${bubbleCoords.left}px`,
            }
          : undefined
      }
    >
      {content}
    </span>
  );

  return (
    <span
      ref={triggerRef}
      className={styles.wrapper}
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
    >
      <span aria-describedby={visible ? id : undefined}>{children}</span>
      {portal ? createPortal(bubbleElement, document.body) : bubbleElement}
    </span>
  );
}

Tooltip.displayName = "Tooltip";
