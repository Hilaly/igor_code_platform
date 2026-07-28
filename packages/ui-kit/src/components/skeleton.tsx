/**
 * Заглушка на месте того, что ещё грузится. Декоративная целиком: `aria-hidden`, без `role="status"` —
 * форма будущего содержимого не сообщает ничего, а роль заставила бы скринридер читать пустоту. О самой
 * загрузке сообщает тот, кто её ведёт (`Spinner` в state.tsx).
 */

import type { CSSProperties } from "react";

import styles from "./skeleton.module.css";

/** `text` — строка текста, `rect` — блок, `circle` — аватар или значок. */
export type SkeletonVariant = "text" | "rect" | "circle";

export type SkeletonProps = {
  variant?: SkeletonVariant;
  /** Размер значением CSS: заглушка повторяет размер того, что встанет на её место. */
  width?: string;
  height?: string;
};

export function Skeleton({ variant = "rect", width, height }: SkeletonProps) {
  const size: CSSProperties = { width, height };

  return (
    <span className={`${styles.skeleton} ${styles[variant]}`} style={size} aria-hidden="true" />
  );
}
