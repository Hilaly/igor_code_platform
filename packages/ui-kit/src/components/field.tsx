/**
 * Обвязка контрола: метка, подсказка и текст ошибки. Обвязка владеет идентификаторами, поэтому связь
 * «метка — контрол» и `aria-describedby` не зависят от того, вспомнил ли о них вызывающий.
 *
 * Контрол приходит рендер-пропом, а не элементом-ребёнком, которому обвязка допишет пропсы. Клонировать
 * чужой элемент значит лезть в его внутренности: обвязка обязана знать, как у него называются `id` и
 * признак невалидности, и молча промахивается на любом контроле, названном иначе. Рендер-проп отдаёт
 * вызывающему готовый набор и оставляет проставление ему — промах виден компилятором, а не глазами.
 */

import type { ReactNode } from "react";
import { useId } from "react";

import styles from "./field.module.css";

/** Что контрол обязан проставить на себе, чтобы обвязка вокруг него имела смысл. */
export type FieldControlProps = {
  id: string;
  describedBy: string | undefined;
  invalid: boolean;
};

/** `row` — метка слева от контрола: плотные формы настроек, где вертикаль дороже ширины. */
export type FieldLayout = "stack" | "row";

export type FieldProps = {
  label: string;
  /** Что ввести. Показывается всегда, а не только после ошибки. */
  hint?: string;
  /**
   * Причина отказа. Её наличие само помечает контрол невалидным: расходиться им нельзя. Пустая строка
   * — это отсутствие причины, а не безымянная ошибка: вызывающий почти всегда считает её выражением
   * вида `condition ? "текст" : ""`, и понимать её как отказ значит красить пустую форму в красное.
   */
  error?: string;
  layout?: FieldLayout;
  /** Идентификаторы описаний, которые вызывающий держит сам; обвязка добавит к ним свои. */
  describedBy?: string;
  children: (control: FieldControlProps) => ReactNode;
};

/**
 * Склейка `aria-describedby`: атрибут принимает список идентификаторов через пробел, а собирается он
 * из трёх источников, любой из которых может отсутствовать или повториться. Повтор здесь не безобиден
 * — скринридер прочитает описание дважды.
 */
export function mergeDescribedBy(...lists: (string | undefined)[]): string | undefined {
  const identifiers = new Set(lists.flatMap((list) => list?.split(/\s+/).filter(Boolean) ?? []));

  return identifiers.size === 0 ? undefined : [...identifiers].join(" ");
}

export function Field({ label, hint, error, layout = "stack", describedBy, children }: FieldProps) {
  const baseId = useId();
  const controlId = `${baseId}-control`;
  const shownHint = hint === undefined || hint.trim() === "" ? undefined : hint;
  const shownError = error === undefined || error.trim() === "" ? undefined : error;
  const hintId = shownHint === undefined ? undefined : `${baseId}-hint`;
  const errorId = shownError === undefined ? undefined : `${baseId}-error`;

  return (
    <div className={`${styles.field} ${styles[layout]}`}>
      <label className={styles.label} htmlFor={controlId}>
        {label}
      </label>
      <div className={styles.content}>
        {children({
          id: controlId,
          describedBy: mergeDescribedBy(describedBy, hintId, errorId),
          invalid: shownError !== undefined,
        })}
        {shownHint === undefined ? undefined : (
          <div className={styles.hint} id={hintId}>
            {shownHint}
          </div>
        )}
        {shownError === undefined ? undefined : (
          <div className={styles.error} id={errorId}>
            {shownError}
          </div>
        )}
      </div>
    </div>
  );
}
