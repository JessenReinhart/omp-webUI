import { useCallback, useEffect, useRef, useState } from "react";

export interface ResizableSidebarOptions {
  /** localStorage key used to persist the sidebar width. */
  storageKey: string;
  /** Smallest allowed width in px. */
  min: number;
  /** Largest allowed width in px. */
  max: number;
  /** Width used when nothing valid is stored. */
  fallback: number;
}

export interface ResizableSidebarHandleProps {
  role: "separator";
  "aria-orientation": "vertical";
  "aria-valuemin": number;
  "aria-valuemax": number;
  "aria-valuenow": number;
  tabIndex: 0;
  onPointerDown: (event: React.PointerEvent<HTMLDivElement>) => void;
  onPointerMove: (event: React.PointerEvent<HTMLDivElement>) => void;
  onPointerUp: (event: React.PointerEvent<HTMLDivElement>) => void;
  onPointerCancel: (event: React.PointerEvent<HTMLDivElement>) => void;
  onKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => void;
}

export interface ResizableSidebarState {
  width: number;
  dragging: boolean;
  handleProps: ResizableSidebarHandleProps;
}

const KEYBOARD_STEP = 16;

function clampWidth(width: number, min: number, max: number) {
  const viewportMax = Math.min(max, Math.floor(window.innerWidth * 0.4));
  return Math.min(Math.max(width, min), Math.max(min, viewportMax));
}

/**
 * Pointer + keyboard driven resizable sidebar width.
 *
 * The live width is mirrored onto the `--sidebar-w` custom property on
 * `document.documentElement` so the app-shell grid tracks it without re-render,
 * and the final value is persisted to localStorage on pointer-up / keyboard
 * commit. Storage failures are contained (private mode, quota) — resizing
 * still works, it just won't survive a reload.
 */
export function useResizableSidebar(options: ResizableSidebarOptions): ResizableSidebarState {
  const { storageKey, min, max, fallback } = options;
  const [width, setWidth] = useState(fallback);
  const [dragging, setDragging] = useState(false);
  const dragStartRef = useRef<{ startX: number; startWidth: number } | null>(null);

  const applyWidth = useCallback(
    (next: number) => {
      setWidth(next);
      document.documentElement.style.setProperty("--sidebar-w", `${next}px`);
    },
    [],
  );

  // Restore the persisted width on mount, validating it against the range.
  useEffect(() => {
    let stored: number | null = null;
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (raw !== null) {
        const parsed = Number(raw);
        if (Number.isFinite(parsed) && parsed >= min && parsed <= max) stored = parsed;
      }
    } catch {
      stored = null;
    }
    applyWidth(stored ?? fallback);
    return () => {
      document.documentElement.style.removeProperty("--sidebar-w");
    };
  }, [applyWidth, fallback, max, min, storageKey]);

  const persist = useCallback(
    (value: number) => {
      try {
        window.localStorage.setItem(storageKey, String(value));
      } catch {
        // Storage unavailable (private mode/quota): keep the live width only.
      }
    },
    [storageKey],
  );

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      dragStartRef.current = { startX: event.clientX, startWidth: width };
      setDragging(true);
    },
    [width],
  );

  const handlePointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const start = dragStartRef.current;
      if (!start) return;
      applyWidth(clampWidth(start.startWidth + event.clientX - start.startX, min, max));
    },
    [applyWidth, max, min],
  );

  const handlePointerUp = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!dragStartRef.current) return;
      dragStartRef.current = null;
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      setDragging(false);
      setWidth((current) => {
        persist(current);
        return current;
      });
    },
    [persist],
  );

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      let next: number | null = null;
      if (event.key === "ArrowLeft") next = width - KEYBOARD_STEP;
      else if (event.key === "ArrowRight") next = width + KEYBOARD_STEP;
      else if (event.key === "Home") next = min;
      else if (event.key === "End") next = max;
      if (next === null) return;
      event.preventDefault();
      const clamped = clampWidth(next, min, max);
      applyWidth(clamped);
      persist(clamped);
    },
    [applyWidth, max, min, persist, width],
  );

  const handleProps: ResizableSidebarHandleProps = {
    role: "separator",
    "aria-orientation": "vertical",
    "aria-valuemin": min,
    "aria-valuemax": max,
    "aria-valuenow": width,
    tabIndex: 0,
    onPointerDown: handlePointerDown,
    onPointerMove: handlePointerMove,
    onPointerUp: handlePointerUp,
    onPointerCancel: handlePointerUp,
    onKeyDown: handleKeyDown,
  };

  return { width, dragging, handleProps };
}
