/**
 * Универсальный всплывающий контейнер Popover для произвольного содержимого.
 */

import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";

import styles from "./popover.module.css";

export type PopoverSide = "top" | "bottom" | "left" | "right";

export type PopoverProps = {
  trigger?: ReactNode;
  renderTrigger?: (props: { contentId: string; open: boolean; toggle: () => void }) => ReactNode;
  children: ReactNode;
  side?: PopoverSide;
  ariaLabel?: string;
  contentRole?: "dialog" | "listbox" | "menu" | "tree";
  rootClassName?: string;
  contentClassName?: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  viewportSafe?: boolean;
};

export function Popover({
  trigger,
  renderTrigger,
  children,
  side = "bottom",
  ariaLabel,
  contentRole = "dialog",
  rootClassName,
  contentClassName,
  open: controlledOpen,
  onOpenChange,
  viewportSafe = false,
}: PopoverProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const open = controlledOpen ?? uncontrolledOpen;
  const popoverId = useId();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const [resolvedSide, setResolvedSide] = useState(side);
  const [viewportStyle, setViewportStyle] = useState<React.CSSProperties | undefined>();

  const setOpen = (next: boolean): void => {
    if (next && !open && typeof document !== "undefined") {
      restoreFocusRef.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
    }
    if (controlledOpen === undefined) {
      setUncontrolledOpen(next);
    }
    onOpenChange?.(next);
    if (!next) restoreFocusRef.current?.focus();
  };

  const toggle = (): void => setOpen(!open);

  useLayoutEffect(() => {
    if (!open || !viewportSafe || typeof window === "undefined") return;
    const resolveSide = (): void => {
      const root = rootRef.current;
      const content = root?.querySelector<HTMLElement>(`[role="${contentRole}"]`);
      const trigger = root?.firstElementChild as HTMLElement | null;
      if (!root || !content || !trigger) return;
      const triggerRect = trigger.getBoundingClientRect();
      const contentRect = content.getBoundingClientRect();
      const roomRight = window.innerWidth - triggerRect.right;
      const roomLeft = triggerRect.left;
      const width = Math.min(contentRect.width, Math.max(0, window.innerWidth - 16));
      const height = Math.min(contentRect.height, Math.max(0, window.innerHeight - 16));
      content.style.maxWidth = `${width}px`;
      content.style.maxHeight = `${height}px`;
      const gap = 8;
      const preferredLeft =
        side === "left" ? triggerRect.left - width - gap : triggerRect.right + gap;
      const horizontalLeft =
        side === "right" && roomRight >= width
          ? preferredLeft
          : side === "left" && roomLeft >= width
            ? preferredLeft
            : Math.max(gap, Math.min(preferredLeft, window.innerWidth - width - gap));
      const preferredTop = side === "top" ? triggerRect.top - height - gap : triggerRect.top;
      const top = Math.max(gap, Math.min(preferredTop, window.innerHeight - height - gap));
      setViewportStyle({
        position: "fixed",
        left: `${horizontalLeft}px`,
        top: `${top}px`,
        transform: "none",
      });
      if (side === "right" && roomRight < contentRect.width && roomLeft >= contentRect.width) {
        setResolvedSide("left");
      } else if (
        side === "left" &&
        roomLeft < contentRect.width &&
        roomRight >= contentRect.width
      ) {
        setResolvedSide("right");
      } else {
        setResolvedSide(side);
      }
    };
    resolveSide();
    window.addEventListener("resize", resolveSide);
    return () => window.removeEventListener("resize", resolveSide);
  }, [contentRole, open, side, viewportSafe]);

  useEffect(() => {
    if (!open) return;

    function handlePointerDown(event: PointerEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open, onOpenChange]);

  return (
    <div className={`${styles.root}${rootClassName ? ` ${rootClassName}` : ""}`} ref={rootRef}>
      {renderTrigger === undefined ? (
        <button
          type="button"
          className={styles.trigger}
          onClick={toggle}
          aria-expanded={open}
          aria-controls={open ? popoverId : undefined}
        >
          {trigger}
        </button>
      ) : (
        renderTrigger({ contentId: popoverId, open, toggle })
      )}
      {open ? (
        <div
          id={popoverId}
          className={`${styles.content} ${styles[resolvedSide]}${contentClassName ? ` ${contentClassName}` : ""}`}
          data-side={resolvedSide}
          style={viewportSafe ? viewportStyle : undefined}
          role={contentRole}
          aria-label={ariaLabel}
        >
          {children}
        </div>
      ) : null}
    </div>
  );
}
