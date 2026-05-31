import { useCallback, useLayoutEffect, useRef, useState } from "react";
import type { PointerEvent, ReactNode, WheelEvent } from "react";
import { LocateFixed, Minus, Plus } from "lucide-react";
import { IconButton } from "@/components/ui";

const ZOOM_MIN = 0.25;
const ZOOM_MAX = 4;
const FIT_TRANSFORM = { scale: 1, tx: 0, ty: 0 };

interface CompanyGraphZoomViewportProps {
  children: ReactNode;
  width: number;
  height: number;
}

export default function CompanyGraphZoomViewport({
  children,
  width,
  height,
}: CompanyGraphZoomViewportProps) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{
    startX: number;
    startY: number;
    startTx: number;
    startTy: number;
  } | null>(null);
  const [transform, setTransform] = useState(FIT_TRANSFORM);
  const hasFit = useRef(false);

  const applyFit = useCallback(() => {
    const viewport = viewportRef.current;
    const inner = innerRef.current;
    if (!viewport || !inner) return;
    const vw = viewport.clientWidth;
    if (width === 0 || height === 0) return;
    const minReadableScale = vw < 560 ? 0.7 : 0.82;
    const scale = Math.min(1, Math.max(minReadableScale, (vw - 48) / width));
    const tx = width * scale > vw ? 24 : (vw - width * scale) / 2;
    const ty = 42;
    setTransform({ scale, tx, ty });
    hasFit.current = true;
  }, [height, width]);

  useLayoutEffect(() => {
    hasFit.current = false;
    const inner = innerRef.current;
    if (!inner) return;
    const ro = new ResizeObserver(() => {
      if (hasFit.current) {
        ro.disconnect();
        return;
      }
      applyFit();
      if (hasFit.current) ro.disconnect();
    });
    ro.observe(inner);
    return () => ro.disconnect();
  }, [applyFit, width, height]);

  const clampedScale = useCallback(
    (next: number) => Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, next)),
    [],
  );

  const onWheel = useCallback(
    (event: WheelEvent<HTMLDivElement>) => {
      event.preventDefault();
      const viewport = viewportRef.current;
      if (!viewport) return;
      const rect = viewport.getBoundingClientRect();
      const mx = event.clientX - rect.left;
      const my = event.clientY - rect.top;

      setTransform((prev) => {
        const factor = event.deltaY < 0 ? 1.1 : 1 / 1.1;
        const next = clampedScale(prev.scale * factor);
        const ratio = next / prev.scale;
        return {
          scale: next,
          tx: mx - ratio * (mx - prev.tx),
          ty: my - ratio * (my - prev.ty),
        };
      });
    },
    [clampedScale],
  );

  const onPointerDown = useCallback((event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const target = event.target as HTMLElement;
    if (target.closest(".company-context-map-node")) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    setTransform((prev) => {
      dragRef.current = {
        startX: event.clientX,
        startY: event.clientY,
        startTx: prev.tx,
        startTy: prev.ty,
      };
      return prev;
    });
  }, []);

  const onPointerMove = useCallback((event: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    setTransform((prev) => ({
      ...prev,
      tx: drag.startTx + dx,
      ty: drag.startTy + dy,
    }));
  }, []);

  const onPointerUp = useCallback(() => {
    dragRef.current = null;
  }, []);

  const zoomAtCenter = useCallback(
    (factor: number) => {
      const viewport = viewportRef.current;
      if (!viewport) return;
      const cx = viewport.clientWidth / 2;
      const cy = viewport.clientHeight / 2;
      setTransform((prev) => {
        const next = clampedScale(prev.scale * factor);
        const ratio = next / prev.scale;
        return {
          scale: next,
          tx: cx - ratio * (cx - prev.tx),
          ty: cy - ratio * (cy - prev.ty),
        };
      });
    },
    [clampedScale],
  );

  const resetFit = useCallback(() => {
    hasFit.current = false;
    setTransform(FIT_TRANSFORM);
    requestAnimationFrame(applyFit);
  }, [applyFit]);

  const isDragging = dragRef.current !== null;

  return (
    <div
      ref={viewportRef}
      className="company-context-map-viewport"
      onWheel={onWheel}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      style={{ cursor: isDragging ? "grabbing" : "grab" }}
    >
      <div
        ref={innerRef}
        className="company-context-map-inner"
        style={{
          transform: `translate(${transform.tx}px, ${transform.ty}px) scale(${transform.scale})`,
        }}
      >
        {children}
      </div>

      <div className="company-context-map-controls" role="toolbar" aria-label="Zoom controls">
        <IconButton
          aria-label="Zoom in"
          variant="bordered"
          size="xs"
          onClick={() => zoomAtCenter(1.25)}
        >
          <Plus aria-hidden />
        </IconButton>
        <IconButton
          aria-label="Zoom out"
          variant="bordered"
          size="xs"
          onClick={() => zoomAtCenter(1 / 1.25)}
        >
          <Minus aria-hidden />
        </IconButton>
        <IconButton aria-label="Reset zoom to fit" variant="bordered" size="xs" onClick={resetFit}>
          <LocateFixed aria-hidden />
        </IconButton>
      </div>
    </div>
  );
}
