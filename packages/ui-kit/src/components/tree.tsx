/** Компонент иерархического дерева Tree с WAI-ARIA моделью и клавиатурной навигацией стрелками. */

import { useId, useState, useRef, useEffect, type ReactNode } from "react";

import styles from "./tree.module.css";

export type TreeNode = {
  id: string;
  label: string;
  icon?: ReactNode;
  children?: TreeNode[];
};

export type TreeProps = {
  nodes: TreeNode[];
  selectedId?: string;
  onSelect?: (node: TreeNode) => void;
  label?: string;
};

type FlatNode = {
  node: TreeNode;
  level: number;
  parentId?: string;
  hasChildren: boolean;
  isExpanded: boolean;
};

export function Tree({ nodes, selectedId, onSelect, label = "Иерархия объектов" }: TreeProps) {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [focusedId, setFocusedId] = useState<string | undefined>(selectedId || nodes[0]?.id);
  const treeId = useId();
  const treeItemRefs = useRef(new Map<string, HTMLDivElement>());

  useEffect(() => {
    if (selectedId && !focusedId) {
      setFocusedId(selectedId);
    }
  }, [selectedId]);

  function toggleExpand(id: string) {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  // Flatten visible nodes for keyboard navigation
  function getVisibleFlatNodes(nodeList: TreeNode[], level = 0, parentId?: string): FlatNode[] {
    const result: FlatNode[] = [];
    for (const node of nodeList) {
      const hasChildren = Boolean(node.children && node.children.length > 0);
      const isExpanded = expandedIds.has(node.id);
      result.push({ node, level, parentId, hasChildren, isExpanded });
      if (hasChildren && isExpanded && node.children) {
        result.push(...getVisibleFlatNodes(node.children, level + 1, node.id));
      }
    }
    return result;
  }

  const visibleNodes = getVisibleFlatNodes(nodes);

  function focusItem(id: string) {
    setFocusedId(id);
    treeItemRefs.current.get(id)?.focus();
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>, nodeId: string) {
    if (visibleNodes.length === 0) return;
    const currentIndex = visibleNodes.findIndex((fn) => fn.node.id === nodeId);
    const currentItem = currentIndex >= 0 ? visibleNodes[currentIndex] : visibleNodes[0];
    if (!currentItem) return;

    if (event.key === "ArrowDown") {
      event.preventDefault();
      const nextIndex = Math.min(currentIndex + 1, visibleNodes.length - 1);
      const nextItem = visibleNodes[nextIndex];
      if (nextItem) focusItem(nextItem.node.id);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      const prevIndex = Math.max(currentIndex - 1, 0);
      const previousItem = visibleNodes[prevIndex];
      if (previousItem) focusItem(previousItem.node.id);
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      if (currentItem.hasChildren) {
        if (!currentItem.isExpanded) {
          toggleExpand(currentItem.node.id);
        } else {
          // move to first child
          const childIndex = visibleNodes.findIndex((fn) => fn.parentId === currentItem.node.id);
          if (childIndex >= 0) {
            const childItem = visibleNodes[childIndex];
            if (childItem) {
              focusItem(childItem.node.id);
            }
          }
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

  function renderNodes(nodeList: TreeNode[], level = 0) {
    return nodeList.map((node) => {
      const hasChildren = Boolean(node.children && node.children.length > 0);
      const isExpanded = expandedIds.has(node.id);
      const isSelected = selectedId === node.id;
      const isFocused = focusedId === node.id;
      const nodeId = `${treeId}-${node.id}`;

      return (
        <div
          key={node.id}
          id={nodeId}
          ref={(element) => {
            if (element) {
              treeItemRefs.current.set(node.id, element);
            } else {
              treeItemRefs.current.delete(node.id);
            }
          }}
          role="treeitem"
          aria-level={level + 1}
          aria-expanded={hasChildren ? isExpanded : undefined}
          aria-selected={isSelected}
          tabIndex={isFocused ? 0 : -1}
          className={`${styles.item}${isFocused ? ` ${styles.focused}` : ""}`}
          onFocus={() => setFocusedId(node.id)}
          onKeyDown={(event) => handleKeyDown(event, node.id)}
          onClick={(e) => {
            e.stopPropagation();
            focusItem(node.id);
            if (hasChildren) {
              toggleExpand(node.id);
            }
            onSelect?.(node);
          }}
        >
          <div className={`${styles.row}${isSelected ? ` ${styles.selected}` : ""}`}>
            {hasChildren ? (
              <span className={`${styles.toggle}${isExpanded ? ` ${styles.expanded}` : ""}`}>
                ▶
              </span>
            ) : (
              <span style={{ width: "1rem" }} />
            )}
            {node.icon ? <span>{node.icon}</span> : null}
            <span>{node.label}</span>
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
