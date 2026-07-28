/**
 * Полоса выполнения. Без значения — неопределённый режим: полоса бежит, но `aria-value*` нет вовсе, и
 * скринридер сообщает «идёт», а не «ноль процентов». Это разные утверждения, и врать вторым нельзя.
 */

import type { CSSProperties } from "react";

import styles from "./progress.module.css";

export type ProgressTone = "accent" | "success" | "warning" | "danger";

export type ProgressProps = {
  /** Доля выполненного, 0..1. Без значения полоса переходит в неопределённый режим. */
  value?: number;
  tone?: ProgressTone;
  /** Что именно выполняется: `aria-label` дорожки. Полоса без подписи ничего не сообщает. */
  label: string;
};

/**
 * Зажим доли. Значение приезжает из расчёта вызывающего — «сделано из всего», — а тот даёт и больше
 * единицы (пересчитали план), и `NaN` (всего оказалось ноль). Полоса шире дорожки и подпись «NaN
 * процентов» — отказ интерфейса, поэтому оба случая сводятся к границам здесь, а не у каждого
 * вызывающего по-своему.
 */
export function clampProgressValue(value: number): number {
  if (Number.isNaN(value)) {
    return 0;
  }

  return Math.min(1, Math.max(0, value));
}

/** Доля в процентах для `aria-valuenow`: скринридер читает целое, а не пятнадцать знаков после точки. */
export function progressPercent(value: number): number {
  return Math.round(clampProgressValue(value) * 100);
}

export function Progress({ value, tone = "accent", label }: ProgressProps) {
  if (value === undefined) {
    return (
      <div
        className={`${styles.track} ${styles.indeterminate} ${styles[tone]}`}
        role="progressbar"
        aria-label={label}
      >
        <div className={styles.bar} />
      </div>
    );
  }

  const percent = progressPercent(value);
  // Доля уезжает в CSS переменной, а не шириной в `style`: ширину полосы считает сам стиль, и он же
  // владеет переходом между значениями. Имя без префикса `--sovereign-`: переменная живёт на этом
  // элементе, а не среди ролей на корне документа.
  const fill = { "--progress": `${percent}%` } as CSSProperties;

  return (
    <div
      className={`${styles.track} ${styles[tone]}`}
      style={fill}
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
    >
      <div className={styles.bar} />
    </div>
  );
}
