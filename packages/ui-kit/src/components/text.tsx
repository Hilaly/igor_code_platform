/**
 * Текст и заголовок. Тон — это роль, а не цвет: компонент читает токены, потому что перекрасить его
 * извне платформа не может (ADR-0028).
 */

import type { ReactNode } from "react";

export type TextTone = "normal" | "muted" | "accent" | "danger" | "warning" | "success";

export type TextProps = {
  tone?: TextTone;
  children: ReactNode;
};

export function Text({ tone = "normal", children }: TextProps) {
  return <span className={`sv-text sv-text-${tone}`}>{children}</span>;
}

export type HeadingProps = {
  /** Уровень задаёт и разметку, и размер: заголовок панели не должен быть `h1` ради кегля. */
  level: 1 | 2 | 3;
  children: ReactNode;
};

export function Heading({ level, children }: HeadingProps) {
  const className = `sv-heading sv-heading-${level}`;

  if (level === 1) {
    return <h1 className={className}>{children}</h1>;
  }

  return level === 2 ? (
    <h2 className={className}>{children}</h2>
  ) : (
    <h3 className={className}>{children}</h3>
  );
}
