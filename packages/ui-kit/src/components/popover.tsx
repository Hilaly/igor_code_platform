/**
 * Универсальный всплывающий контейнер Popover для произвольного содержимого.
 */

import { useEffect, useId, useRef, useState, type ReactNode } from "react";

import styles from "./popover.module.css";

export type PopoverSide = "top" | "bottom" | "left" | "right";

export type PopoverProps = {
  trigger: ReactNode;
  children: ReactNode;
  side?: PopoverSide;
  ariaLabel?: string;
};

export function Popover({ trigger, children, side = "bottom", ariaLabel }: PopoverProps) {
  const [open, setOpen] = useState(false);
  const popoverId = useId();
  const rootRef = useRef<HTMLDivElement | null>(null);

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
  }, [open]);

  return (
    <div className={styles.root} ref={rootRef}>
      <button
        type="button"
        className={styles.trigger}
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
        aria-controls={open ? popoverId : undefined}
      >
        {trigger}
      </button>
      {open ? (
        <div
          id={popoverId}
          className={`${styles.content} ${styles[side]}`}
          role="dialog"
          aria-label={ariaLabel}
        >
          {children}
        </div>
      ) : null}
    </div>
  );
}
