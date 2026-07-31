/**
 * Иерархическое дерево с WAI-ARIA моделью и клавиатурной навигацией стрелками.
 *
 * Мышь и клавиатура означают здесь одно и то же, и это главное правило компонента: щелчок по строке
 * **выбирает** узел, щелчок по раскрывашке **раскрывает** его, а с клавиатуры выбор делают `Enter` и
 * пробел, раскрытие — `ArrowRight`/`ArrowLeft`. До среза 10b один щелчок по узлу с детьми делал
 * и то, и другое: выбрать раскрытую папку было нельзя, не свернув её.
 *
 * Фокус живёт по модели roving tabindex: состояние помнит, какой узел получит `Tab`, а `.focus()`
 * зовётся только в ответ на действие человека — нажатие клавиши или щелчок. Эффекта, переносящего
 * фокус на перерисовке, здесь нет: дерево записей сессии стоит рядом с живой лентой чата и
 * перерисовывается на каждой дельте стриминга, и такой эффект уводил бы курсор из поля ввода, пока
 * человек печатает. Пропавший из набора узел поэтому не забирает фокус, а только теряет право на
 * `Tab`: право выводится из набора видимых узлов, а не хранится вторым состоянием.
 *
 * Раскрытие бывает своё и чужое: без пропа `expandedIds` дерево помнит его само, с пропом — не
 * применяет своё вовсе. Второй режим и есть настоящий: у дерева записей сессии раскрытие это
 * состояние данных, а не прихоть человека — панель обязана открыться на той ветке, в которой сессия
 * работает сейчас, а путь до текущего листа знает вью.
 */

import {
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from "react";

import { Badge, type BadgeTone } from "./badge.tsx";
import styles from "./tree.module.css";

/** Метка узла: строка приходит переведённой, тон — роль, а не цвет (см. `Badge`). */
export type TreeNodeBadge = {
  text: string;
  tone: BadgeTone;
};

export type TreeNode = {
  id: string;
  label: string;
  /** Значок перед подписью. Декоративный: в имя узла для скринридера он не попадает. */
  icon?: ReactNode;
  /** Метка рядом с подписью — состояние записи, число вложенных, что угодно ещё. */
  badge?: TreeNodeBadge;
  children?: TreeNode[];
};

export type TreeProps = {
  nodes: TreeNode[];
  selectedId?: string;
  onSelect?: (node: TreeNode) => void;
  /**
   * Имя дерева для скринридера. Обязателен и умолчания не имеет: строка, зашитая в кит, приезжает на
   * чужом языке, а обязательный проп делает забывчивость отказом сборки (docs/ui-kit.md).
   */
  label: string;
  /**
   * Имя кнопки раскрытия. Функция, а не пара строк: имя зависит и от узла, и от состояния, а
   * порядок слов в нём принадлежит языку, и склеивать его в ките значит навязывать русский.
   */
  toggleLabel: (node: TreeNode, expanded: boolean) => string;
  /**
   * Раскрытые узлы. Задан — раскрытием владеет вызывающий, и своего состояния дерево не применяет
   * вовсе; не задан — дерево помнит раскрытие само. Третьего, смешанного, режима нет: дерево,
   * которое иногда слушается вызывающего, а иногда нет, хуже обоих.
   *
   * Управляемый режим нужен там, где раскрытие — не прихоть человека, а состояние данных: панель
   * дерева записей сессии обязана открыться на ветке, в которой сессия работает сейчас, и путь до
   * текущего листа знает вью, а не кит.
   */
  expandedIds?: string[];
  /**
   * Новый набор раскрытых узлов целиком — как `onChange` у остальных управляемых примитивов кита, а
   * не «этот узел раскрылся»: собирать набор из дельт пришлось бы каждому вызывающему заново.
   * Зовётся в обоих режимах: набор меняется и тогда, когда его хранит само дерево.
   */
  onExpandedChange?: (expandedIds: string[]) => void;
};

type FlatNode = {
  node: TreeNode;
  level: number;
  parentId?: string;
  hasChildren: boolean;
  isExpanded: boolean;
};

/**
 * Видимые узлы одним списком: порядок обхода стрелками — это порядок строк на экране, а не форма
 * дерева. Функция чистая и лежит вне компонента, чтобы результат считался один раз на набор и
 * раскрытие, а не заново на каждый рендер.
 */
function flattenVisible(
  nodeList: readonly TreeNode[],
  expandedIds: ReadonlySet<string>,
  level = 0,
  parentId?: string,
): FlatNode[] {
  const result: FlatNode[] = [];

  for (const node of nodeList) {
    const hasChildren = Boolean(node.children && node.children.length > 0);
    const isExpanded = expandedIds.has(node.id);

    result.push({ node, level, parentId, hasChildren, isExpanded });

    if (hasChildren && isExpanded && node.children) {
      result.push(...flattenVisible(node.children, expandedIds, level + 1, node.id));
    }
  }

  return result;
}

export function Tree({
  nodes,
  selectedId,
  onSelect,
  label,
  toggleLabel,
  expandedIds,
  onExpandedChange,
}: TreeProps) {
  const [ownExpandedIds, setOwnExpandedIds] = useState<ReadonlySet<string>>(
    () => new Set<string>(),
  );
  const [focusedId, setFocusedId] = useState<string | undefined>();
  const treeId = useId();
  const itemElements = useRef(new Map<string, HTMLDivElement>());

  /** Владелец раскрытия определяется наличием пропа, и второго источника у набора нет. */
  const isExpansionControlled = expandedIds !== undefined;
  const effectiveExpandedIds = useMemo<ReadonlySet<string>>(
    () => (expandedIds === undefined ? ownExpandedIds : new Set(expandedIds)),
    [expandedIds, ownExpandedIds],
  );

  const visibleNodes = useMemo(
    () => flattenVisible(nodes, effectiveExpandedIds),
    [nodes, effectiveExpandedIds],
  );

  /**
   * Единственный узел, доступный с `Tab`. Выводится, а не хранится: узел, на котором стрелки
   * остановились, может исчезнуть из набора, и тогда право на `Tab` само переходит к выбранному, а
   * если и его нет — к первому видимому. Полоса не выпадает из обхода клавиатурой ни в одном случае.
   */
  const rovingId =
    visibleNodes.find(({ node }) => node.id === focusedId)?.node.id ??
    visibleNodes.find(({ node }) => node.id === selectedId)?.node.id ??
    visibleNodes[0]?.node.id;

  function toggleExpand(id: string) {
    const next = new Set(effectiveExpandedIds);

    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }

    onExpandedChange?.([...next]);

    // В управляемом режиме раскрытие меняет только вызывающий: применить набор у себя значит
    // показать раскрытие, которого в его состоянии нет.
    if (!isExpansionControlled) {
      setOwnExpandedIds(next);
    }
  }

  /** Перенос фокуса. Зовётся только из обработчиков ввода — эффекта, двигающего фокус, здесь нет. */
  function focusItem(id: string) {
    setFocusedId(id);
    itemElements.current.get(id)?.focus();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>, nodeId: string) {
    // Вложенный узел лежит внутри родительского, и его нажатие всплывает сюда же: без этой проверки
    // одну стрелку обработали бы все предки разом. Сюда же попадает и кнопка раскрытия.
    if (event.target !== event.currentTarget) return;
    if (visibleNodes.length === 0) return;

    const currentIndex = visibleNodes.findIndex((flat) => flat.node.id === nodeId);
    const currentItem = currentIndex >= 0 ? visibleNodes[currentIndex] : visibleNodes[0];
    if (!currentItem) return;

    if (event.key === "ArrowDown") {
      event.preventDefault();
      const nextIndex = Math.min(currentIndex + 1, visibleNodes.length - 1);
      const nextItem = visibleNodes[nextIndex];
      if (nextItem) focusItem(nextItem.node.id);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      const previousIndex = Math.max(currentIndex - 1, 0);
      const previousItem = visibleNodes[previousIndex];
      if (previousItem) focusItem(previousItem.node.id);
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      if (currentItem.hasChildren) {
        if (currentItem.isExpanded) {
          const childItem = visibleNodes.find((flat) => flat.parentId === currentItem.node.id);
          if (childItem) focusItem(childItem.node.id);
        } else {
          toggleExpand(currentItem.node.id);
        }
      }
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      if (currentItem.hasChildren && currentItem.isExpanded) {
        toggleExpand(currentItem.node.id);
      } else if (currentItem.parentId) {
        focusItem(currentItem.parentId);
      }
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onSelect?.(currentItem.node);
    }
  }

  function handleItemClick(event: MouseEvent<HTMLDivElement>, node: TreeNode) {
    // Узлы вложены друг в друга: без остановки щелчок по ребёнку выбрал бы заодно всех его предков.
    event.stopPropagation();
    focusItem(node.id);
    onSelect?.(node);
  }

  function handleToggleClick(event: MouseEvent<HTMLButtonElement>, node: TreeNode) {
    event.stopPropagation();
    toggleExpand(node.id);
    // Кнопка раскрытия из обхода `Tab` исключена, поэтому фокус остаётся на узле: щелчок по ней —
    // действие человека, и следующая стрелка обязана продолжить путь оттуда, куда он ткнул.
    focusItem(node.id);
  }

  function renderNodes(nodeList: readonly TreeNode[], level = 0) {
    return nodeList.map((node) => {
      const hasChildren = Boolean(node.children && node.children.length > 0);
      const isExpanded = effectiveExpandedIds.has(node.id);
      const isSelected = selectedId === node.id;
      // Идентификатор узла приходит данными и может содержать что угодно, а `aria-labelledby`
      // разделяет значения пробелом: без кодирования ссылка распалась бы на две.
      const nodeElementId = `${treeId}-item-${encodeURIComponent(node.id)}`;
      const labelElementId = `${nodeElementId}-label`;
      const badgeElementId = `${nodeElementId}-badge`;

      return (
        <div
          key={node.id}
          id={nodeElementId}
          ref={(element) => {
            if (element) {
              itemElements.current.set(node.id, element);
            } else {
              itemElements.current.delete(node.id);
            }
          }}
          role="treeitem"
          aria-level={level + 1}
          aria-expanded={hasChildren ? isExpanded : undefined}
          aria-selected={isSelected}
          // Имя узла — его подпись с меткой, а не всё содержимое: иначе в него уезжают и подписи
          // раскрытых детей, и имя кнопки раскрытия. Метка названа вторым идентификатором, а не
          // вложена в подпись: перечисленные части имени разделяются пробелом, склеенные — нет.
          aria-labelledby={node.badge ? `${labelElementId} ${badgeElementId}` : labelElementId}
          tabIndex={node.id === rovingId ? 0 : -1}
          className={styles.item}
          onKeyDown={(event) => handleKeyDown(event, node.id)}
          onClick={(event) => handleItemClick(event, node)}
        >
          <div className={`${styles.row}${isSelected ? ` ${styles.selected}` : ""}`}>
            {hasChildren ? (
              <button
                type="button"
                className={`${styles.toggle}${isExpanded ? ` ${styles.expanded}` : ""}`}
                aria-label={toggleLabel(node, isExpanded)}
                // Состояние раскрытия объявляет сам узел; второе объявление на кнопке скринридер
                // прочитал бы дважды. Из обхода `Tab` кнопка исключена: единственная точка входа в
                // дерево — узел, а раскрытие с клавиатуры живёт на стрелках.
                tabIndex={-1}
                onClick={(event) => handleToggleClick(event, node)}
              >
                ▶
              </button>
            ) : (
              <span className={styles.togglePlaceholder} aria-hidden="true" />
            )}
            {node.icon ? (
              <span className={styles.icon} aria-hidden="true">
                {node.icon}
              </span>
            ) : null}
            <span id={labelElementId} className={styles.label}>
              {node.label}
            </span>
            {node.badge ? (
              <span id={badgeElementId}>
                <Badge tone={node.badge.tone}>{node.badge.text}</Badge>
              </span>
            ) : null}
          </div>
          {hasChildren && isExpanded && node.children ? (
            <div role="group" className={styles.children}>
              {renderNodes(node.children, level + 1)}
            </div>
          ) : null}
        </div>
      );
    });
  }

  return (
    <div className={styles.root} role="tree" aria-label={label}>
      {renderNodes(nodes)}
    </div>
  );
}
