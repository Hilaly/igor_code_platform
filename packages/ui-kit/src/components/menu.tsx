/**
 * Меню действий: кнопка-триггер и всплывающий список пунктов. Пункты приходят данными, как и вкладки, —
 * порядок обхода стрелками тогда известен из массива, а не из документа.
 *
 * Пункт — нативная кнопка, а не наш `Button`: тому нужны и `role="menuitem"`, и ссылка на элемент для
 * перевода фокуса, а его поверхность не принимает ни того, ни другого.
 */

import { useEffect, useId, useRef, useState } from "react";

import styles from "./menu.module.css";
import { nextEnabledIndex } from "./roving-focus.ts";

/** Опасный пункт выделен цветом: удаление в списке действий не должно выглядеть как остальные. */
export type MenuItemTone = "normal" | "danger";

export type MenuItemDescription = {
  id: string;
  label: string;
  disabled?: boolean;
  tone?: MenuItemTone;
  onSelect: () => void;
};

export type MenuProps = {
  /** Название меню для скринридера: у списка пунктов нет своей подписи. */
  label: string;
  /** Подпись кнопки, открывающей меню. */
  trigger: string;
  items: MenuItemDescription[];
};

export function Menu({ label, trigger, items }: MenuProps) {
  const menuId = useId();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const itemElements = useRef<(HTMLButtonElement | null)[]>([]);
  // Ссылка на свежий набор: массив пунктов приходит новым на каждой перерисовке вызывающего, и в
  // зависимостях эффекта он снимал бы слушатели и заново забирал фокус на первый пункт.
  const latestItems = useRef(items);
  latestItems.current = items;

  useEffect(() => {
    const container = rootRef.current;

    if (!open || container === null) {
      return;
    }

    // Отдельное имя с объявленным типом: сужение до элемента компилятор во вложенные слушатели не
    // переносит, а им нужен уже проверенный.
    const root: HTMLDivElement = container;
    // Документ меню, а не `window`: слушателям нужен тот же документ, в котором лежит само меню.
    const ownerDocument = root.ownerDocument;

    // Открытое меню забирает фокус на первый доступный пункт: иначе стрелкам не от чего отсчитывать.
    const firstEnabled = nextEnabledIndex(latestItems.current, -1, 1);

    if (firstEnabled !== undefined) {
      itemElements.current[firstEnabled]?.focus();
    }

    function handlePointerDown(event: PointerEvent): void {
      // Указатель мимо меню и мимо триггера — меню больше не нужно. Фокус при этом не двигаем: он ушёл
      // туда, куда нажали.
      if (!(event.target instanceof Node) || !root.contains(event.target)) {
        setOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape") {
        setOpen(false);
        // Escape отменяет открытие, а не уводит с места: фокус возвращается туда, откуда пришёл.
        triggerRef.current?.focus();
        return;
      }

      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") {
        return;
      }

      const menuItems = latestItems.current;
      const focused = itemElements.current.findIndex(
        (element) => element !== null && element === ownerDocument.activeElement,
      );
      const step = event.key === "ArrowDown" ? 1 : -1;
      // Фокус вне пунктов — считаем от края набора: стрелка вниз ведёт на первый пункт, вверх на
      // последний. Отсчёт от несуществующего пункта иначе попадает в середину.
      const from = focused < 0 ? (step === 1 ? -1 : menuItems.length) : focused;
      const target = nextEnabledIndex(menuItems, from, step);

      if (target === undefined) {
        return;
      }

      // Стрелки в открытом меню не прокручивают страницу под ним.
      event.preventDefault();
      itemElements.current[target]?.focus();
    }

    ownerDocument.addEventListener("pointerdown", handlePointerDown);
    ownerDocument.addEventListener("keydown", handleKeyDown);

    return () => {
      ownerDocument.removeEventListener("pointerdown", handlePointerDown);
      ownerDocument.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  return (
    <div className={styles.root} ref={rootRef}>
      <button
        type="button"
        className={styles.trigger}
        ref={triggerRef}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((current) => !current)}
      >
        {trigger}
      </button>
      {open ? (
        <div className={styles.menu} id={menuId} role="menu" aria-label={label}>
          {items.map((item, index) => (
            <button
              key={item.id}
              type="button"
              className={`${styles.item}${item.tone === "danger" ? ` ${styles.danger}` : ""}`}
              ref={(element) => {
                itemElements.current[index] = element;
              }}
              role="menuitem"
              disabled={item.disabled}
              onClick={() => {
                item.onSelect();
                setOpen(false);
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      ) : undefined}
    </div>
  );
}
