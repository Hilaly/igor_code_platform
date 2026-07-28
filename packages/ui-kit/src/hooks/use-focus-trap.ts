/**
 * Удержание фокуса внутри слоя: начальный фокус, цикл по Tab и Shift+Tab, возврат фокуса тому, кто его
 * отдал. Без этого модальный слой модален только на вид — Tab уводит в страницу под затемнением, где
 * скринридер продолжает читать то, что глазом уже не видно.
 *
 * Отдельный хук, а не часть диалога: тот же счёт понадобится любому слою, который забирает фокус
 * целиком, а проверить его на диалоге и на всплывающем слое по отдельности нельзя — правило одно.
 */

import type { RefObject } from "react";
import { useEffect, useRef } from "react";

/**
 * Что вообще может принять фокус. Отбор по селектору, а не по обходу дерева: браузер уже умеет искать
 * по документу, и повторять его обход значит расходиться с ним на первом же новом виде контрола.
 */
const focusableSelector = [
  "a[href]",
  "button",
  'input:not([type="hidden"])',
  "select",
  "textarea",
  "[tabindex]",
  '[contenteditable="true"]',
].join(",");

export type FocusTrapOptions = {
  /** Слой на экране. Пока `false`, хук не слушает клавиатуру и не двигает фокус. */
  active: boolean;
  /** Закрывать ли по Escape. Слой в процессе необратимого действия закрываться не должен. */
  closeOnEscape: boolean;
  containerRef: RefObject<HTMLElement | null>;
  onClose: () => void;
};

function isDisabled(element: HTMLElement): boolean {
  return element.matches(":disabled") || element.getAttribute("aria-disabled") === "true";
}

/**
 * Скрытый элемент фокус не принимает, но `querySelectorAll` его находит. Проверка идёт вверх по
 * предкам до самого слоя: спрятана обычно не кнопка, а свёрнутый участок вокруг неё.
 */
function isHidden(element: HTMLElement, boundary?: HTMLElement): boolean {
  let current: HTMLElement | null = element;

  while (current !== null) {
    if (current.hidden) {
      return true;
    }

    const style = current.ownerDocument.defaultView?.getComputedStyle(current);

    if (
      style?.display === "none" ||
      style?.visibility === "hidden" ||
      style?.visibility === "collapse"
    ) {
      return true;
    }

    if (current === boundary) {
      break;
    }

    current = current.parentElement;
  }

  return false;
}

function isEligible(element: HTMLElement, boundary: HTMLElement): boolean {
  if (!element.matches(focusableSelector) || isDisabled(element) || isHidden(element, boundary)) {
    return false;
  }

  // Отрицательный `tabindex` — «фокусируется скриптом, но не Tab»: в цикле такому элемента нет места.
  return element.getAttribute("tabindex") === null || element.tabIndex >= 0;
}

function eligibleDescendants(container: HTMLElement): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>(focusableSelector)].filter((element) =>
    isEligible(element, container),
  );
}

/**
 * Вернуть фокус можно только живому и видимому элементу: пока слой был открыт, страница под ним могла
 * перерисоваться. Фокус на элементе, которого больше нет, браузер отдаёт `body`, и клавиатура остаётся
 * в начале страницы.
 */
function canRestoreFocus(element: HTMLElement): boolean {
  return element.isConnected && !isDisabled(element) && !isHidden(element);
}

export function useFocusTrap({
  active,
  closeOnEscape,
  containerRef,
  onClose,
}: FocusTrapOptions): void {
  // Ссылки на свежие значения: эффект переставляется только по `active`, иначе каждая перерисовка
  // вызывающего снимала бы слушатель и возвращала фокус посреди открытого слоя.
  const closeOnEscapeRef = useRef(closeOnEscape);
  const onCloseRef = useRef(onClose);
  closeOnEscapeRef.current = closeOnEscape;
  onCloseRef.current = onClose;

  useEffect(() => {
    const layer = containerRef.current;

    if (!active || layer === null) {
      return;
    }

    // Отдельное имя с объявленным типом: сужение до `HTMLElement` компилятор во вложенный слушатель не
    // переносит, а тому нужен уже проверенный элемент.
    const container: HTMLElement = layer;

    const ownerDocument = container.ownerDocument;
    const previouslyFocused =
      ownerDocument.activeElement instanceof HTMLElement ? ownerDocument.activeElement : null;
    // Слой без единого контрола всё равно обязан забрать фокус: иначе Escape уйдёт странице под ним.
    const initialTarget = eligibleDescendants(container)[0] ?? container;

    initialTarget.focus();

    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape") {
        if (closeOnEscapeRef.current) {
          onCloseRef.current();
        }

        return;
      }

      if (event.key !== "Tab") {
        return;
      }

      // Список считается на каждое нажатие: внутри слоя контролы появляются и исчезают.
      const focusable = eligibleDescendants(container);
      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (first === undefined || last === undefined) {
        event.preventDefault();
        container.focus();
        return;
      }

      const focused = ownerDocument.activeElement;
      const focusedIndex = focused instanceof HTMLElement ? focusable.indexOf(focused) : -1;

      if (focusedIndex < 0) {
        // Фокус на самом слое или вообще вне него: Tab заводит в набор, а не выпускает из слоя.
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (!event.shiftKey && focused === last) {
        event.preventDefault();
        first.focus();
      } else if (event.shiftKey && focused === first) {
        event.preventDefault();
        last.focus();
      }
    }

    // Слушает документ слоя, а не `window`: слой может жить в другом документе, и тогда `window`
    // чужое. Свой документ у контейнера есть всегда.
    ownerDocument.addEventListener("keydown", handleKeyDown);

    return () => {
      ownerDocument.removeEventListener("keydown", handleKeyDown);

      if (previouslyFocused !== null && canRestoreFocus(previouslyFocused)) {
        previouslyFocused.focus();
      }
    };
  }, [active, containerRef]);
}
