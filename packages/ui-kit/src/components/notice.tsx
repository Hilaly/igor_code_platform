/**
 * Врезка для диагностики: непереведённый ключ, отказ схемы, причина, по которой плагин не поднялся.
 * Диагностика обязана быть видна в интерфейсе — журнал демона живёт в терминале и наружу не отдаётся
 * (docs/logging.md).
 */

import type { ReactNode } from "react";

import styles from "./notice.module.css";

export type NoticeTone = "info" | "warning" | "danger";

export type NoticeProps = {
  tone: NoticeTone;
  title: string;
  children?: ReactNode;
};

export function Notice({ tone, title, children }: NoticeProps) {
  return (
    <div className={`${styles.notice} ${styles[tone]}`} role={tone === "info" ? "status" : "alert"}>
      <strong className={styles.title}>{title}</strong>
      {children === undefined ? undefined : <div className={styles.body}>{children}</div>}
    </div>
  );
}
