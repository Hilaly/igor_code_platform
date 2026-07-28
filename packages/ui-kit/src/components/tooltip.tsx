/**
 * Подсказка при наведении и при фокусе. Целиком на CSS: ни состояния, ни портала, ни измерений — обёртка
 * позиционирует пузырь собой, а показывает его `:hover` и `:focus-within`. Состояние в React означало бы
 * перерисовку на каждое движение мыши, портал — расчёт координат вручную; за это платят те, кому нужно
 * вырваться из обрезающего предка, а подсказка живёт вплотную к своему элементу.
 *
 * Пузырь в разметке всегда, поэтому скринридер читает его вместе с элементом-триггером. Показ по фокусу
 * работает только если триггер сам умеет принимать фокус: у нарисованной картинки подсказки не будет.
 */

import type { ReactNode } from "react";

import styles from "./tooltip.module.css";

/** Сторона — пожелание: пузырь не измеряет окно и за его край не заглядывает. */
export type TooltipSide = "top" | "bottom" | "left" | "right";

export type TooltipProps = {
  /** Текст подсказки, уже переведённый. */
  content: string;
  side?: TooltipSide;
  /** Элемент, к которому подсказка привязана. */
  children: ReactNode;
};

export function Tooltip({ content, side = "top", children }: TooltipProps) {
  return (
    <span className={styles.wrap}>
      {children}
      <span className={`${styles.tip} ${styles[side]}`} role="tooltip">
        {content}
      </span>
    </span>
  );
}
