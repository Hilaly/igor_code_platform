/**
 * Двойной пикер ModelPicker: группа → опция. Обобщён по данным, как `Select`/`Combobox`, — доменно
 * нейтрален и не знает ни про провайдеров, ни про модели. Вызывающий сам собирает группы и опции.
 *
 * Провайдерское дерево выделено в `ModelPickerMenu`: обычный `ModelPicker` добавляет вокруг него
 * прежние этикетку, триггер и popover, а составные контролы могут встроить дерево без второго
 * триггера. Состояние раскрытия и клавиатурный обход принадлежат самому дереву в обоих случаях.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";

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
  /** Что стоит в триггере, пока ничего не выбрано. */
  placeholder: string;
  /** Что рисуется, когда групп нет вовсе. */
  emptyText: string;
  disabled?: boolean;
  side?: Extract<PopoverSide, "top" | "bottom">;
};

export type ModelPickerMenuProps = {
  groups: ModelPickerGroup[];
  value: string | undefined;
  onChange: (value: string) => void;
  onExpandGroup?: (groupId: string) => void;
  label: string;
  placeholder: string;
  emptyText: string;
  disabled?: boolean;
  expandedGroups?: ReadonlySet<string>;
  onExpandedGroupsChange?: (groups: ReadonlySet<string>) => void;
  focusRef?: React.RefObject<HTMLDivElement | null>;
};

type Row = { kind: "header"; groupId: string } | { kind: "option"; groupId: string; value: string };

type MenuController = {
  activeRowId: string | undefined;
  handleKeyDown: (event: React.KeyboardEvent<HTMLElement>) => void;
};

type ModelPickerMenuContextValue = {
  close: () => void;
  onControllerChange: (controller: MenuController | null) => void;
  side?: Extract<PopoverSide, "top" | "bottom">;
};

const ModelPickerMenuContext = createContext<ModelPickerMenuContextValue | null>(null);

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
}: ModelPickerProps): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [expandedGroups, setExpandedGroups] = useState<ReadonlySet<string>>(() => new Set());
  const [activeRowId, setActiveRowId] = useState<string | undefined>();
  const controllerRef = useRef<MenuController | null>(null);

  const optionByValue = useMemo(() => {
    const options = new Map<string, ModelPickerOption>();
    for (const group of groups) {
      for (const option of group.options) options.set(option.value, option);
    }
    return options;
  }, [groups]);
  const selectedOption = value === undefined ? undefined : optionByValue.get(value);

  const menuContext = useMemo<ModelPickerMenuContextValue>(
    () => ({
      close: () => setOpen(false),
      onControllerChange: (controller) => {
        controllerRef.current = controller;
        setActiveRowId(controller?.activeRowId);
      },
      side,
    }),
    [side],
  );

  function handleKeyDown(event: React.KeyboardEvent<HTMLButtonElement>): void {
    if (disabled) return;

    if (!open && (event.key === "ArrowDown" || event.key === "Enter" || event.key === " ")) {
      event.preventDefault();
      setOpen(true);
      return;
    }

    if (open && event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
      return;
    }

    if (open) controllerRef.current?.handleKeyDown(event);
  }

  return (
    <div className={styles.root}>
      {label ? <span className={styles.label}>{label}</span> : null}
      <ModelPickerMenuContext.Provider value={menuContext}>
        <Popover
          side={side}
          open={open}
          onOpenChange={setOpen}
          contentRole="dialog"
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
              aria-activedescendant={open ? activeRowId : undefined}
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
          <ModelPickerMenu
            groups={groups}
            value={value}
            onChange={onChange}
            onExpandGroup={onExpandGroup}
            label={label}
            placeholder={placeholder}
            emptyText={emptyText}
            disabled={disabled}
            expandedGroups={expandedGroups}
            onExpandedGroupsChange={setExpandedGroups}
          />
        </Popover>
      </ModelPickerMenuContext.Provider>
    </div>
  );
}

export function ModelPickerMenu({
  groups,
  value,
  onChange,
  onExpandGroup,
  label,
  emptyText,
  disabled = false,
  expandedGroups,
  onExpandedGroupsChange,
  focusRef,
}: ModelPickerMenuProps): React.JSX.Element {
  const parent = useContext(ModelPickerMenuContext);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [localExpanded, setLocalExpanded] = useState<ReadonlySet<string>>(() => new Set());
  const expanded = expandedGroups ?? localExpanded;
  const updateExpanded = (
    updater: (previous: ReadonlySet<string>) => ReadonlySet<string>,
  ): void => {
    const next = updater(expanded);
    if (onExpandedGroupsChange) onExpandedGroupsChange(next);
    else setLocalExpanded(next);
  };
  const listId = useId();
  const safeListId = `model-picker-${listId.replace(/[^A-Za-z0-9_-]/g, "") || "list"}`;

  const optionByValue = useMemo(() => {
    const options = new Map<string, ModelPickerOption>();
    for (const group of groups) {
      for (const option of group.options) options.set(option.value, option);
    }
    return options;
  }, [groups]);

  const rows = useMemo<Row[]>(() => {
    const visibleRows: Row[] = [];
    for (const group of groups) {
      visibleRows.push({ kind: "header", groupId: group.id });
      if (expanded.has(group.id) && !group.disabled) {
        for (const option of group.options) {
          visibleRows.push({ kind: "option", groupId: group.id, value: option.value });
        }
      }
    }
    return visibleRows;
  }, [expanded, groups]);

  const rowId = useCallback((index: number) => `${safeListId}-row-${index}`, [safeListId]);

  function rowDisabled(row: Row): boolean {
    if (row.kind === "header") {
      return groups.find((group) => group.id === row.groupId)?.disabled ?? false;
    }
    return optionByValue.get(row.value)?.disabled ?? false;
  }

  function stepIndex(from: number, delta: 1 | -1): number {
    let next = from + delta;
    while (next >= 0 && next < rows.length && rowDisabled(rows[next]!)) next += delta;
    return next >= 0 && next < rows.length ? next : from;
  }

  function lastEnabledIndex(): number {
    for (let index = rows.length - 1; index >= 0; index -= 1) {
      if (!rowDisabled(rows[index]!)) return index;
    }
    return -1;
  }

  function toggleGroup(groupId: string): void {
    const willExpand = !expanded.has(groupId);
    updateExpanded((previous) => {
      const next = new Set(previous);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });
    if (willExpand) onExpandGroup?.(groupId);
  }

  useEffect(() => {
    if (value !== undefined) {
      const selectedGroup = groups.find((group) =>
        group.options.some((option) => option.value === value),
      );
      if (selectedGroup !== undefined && !expanded.has(selectedGroup.id)) {
        updateExpanded((previous) => new Set(previous).add(selectedGroup.id));
        return;
      }
      const selectedIndex = rows.findIndex((row) => row.kind === "option" && row.value === value);
      if (selectedIndex >= 0) {
        setActiveIndex(selectedIndex);
        return;
      }
    }
    setActiveIndex(rows.findIndex((row) => row.kind === "header" && !rowDisabled(row)));
  }, [expanded, groups, rows, value]);

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLElement>): void => {
      if (disabled) return;

      if (event.key === "ArrowDown") {
        event.preventDefault();
        setActiveIndex((current) => stepIndex(current >= 0 ? current : -1, 1));
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        setActiveIndex((current) => (current > 0 ? stepIndex(current, -1) : current));
      } else if (event.key === "ArrowRight" && activeIndex >= 0) {
        const row = rows[activeIndex];
        if (row?.kind === "header") {
          const group = groups.find((candidate) => candidate.id === row.groupId);
          if (group && !group.disabled && !expanded.has(group.id)) {
            event.preventDefault();
            toggleGroup(group.id);
          }
        }
      } else if (event.key === "ArrowLeft" && activeIndex >= 0) {
        const row = rows[activeIndex];
        if (row?.kind === "header" && expanded.has(row.groupId)) {
          event.preventDefault();
          updateExpanded((previous) => {
            const next = new Set(previous);
            next.delete(row.groupId);
            return next;
          });
        }
      } else if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        const row = rows[activeIndex];
        if (row?.kind === "header") {
          const group = groups.find((candidate) => candidate.id === row.groupId);
          if (group && !group.disabled) toggleGroup(group.id);
        } else if (row && !rowDisabled(row)) {
          onChange(row.value);
          parent?.close();
        }
      } else if (event.key === "Home") {
        event.preventDefault();
        setActiveIndex(rows.findIndex((row) => !rowDisabled(row)));
      } else if (event.key === "End") {
        event.preventDefault();
        setActiveIndex(lastEnabledIndex());
      }
    },
    [activeIndex, disabled, expanded, groups, onChange, parent, rows],
  );

  const activeRowId = activeIndex >= 0 ? rowId(activeIndex) : undefined;

  useEffect(() => {
    parent?.onControllerChange({ activeRowId, handleKeyDown });
    return () => parent?.onControllerChange(null);
  }, [activeRowId, handleKeyDown, parent]);

  return (
    <div
      className={styles.menuBody}
      ref={focusRef}
      role="tree"
      aria-label={label}
      data-side={parent?.side}
      aria-activedescendant={activeRowId}
      tabIndex={-1}
      onKeyDown={handleKeyDown}
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
                        (row) => row.kind === "option" && row.value === option.value,
                      );
                      const isSelected =
                        option.value === value && !option.disabled && !group.disabled;
                      const optionClassName = `${styles.option}${isSelected ? ` ${styles.selected}` : ""}${
                        rowIndex === activeIndex ? ` ${styles.active}` : ""
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
                              parent?.close();
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
    </div>
  );
}
