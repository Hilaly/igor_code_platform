/**
 * Значок состояния: состояние плагина, состояние соединения. Тон — роль, а не цвет; сам текст
 * приходит переведённым, потому что кит не знает, в каком неймспейсе лежит эта строка.
 */

import styles from "./badge.module.css";

export type BadgeTone = "neutral" | "accent" | "success" | "warning" | "danger";

export type BadgeProps = {
  tone: BadgeTone;
  children: string;
};

export function Badge({ tone, children }: BadgeProps) {
  return <span className={`${styles.badge} ${styles[tone]}`}>{children}</span>;
}
