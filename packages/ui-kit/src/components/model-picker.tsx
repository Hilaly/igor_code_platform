/**
 * Двойной пикер ModelPicker: группа → опция. Обобщён по данным, как `Select`/`Combobox`, — доменно
 * нейтрален и не знает ни про провайдеров, ни про модели. Вызывающий сам собирает группы и опции.
 *
 * Список опций группы приезжает не сразу: их больше тысячи на все группы сразу, поэтому спрашиваются
 * они по одной группе. Раскрытие группы — отдельное событие `onExpandGroup`, чтобы вызывающий успел
 * их подгрузить; до их прибытия группа рисует крутилку, после отказа — причину.
 *
 * Поверх `Accordion` не построен: у него состояние uncontrolled и нет колбэка раскрытия, а здесь без
 * контроля над раскрытием `onExpandGroup` не позвать.
 */

import { useCallback, useEffect, useId, useMemo, useState } from "react";

import { Notice } from "./notice.tsx";
import { Popover, type PopoverSide } from "./popover.tsx";
import { Spinner } from "./state.tsx";
import styles from "./model-picker.module.css";

export type ModelPickerOption = {
  /** Составная ссылка: значение, которое вернётся в `onChange` (напр. `"anthropic/claude-opus"`). */
  value: string;
  /** Что стоит в строке опции как основная подпись. */
  label: string;
  /** Дополнительная строка-пояснение (человекочитаемое имя), набирается приглушённым. */
  description?: string;
  disabled?: boolean;
};

export type ModelPickerGroup = {
  /** Идентификатор группы — уникальный в пределах пикера. */
  id: string;
  /** Подпись группы (напр. имя провайдера). */
  label: string;
  options: ModelPickerOption[];
  /** Опции группы ещё спрашиваются: вместо списка рисуется крутилка. */
  loading?: boolean;
  /** Опции спросить не вышло: вместо списка рисуется причина. */
  failureReason?: string;
  disabled?: boolean;
};

export type ModelPickerProps = {
  groups: ModelPickerGroup[];
  value: string | undefined;
  onChange: (value: string) => void;
  /** Раскрытие группы — для ленивой загрузки её опций. Идемпотентно: повторный зов безвреден. */
  onExpandGroup?: (groupId: string) => void;
  /** Подпись поля для скринридера и видимой этикетки над ним. */
  label: string;
  /** Что стоит в триггере, пока ничего не выбрано. Обязателен: зашитая в кит строка приезжает на чужом языке. */
  placeholder: string;
  /** Что рисуется, когда групп нет вовсе. То же правило — переводит вызывающий. */
  emptyText: string;
  disabled?: boolean;
  side?: Extract<PopoverSide, "top" | "bottom">;
};

type Row = { kind: "header"; groupId: string } | { kind: "option"; groupId: string; value: string };

export function ModelPicker({
  groups,
  value,
  onChange,
  onExpandGroup,
  label,
  placeholder,
  emptyText,
  disabled = false,
  side = "bottom",
}: ModelPickerProps) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState<number>(-1);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  const listId = useId();
  const safeListId = `model-picker-${listId.replace(/[^A-Za-z0-9_-]/g, "") || "list"}`;

  const optionByValue = useMemo(() => {
    const map = new Map<string, ModelPickerOption>();
    for (const group of groups) {
      for (const option of group.options) {
        map.set(option.value, option);
      }
    }
    return map;
  }, [groups]);

  const selectedOption = value === undefined ? undefined : optionByValue.get(value);

  // Плоский обход видимых строк: шапка группы видна всегда, опции — только у раскрытой группы. По
  // этому массиву ходит клавиатура и `aria-activedescendant`.
  const rows = useMemo<Row[]>(() => {
    const out: Row[] = [];
    for (const group of groups) {
      out.push({ kind: "header", groupId: group.id });
      if (expanded.has(group.id) && !group.disabled) {
        for (const option of group.options) {
          out.push({ kind: "option", groupId: group.id, value: option.value });
        }
      }
    }
    return out;
  }, [groups, expanded]);

  const rowId = useCallback((index: number) => `${safeListId}-row-${index}`, [safeListId]);

  function toggleGroup(groupId: string): void {
    const willExpand = !expanded.has(groupId);

    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) {
        next.delete(groupId);
        return next;
      }
      next.add(groupId);
      return next;
    });

    // Пользовательский callback не живёт внутри updater: React StrictMode вправе повторно вызвать
    // updater для проверки чистоты, но одно раскрытие остаётся одним внешним событием.
    if (willExpand) {
      onExpandGroup?.(groupId);
    }
  }

  // При открытии группа выбранной загруженной опции раскрывается, и активной становится сама опция.
  useEffect(() => {
    if (!open) {
      setActiveIndex(-1);
      return;
    }
    if (value !== undefined) {
      const selectedGroup = groups.find((group) =>
        group.options.some((option) => option.value === value),
      );
      if (selectedGroup !== undefined && !expanded.has(selectedGroup.id)) {
        setExpanded((previous) => new Set(previous).add(selectedGroup.id));
        return;
      }
      const selectedIndex = rows.findIndex((row) => row.kind === "option" && row.value === value);
      if (selectedIndex >= 0) {
        setActiveIndex(selectedIndex);
        return;
      }
    }
    setActiveIndex(rows.findIndex((row) => row.kind === "header"));
  }, [expanded, groups, open, rows, value]);

  // Закрытый попап сбрасывает раскрытие только что открытых групп? Нет: сворачивать вышло бы
  // неожиданно для того, кто раскрыл две группы и отвлёкся. Раскрытие живёт, пока пикер живёт.

  function firstHeaderOrOptionIndex(predicate: (row: Row) => boolean): number {
    return rows.findIndex(predicate);
  }

  function lastEnabledIndex(): number {
    for (let i = rows.length - 1; i >= 0; i--) {
      const row = rows[i]!;
      if (row.kind === "header") {
        const group = groups.find((g) => g.id === row.groupId);
        if (group && !group.disabled) return i;
      } else {
        const option = optionByValue.get(row.value);
        if (option && !option.disabled) return i;
      }
    }
    return -1;
  }

  function rowDisabled(row: Row): boolean {
    if (row.kind === "header") {
      return groups.find((g) => g.id === row.groupId)?.disabled ?? false;
    }
    return optionByValue.get(row.value)?.disabled ?? false;
  }

  function stepIndex(from: number, delta: 1 | -1): number {
    let next = from + delta;
    while (next >= 0 && next < rows.length && rowDisabled(rows[next]!)) {
      next += delta;
    }
    return next >= 0 && next < rows.length ? next : from;
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLButtonElement>) {
    if (disabled) return;

    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (!open) {
        setOpen(true);
        return;
      }
      const start = activeIndex >= 0 ? activeIndex : -1;
      setActiveIndex(stepIndex(start, 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      if (open && activeIndex > 0) {
        setActiveIndex(stepIndex(activeIndex, -1));
      }
    } else if (event.key === "ArrowRight") {
      if (open && activeIndex >= 0) {
        const row = rows[activeIndex];
        if (row?.kind === "header") {
          const group = groups.find((g) => g.id === row.groupId);
          if (group && !group.disabled && !expanded.has(group.id)) {
            event.preventDefault();
            toggleGroup(group.id);
          }
        }
      }
    } else if (event.key === "ArrowLeft") {
      if (open && activeIndex >= 0) {
        const row = rows[activeIndex];
        if (row?.kind === "header") {
          const group = groups.find((g) => g.id === row.groupId);
          if (group && !group.disabled && expanded.has(group.id)) {
            event.preventDefault();
            setExpanded((prev) => {
              const next = new Set(prev);
              next.delete(group.id);
              return next;
            });
          }
        }
      }
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (!open) {
        setOpen(true);
        return;
      }
      if (activeIndex < 0 || activeIndex >= rows.length) return;
      const row = rows[activeIndex]!;
      if (row.kind === "header") {
        const group = groups.find((g) => g.id === row.groupId);
        if (group && !group.disabled) {
          toggleGroup(group.id);
        }
      } else if (!rowDisabled(row)) {
        onChange(row.value);
        setOpen(false);
      }
    } else if (event.key === "Escape") {
      if (open) {
        event.preventDefault();
        setOpen(false);
      }
    } else if (event.key === "Home") {
      if (open) {
        event.preventDefault();
        setActiveIndex(firstHeaderOrOptionIndex((row) => !rowDisabled(row)));
      }
    } else if (event.key === "End") {
      if (open) {
        event.preventDefault();
        setActiveIndex(lastEnabledIndex());
      }
    }
  }

  const activeRowId = open && activeIndex >= 0 ? rowId(activeIndex) : undefined;

  return (
    <div className={styles.root}>
      {label ? <span className={styles.label}>{label}</span> : null}
      <Popover
        side={side}
        open={open}
        onOpenChange={setOpen}
        contentRole="tree"
        ariaLabel={label}
        rootClassName={styles.popover}
        contentClassName={styles.dropdown}
        renderTrigger={({ contentId, toggle }) => (
          <button
            type="button"
            tabIndex={disabled ? -1 : 0}
            role="combobox"
            aria-expanded={open}
            aria-disabled={disabled}
            aria-controls={open ? contentId : undefined}
            aria-haspopup="tree"
            aria-activedescendant={activeRowId}
            aria-label={label}
            className={`${styles.control}${disabled ? ` ${styles.disabled}` : ""}`}
            onClick={() => {
              if (!disabled) toggle();
            }}
            onKeyDown={handleKeyDown}
          >
            <span className={styles.valueText}>
              {selectedOption?.label ?? value ?? placeholder}
            </span>
            <span className={`${styles.arrow}${open ? ` ${styles.open}` : ""}`}>▼</span>
          </button>
        )}
      >
        {groups.length === 0 ? (
          <div className={styles.empty}>{emptyText}</div>
        ) : (
          groups.map((group) => {
            const isExpanded = expanded.has(group.id) && !group.disabled;
            const headerIndex = rows.findIndex(
              (row) => row.kind === "header" && row.groupId === group.id,
            );
            return (
              <div
                key={group.id}
                id={headerIndex >= 0 ? rowId(headerIndex) : undefined}
                role="treeitem"
                aria-label={group.label}
                aria-level={1}
                aria-expanded={isExpanded}
                aria-disabled={group.disabled}
                className={styles.group}
              >
                <div
                  className={`${styles.groupHeader}${group.disabled ? ` ${styles.disabled}` : ""}`}
                  onClick={() => {
                    if (!group.disabled) toggleGroup(group.id);
                  }}
                >
                  <span
                    className={`${styles.chevron}${isExpanded ? ` ${styles.chevronOpen}` : ""}`}
                    aria-hidden="true"
                  >
                    ▶
                  </span>
                  <span>{group.label}</span>
                </div>
                {isExpanded ? (
                  <div className={styles.groupOptions} role="group">
                    {group.loading ? (
                      <div className={styles.state}>
                        <Spinner label={group.label} />
                      </div>
                    ) : group.failureReason !== undefined ? (
                      <div className={styles.state}>
                        <Notice tone="danger" title={group.failureReason} />
                      </div>
                    ) : group.options.length === 0 ? (
                      <div className={styles.empty}>{emptyText}</div>
                    ) : (
                      group.options.map((option) => {
                        const rowIndex = rows.findIndex(
                          (r) => r.kind === "option" && r.value === option.value,
                        );
                        const isSelected =
                          option.value === value && !option.disabled && !group.disabled;
                        const isActive = rowIndex === activeIndex;
                        const optionClassName = `${styles.option}${isSelected ? ` ${styles.selected}` : ""}${
                          isActive ? ` ${styles.active}` : ""
                        }${option.disabled ? ` ${styles.disabled}` : ""}`;

                        return (
                          <div
                            key={option.value}
                            id={rowIndex >= 0 ? rowId(rowIndex) : undefined}
                            role="treeitem"
                            aria-level={2}
                            aria-selected={isSelected}
                            aria-disabled={option.disabled}
                            className={optionClassName}
                            onMouseEnter={() => {
                              if (!option.disabled && rowIndex >= 0) setActiveIndex(rowIndex);
                            }}
                            onClick={(event) => {
                              event.stopPropagation();
                              if (!option.disabled && !group.disabled) {
                                onChange(option.value);
                                setOpen(false);
                              }
                            }}
                          >
                            <span className={styles.optionLabel}>{option.label}</span>
                            {option.description !== undefined ? (
                              <span className={styles.optionDesc}>{option.description}</span>
                            ) : null}
                            {isSelected ? <span>✓</span> : null}
                          </div>
                        );
                      })
                    )}
                  </div>
                ) : null}
              </div>
            );
          })
        )}
      </Popover>
    </div>
  );
}
