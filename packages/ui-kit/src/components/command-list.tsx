/**
 * Палитра: поле поиска плюс сгруппированный список команд, по которому ходят стрелками, не отрывая
 * рук от набора. Отбор не её работа — совпадение считает вызывающий и отдаёт уже готовые группы:
 * что считать совпадением, знает тот, кто владеет командами, а не примитив.
 *
 * Фокус остаётся в поле, а активная строка объявляется через `aria-activedescendant`: это тот же
 * `combobox` с `listbox`, что у выбора значения, — иначе после каждой стрелки пришлось бы возвращать
 * фокус в поле, чтобы дописать букву.
 */

import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";

import { Input } from "./input.tsx";
import styles from "./command-list.module.css";

export type CommandListItem = {
  id: string;
  label: string;
  /** Значок перед подписью. Декоративный: имя строке даёт `label`. */
  icon?: ReactNode;
  /** Приписка справа — откуда команда. Имя плагина, а не второе действие. */
  meta?: string;
  /**
   * Недоступная строка остаётся видимой: пропадая, она меняла бы состав списка под руками, и
   * «показать панель» исчезала бы ровно тогда, когда её ищут. Стрелки её перешагивают.
   */
  disabled?: boolean;
};

export type CommandListGroup = {
  id: string;
  label: string;
  items: readonly CommandListItem[];
};

export type CommandListProps = {
  query: string;
  onQueryChange: (query: string) => void;
  groups: readonly CommandListGroup[];
  /** Выбор строки: и по нажатию, и по `Enter` на активной. */
  onChoose: (id: string) => void;
  /** Подпись поля поиска: строка приходит переведённой. */
  searchLabel: string;
  /** То же правило: «ничего не нашлось» переводит вызывающий. */
  emptyText: string;
};

/** Строки всех групп подряд: стрелки ходят по списку целиком, а не по одной группе. */
const flatten = (groups: readonly CommandListGroup[]): readonly CommandListItem[] =>
  groups.flatMap((group) => [...group.items]);

export function CommandList({
  query,
  onQueryChange,
  groups,
  onChoose,
  searchLabel,
  emptyText,
}: CommandListProps) {
  const rawId = useId();
  const listRootId = `command-list-${rawId.replace(/[^A-Za-z0-9_-]/g, "") || "list"}`;
  const listId = `${listRootId}-list`;
  const items = useMemo(() => flatten(groups), [groups]);
  const enabled = useMemo(() => items.filter((item) => item.disabled !== true), [items]);
  const [activeId, setActiveId] = useState<string | undefined>(undefined);
  const listRef = useRef<HTMLUListElement | null>(null);

  // Активная строка обязана существовать в текущем отборе: после набранной буквы список другой, и
  // прежняя активная могла из него уйти. Тогда активной становится первая доступная.
  const active = enabled.find((item) => item.id === activeId) ?? enabled[0];

  useEffect(() => {
    if (active !== undefined && active.id !== activeId) {
      setActiveId(active.id);
    }
  }, [active, activeId]);

  // Активную строку видно всегда: стрелка вниз в списке из двадцати команд иначе уводит её за край.
  useEffect(() => {
    if (active === undefined) {
      return;
    }

    const element = listRef.current?.querySelector(
      `[data-command-item="${CSS.escape(active.id)}"]`,
    );

    // Проверка на функцию — не паранойя: jsdom, в котором идут наши DOM-тесты, `scrollIntoView` не
    // реализует вовсе, и без неё падал бы каждый рендер списка.
    if (element instanceof HTMLElement && typeof element.scrollIntoView === "function") {
      element.scrollIntoView({ block: "nearest" });
    }
  }, [active]);

  const move = (step: number): void => {
    if (enabled.length === 0) {
      return;
    }

    const current = enabled.findIndex((item) => item.id === active?.id);
    const next = current < 0 ? 0 : (current + step + enabled.length) % enabled.length;

    setActiveId(enabled[next]?.id);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      move(1);

      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      move(-1);

      return;
    }

    if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      setActiveId((event.key === "Home" ? enabled[0] : enabled.at(-1))?.id);

      return;
    }

    if (event.key === "Enter" && active !== undefined) {
      event.preventDefault();
      onChoose(active.id);
    }
  };

  return (
    <div className={styles.root}>
      <Input
        value={query}
        onChange={onQueryChange}
        type="search"
        aria-label={searchLabel}
        placeholder={searchLabel}
        role="combobox"
        aria-expanded
        aria-controls={listId}
        aria-autocomplete="list"
        {...(active === undefined ? {} : { "aria-activedescendant": `${listRootId}-${active.id}` })}
        onKeyDown={handleKeyDown}
      />
      {items.length === 0 ? (
        <p>{emptyText}</p>
      ) : (
        <ul
          className={styles.list}
          id={listId}
          role="listbox"
          aria-label={searchLabel}
          ref={listRef}
        >
          {groups.map((group) => (
            <li key={group.id} className={styles.group} role="presentation">
              <div className={styles.groupLabel} id={`${listRootId}-${group.id}`}>
                {group.label}
              </div>
              <ul
                className={styles.items}
                role="group"
                aria-labelledby={`${listRootId}-${group.id}`}
              >
                {group.items.map((item) => (
                  <li
                    key={item.id}
                    id={`${listRootId}-${item.id}`}
                    className={styles.item}
                    data-command-item={item.id}
                    role="option"
                    aria-selected={item.id === active?.id}
                    {...(item.disabled === true ? { "aria-disabled": true } : {})}
                    // Строка не кнопка: фокус живёт в поле поиска, и вторая точка входа с клавиатуры
                    // спорила бы с `aria-activedescendant`. Указателю остаётся нажатие.
                    // Нажатие мыши не забирает фокус из поля: набор обязан продолжаться после выбора,
                    // который ничего не закрыл.
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => {
                      if (item.disabled !== true) {
                        onChoose(item.id);
                      }
                    }}
                  >
                    {item.icon === undefined ? undefined : (
                      <span className={styles.itemIcon} aria-hidden="true">
                        {item.icon}
                      </span>
                    )}
                    <span className={styles.itemLabel}>{item.label}</span>
                    {item.meta === undefined ? undefined : (
                      <span className={styles.itemMeta}>{item.meta}</span>
                    )}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
