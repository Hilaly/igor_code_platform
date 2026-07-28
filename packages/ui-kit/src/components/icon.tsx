/** Примитив иконки со стандартизированными размерами и доступностью. */

import type { ReactNode } from "react";

import styles from "./icon.module.css";

export type IconSize = "xs" | "sm" | "md" | "lg" | "xl";

export type IconProps = {
  size?: IconSize;
  /** Текст доступности для скринридера; если не задан, иконка декоративная (aria-hidden). */
  label?: string;
  className?: string;
  children: ReactNode;
};

export function Icon({ size = "md", label, className, children }: IconProps) {
  const isDecorative = !label;

  return (
    <span
      className={`${styles.icon} ${styles[size]}${className ? ` ${className}` : ""}`}
      role={isDecorative ? undefined : "img"}
      aria-label={label}
      aria-hidden={isDecorative ? true : undefined}
    >
      {children}
    </span>
  );
}
