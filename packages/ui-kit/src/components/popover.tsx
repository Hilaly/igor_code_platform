/**
 * Универсальный всплывающий контейнер Popover для произвольного содержимого.
 */

import { useEffect, useId, useRef, useState, type ReactNode } from "react";

import { FloatingLayer } from "./floating-layer.tsx";
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
  narrowBelow?: boolean;
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
  narrowBelow = false,
}: PopoverProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const open = controlledOpen ?? uncontrolledOpen;
  const popoverId = useId();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const anchorRef = useRef<HTMLElement | null>(null);
  const popupRef = useRef<HTMLDivElement | null>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);

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

  useEffect(() => {
    if (!open) return;

    function handlePointerDown(event: PointerEvent) {
      if (
        rootRef.current &&
        !rootRef.current.contains(event.target as Node) &&
        !popupRef.current?.contains(event.target as Node)
      ) {
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
    <div
      className={`${styles.root}${rootClassName ? ` ${rootClassName}` : ""}`}
      ref={(element) => {
        rootRef.current = element;
        anchorRef.current = element?.firstElementChild as HTMLElement | null;
      }}
    >
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
      <FloatingLayer
        open={open}
        anchorRef={anchorRef}
        layerRef={popupRef}
        side={side}
        offset={8}
        narrowBelow={narrowBelow}
        id={popoverId}
        className={`${styles.content}${contentClassName ? ` ${contentClassName}` : ""}`}
        role={contentRole}
        ariaLabel={ariaLabel}
      >
        {children}
      </FloatingLayer>
    </div>
  );
}
