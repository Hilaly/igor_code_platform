/**
 * Текст и заголовок. Тон — это роль, а не цвет: компонент читает токены, потому что перекрасить его
 * извне платформа не может (docs/ui-kit.md).
 */

import type { ReactNode } from "react";

import styles from "./text.module.css";

export type TextTone = "normal" | "muted" | "accent" | "danger" | "warning" | "success";

export type TextProps = {
  tone?: TextTone;
  children: ReactNode;
};

export function Text({ tone = "normal", children }: TextProps) {
  return <span className={styles[tone]}>{children}</span>;
}

export type HeadingProps = {
  /** Уровень задаёт и разметку, и размер: заголовок панели не должен быть `h1` ради кегля. */
  level: 1 | 2 | 3;
  children: ReactNode;
};

export function Heading({ level, children }: HeadingProps) {
  const className = `${styles.heading} ${styles[`h${level}`]}`;

  if (level === 1) {
    return <h1 className={className}>{children}</h1>;
  }

  return level === 2 ? (
    <h2 className={className}>{children}</h2>
  ) : (
    <h3 className={className}>{children}</h3>
  );
}
