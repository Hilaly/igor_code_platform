/**
 * Подсказка при наведении и при фокусе. Целиком на CSS: ни состояния, ни портала, ни измерений — обёртка
 * позиционирует пузырь собой, а показывает его `:hover` и `:focus-within`. Состояние в React означало бы
 * перерисовку на каждое движение мыши, портал — расчёт координат вручную; за это платят те, кому нужно
 * вырваться из обрезающего предка, а подсказка живёт вплотную к своему элементу.
 *
 * Пузырь в разметке всегда, поэтому скринридер читает его вместе с элементом-триггером. Показ по фокусу
 * работает только если триггер сам умеет принимать фокус: у нарисованной картинки подсказки не будет.
 */

import { cloneElement, isValidElement, useId, type ReactNode } from "react";

import styles from "./tooltip.module.css";

/** Сторона — пожелание: пузырь не измеряет окно и за его край не заглядывает. */
export type TooltipSide = "top" | "bottom" | "left" | "right";

export type TooltipProps = {
  /** Текст подсказки, уже переведённый. */
  content: string;
  /** Явный id нужен, когда описание связано с фокусируемым предком триггера. */
  id?: string;
  side?: TooltipSide;
  /** Элемент, к которому подсказка привязана. */
  children: ReactNode;
};

export function Tooltip({ content, id, side = "top", children }: TooltipProps) {
  const generatedId = useId();
  const tooltipId = id ?? generatedId;
  const trigger = isValidElement(children)
    ? cloneElement(children, {
        "aria-describedby": (children.props as { "aria-describedby"?: string })["aria-describedby"]
          ? `${(children.props as { "aria-describedby"?: string })["aria-describedby"]} ${tooltipId}`
          : tooltipId,
      } as Record<string, unknown>)
    : children;

  return (
    <span className={styles.wrap}>
      {trigger}
      <span className={`${styles.tip} ${styles[side]}`} id={tooltipId} role="tooltip">
        {content}
      </span>
    </span>
  );
}
