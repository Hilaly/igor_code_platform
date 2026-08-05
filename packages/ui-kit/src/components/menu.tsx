/**
 * Меню действий: кнопка-триггер и всплывающий список пунктов. Пункты приходят данными, как и вкладки, —
 * порядок обхода стрелками тогда известен из массива, а не из документа.
 *
 * Пункт — нативная кнопка, а не наш `Button`: тому нужны и `role="menuitem"`, и ссылка на элемент для
 * перевода фокуса, а его поверхность не принимает ни того, ни другого.
 */

import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

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
  /** Подпись кнопки, открывающей меню. Не только текст: кнопке внизу панели нужен ещё и значок рядом. */
  trigger: ReactNode;
  /**
   * Название кнопки для скринридера. Нужно, когда подпись — значок вроде `…`: видимого текста для
   * имени тогда не хватает, и кнопка называется многоточием. Без значка не задаётся: дублировать
   * видимую подпись в `aria-label` значит расходиться с ней при первой же правке.
   */
  triggerLabel?: string;
  /**
   * Куда раскрывается список: `"below"` — обычное меню, `"above"` — для кнопки в самом низу панели,
   * которой раскрываться вниз некуда.
   */
  placement?: "below" | "above";
  /** Кнопка и список занимают всю ширину контейнера, а не по содержимому — для кнопки во всю панель. */
  block?: boolean;
  /** Лёгкий триггер для контекстных меню: без капсулы, с подсветкой только при взаимодействии. */
  compact?: boolean;
  items: MenuItemDescription[];
};

export function Menu({
  label,
  trigger,
  triggerLabel,
  placement = "below",
  block = false,
  compact = false,
  items,
}: MenuProps) {
  const menuId = useId();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const popupRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const itemElements = useRef<(HTMLButtonElement | null)[]>([]);
  const [popupPosition, setPopupPosition] = useState<{ top: number; left: number } | undefined>();
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
      if (
        !(event.target instanceof Node) ||
        (!root.contains(event.target) && !popupRef.current?.contains(event.target))
      ) {
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

  useLayoutEffect(() => {
    if (!open || !compact || typeof window === "undefined") {
      return;
    }

    const updatePosition = (): void => {
      const triggerElement = triggerRef.current;

      if (triggerElement === null) {
        return;
      }

      const rect = triggerElement.getBoundingClientRect();
      const popupHeight = popupRef.current?.getBoundingClientRect().height ?? 0;
      const popupWidth = popupRef.current?.getBoundingClientRect().width ?? 0;
      const viewportPadding = 8;
      const maxLeft = Math.max(viewportPadding, window.innerWidth - popupWidth - viewportPadding);
      const preferredTop = placement === "above" ? rect.top - popupHeight : rect.bottom;
      const maxTop = Math.max(viewportPadding, window.innerHeight - popupHeight - viewportPadding);

      setPopupPosition({
        left: Math.min(Math.max(rect.left, viewportPadding), maxLeft),
        top: Math.min(Math.max(preferredTop, viewportPadding), maxTop),
      });
    };

    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);

    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [compact, open, placement]);

  const popup = open ? (
    <div
      className={`${styles.menu}${placement === "above" ? ` ${styles.above}` : ""}${compact ? ` ${styles.portal}` : ""}`}
      id={menuId}
      role="menu"
      aria-label={label}
      ref={popupRef}
      style={
        compact && popupPosition !== undefined
          ? { ...popupPosition, maxWidth: "calc(100vw - 16px)" }
          : undefined
      }
    >
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
            triggerRef.current?.focus();
          }}
        >
          {item.label}
        </button>
      ))}
    </div>
  ) : undefined;

  return (
    <div className={`${styles.root}${block ? ` ${styles.block}` : ""}`} ref={rootRef}>
      <button
        type="button"
        className={`${styles.trigger}${block ? ` ${styles.block}` : ""}${compact ? ` ${styles.compact}` : ""}`}
        ref={triggerRef}
        aria-haspopup="menu"
        aria-label={triggerLabel}
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((current) => !current)}
      >
        {trigger}
      </button>
      {compact && popup !== undefined && typeof document !== "undefined"
        ? createPortal(popup, document.body)
        : popup}
    </div>
  );
}
