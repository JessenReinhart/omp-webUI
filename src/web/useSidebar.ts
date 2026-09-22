import { useCallback, useEffect, useRef, useState } from "react";

export interface UseSidebarOptions {
  storageKeyWidth?: string;
  storageKeyCollapsed?: string;
  minWidth?: number;
  maxWidth?: number;
  fallbackWidth?: number;
}

export interface SidebarHandleProps {
  role: "separator";
  "aria-orientation": "vertical";
  "aria-valuemin": number;
  "aria-valuemax": number;
  "aria-valuenow": number;
  tabIndex: 0;
  onPointerDown: (event: React.PointerEvent<HTMLDivElement>) => void;
  onKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => void;
}

export interface UseSidebarResult {
  width: number;
  collapsed: boolean;
  dragging: boolean;
  setCollapsed: (collapsed: boolean | ((prev: boolean) => boolean)) => void;
  toggleCollapse: () => void;
  handleProps: SidebarHandleProps;
}

const KEYBOARD_STEP = 16;

function clampWidth(width: number, min: number, max: number): number {
  const viewportMax = Math.max(min, Math.min(max, Math.floor(window.innerWidth * 0.7)));
  return Math.min(Math.max(width, min), viewportMax);
}

export function useSidebar(options: UseSidebarOptions = {}): UseSidebarResult {
  const {
    storageKeyWidth = "omp.webui.sidebar-width",
    storageKeyCollapsed = "omp.webui.sidebar-collapsed",
    minWidth = 240,
    maxWidth = 720,
    fallbackWidth = 300,
  } = options;

  const [width, setWidth] = useState<number>(fallbackWidth);
  const [collapsed, setCollapsedState] = useState<boolean>(false);
  const [dragging, setDragging] = useState<boolean>(false);

  const dragStartRef = useRef<{ startX: number; startWidth: number } | null>(null);
  const widthRef = useRef(width);
  widthRef.current = width;

  const applyWidth = useCallback(
    (next: number) => {
      setWidth(next);
      document.documentElement.style.setProperty("--sidebar-w", `${next}px`);
    },
    [],
  );

  const setCollapsed = useCallback(
    (nextVal: boolean | ((prev: boolean) => boolean)) => {
      setCollapsedState((prev) => {
        const resolved = typeof nextVal === "function" ? nextVal(prev) : nextVal;
        try {
          window.localStorage.setItem(storageKeyCollapsed, String(resolved));
        } catch {
          // localStorage disabled or unavailable
        }
        return resolved;
      });
    },
    [storageKeyCollapsed],
  );

  const toggleCollapse = useCallback(() => {
    setCollapsed((prev) => !prev);
  }, [setCollapsed]);

  // Restore stored width and collapsed state on mount
  useEffect(() => {
    let storedWidth: number | null = null;
    let storedCollapsed: boolean | null = null;
    try {
      const rawWidth = window.localStorage.getItem(storageKeyWidth);
      if (rawWidth !== null) {
        const parsed = Number(rawWidth);
        if (Number.isFinite(parsed) && parsed >= minWidth && parsed <= maxWidth) {
          storedWidth = parsed;
        }
      }
      const rawCollapsed = window.localStorage.getItem(storageKeyCollapsed);
      if (rawCollapsed !== null) {
        storedCollapsed = rawCollapsed === "true";
      }
    } catch {
      storedWidth = null;
      storedCollapsed = null;
    }

    applyWidth(storedWidth ?? fallbackWidth);
    if (storedCollapsed !== null) {
      setCollapsedState(storedCollapsed);
    }

    return () => {
      document.documentElement.style.removeProperty("--sidebar-w");
    };
  }, [applyWidth, fallbackWidth, maxWidth, minWidth, storageKeyCollapsed, storageKeyWidth]);

  const persistWidth = useCallback(
    (val: number) => {
      try {
        window.localStorage.setItem(storageKeyWidth, String(val));
      } catch {
        // quota / private mode
      }
    },
    [storageKeyWidth],
  );

  // Robust window-level pointer tracking for resize
  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      dragStartRef.current = { startX: event.clientX, startWidth: widthRef.current };
      setDragging(true);

      const onPointerMove = (e: PointerEvent) => {
        const start = dragStartRef.current;
        if (!start) return;
        const next = clampWidth(start.startWidth + e.clientX - start.startX, minWidth, maxWidth);
        applyWidth(next);
      };

      const onPointerUp = () => {
        if (!dragStartRef.current) return;
        dragStartRef.current = null;
        window.removeEventListener("pointermove", onPointerMove);
        window.removeEventListener("pointerup", onPointerUp);
        window.removeEventListener("pointercancel", onPointerUp);
        setDragging(false);
        persistWidth(widthRef.current);
      };

      window.addEventListener("pointermove", onPointerMove);
      window.addEventListener("pointerup", onPointerUp);
      window.addEventListener("pointercancel", onPointerUp);
    },
    [applyWidth, maxWidth, minWidth, persistWidth],
  );

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      let next: number | null = null;
      if (event.key === "ArrowLeft") next = width - KEYBOARD_STEP;
      else if (event.key === "ArrowRight") next = width + KEYBOARD_STEP;
      else if (event.key === "Home") next = minWidth;
      else if (event.key === "End") next = maxWidth;
      if (next === null) return;
      event.preventDefault();
      const clamped = clampWidth(next, minWidth, maxWidth);
      applyWidth(clamped);
      persistWidth(clamped);
    },
    [applyWidth, maxWidth, minWidth, persistWidth, width],
  );

  // Global Ctrl+B / Cmd+B shortcut
  useEffect(() => {
    const handleGlobalKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === "b" || e.key === "B")) {
        const target = e.target as HTMLElement | null;
        if (
          target &&
          (target.tagName === "INPUT" ||
            target.tagName === "TEXTAREA" ||
            target.isContentEditable)
        ) {
          return;
        }
        e.preventDefault();
        toggleCollapse();
      }
    };
    window.addEventListener("keydown", handleGlobalKey);
    return () => window.removeEventListener("keydown", handleGlobalKey);
  }, [toggleCollapse]);

  const handleProps: SidebarHandleProps = {
    role: "separator",
    "aria-orientation": "vertical",
    "aria-valuemin": minWidth,
    "aria-valuemax": maxWidth,
    "aria-valuenow": width,
    tabIndex: 0,
    onPointerDown: handlePointerDown,
    onKeyDown: handleKeyDown,
  };

  return {
    width,
    collapsed,
    dragging,
    setCollapsed,
    toggleCollapse,
    handleProps,
  };
}
