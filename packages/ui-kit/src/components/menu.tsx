/**
 * Меню действий: кнопка-триггер и всплывающий список пунктов. Пункты приходят данными, как и вкладки, —
 * порядок обхода стрелками тогда известен из массива, а не из документа.
 *
 * Пункт — нативная кнопка, а не наш `Button`: тому нужны и `role="menuitem"`, и ссылка на элемент для
 * перевода фокуса, а его поверхность не принимает ни того, ни другого.
 */

import { useEffect, useId, useRef, useState, type ReactNode } from "react";

import { FloatingLayer } from "./floating-layer.tsx";
import styles from "./menu.module.css";
import { nextEnabledIndex } from "./roving-focus.ts";

const hoverCloseDelayMilliseconds = 120;

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
  /** Открывает компактное меню наведением, сохраняя клик и клавиатуру как полные альтернативы. */
  openOnHover?: boolean;
  /** Оставляет trigger в раскладке, но запрещает открыть меню. */
  disabled?: boolean;
  items: MenuItemDescription[];
};

export function Menu({
  label,
  trigger,
  triggerLabel,
  placement = "below",
  block = false,
  compact = false,
  openOnHover = false,
  disabled = false,
  items,
}: MenuProps) {
  const menuId = useId();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const popupRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const itemElements = useRef<(HTMLButtonElement | null)[]>([]);
  const hoverCloseTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const openedByPointer = useRef(false);
  // Ссылка на свежий набор: массив пунктов приходит новым на каждой перерисовке вызывающего, и в
  // зависимостях эффекта он снимал бы слушатели и заново забирал фокус на первый пункт.
  const latestItems = useRef(items);
  latestItems.current = items;

  useEffect(() => {
    if (disabled && open) {
      setOpen(false);
      return;
    }

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

    // Наведение не должно уводить клавиатурный фокус с того места, где оставил его человек.
    if (!openedByPointer.current && firstEnabled !== undefined) {
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
  }, [disabled, open]);

  useEffect(
    () => () => {
      if (hoverCloseTimer.current !== undefined) clearTimeout(hoverCloseTimer.current);
    },
    [],
  );

  const popup = (
    <FloatingLayer
      open={open}
      anchorRef={triggerRef}
      layerRef={popupRef}
      side={placement === "above" ? "top" : "bottom"}
      matchAnchorWidth={!compact}
      offset={openOnHover ? 0 : undefined}
      className={`${styles.menu}${compact ? ` ${styles.compactMenu}` : ""}`}
      id={menuId}
      role="menu"
      ariaLabel={label}
      onPointerEnter={() => {
        if (hoverCloseTimer.current !== undefined) clearTimeout(hoverCloseTimer.current);
      }}
      onPointerLeave={() => {
        if (!openOnHover) return;
        hoverCloseTimer.current = setTimeout(() => setOpen(false), hoverCloseDelayMilliseconds);
      }}
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
    </FloatingLayer>
  );

  return (
    <div
      className={`${styles.root}${block ? ` ${styles.block}` : ""}`}
      ref={rootRef}
      onPointerEnter={() => {
        if (!openOnHover || disabled) return;
        if (hoverCloseTimer.current !== undefined) clearTimeout(hoverCloseTimer.current);
        openedByPointer.current = true;
        setOpen(true);
      }}
      onPointerLeave={() => {
        if (!openOnHover) return;
        hoverCloseTimer.current = setTimeout(() => setOpen(false), hoverCloseDelayMilliseconds);
      }}
    >
      <button
        type="button"
        className={`${styles.trigger}${block ? ` ${styles.block}` : ""}${compact ? ` ${styles.compact}` : ""}`}
        ref={triggerRef}
        disabled={disabled}
        aria-haspopup="menu"
        aria-label={triggerLabel}
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => {
          if (disabled) return;
          openedByPointer.current = false;
          setOpen((current) => !current);
        }}
      >
        {trigger}
      </button>
      {popup}
    </div>
  );
}
