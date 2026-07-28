/** Компонент иерархического дерева Tree (древовидная навигация по объектам/файлам). */

import { useState, type ReactNode } from "react";

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
};

export function Tree({ nodes, selectedId, onSelect }: TreeProps) {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

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

  function renderNodes(nodeList: TreeNode[]) {
    return nodeList.map((node) => {
      const hasChildren = Boolean(node.children && node.children.length > 0);
      const isExpanded = expandedIds.has(node.id);
      const isSelected = selectedId === node.id;

      return (
        <div key={node.id} className={styles.item}>
          <button
            type="button"
            className={`${styles.row}${isSelected ? ` ${styles.selected}` : ""}`}
            onClick={() => {
              if (hasChildren) {
                toggleExpand(node.id);
              }
              onSelect?.(node);
            }}
          >
            {hasChildren ? (
              <span className={`${styles.toggle}${isExpanded ? ` ${styles.expanded}` : ""}`}>
                ▶
              </span>
            ) : (
              <span style={{ width: "1rem" }} />
            )}
            {node.icon ? <span>{node.icon}</span> : null}
            <span>{node.label}</span>
          </button>
          {hasChildren && isExpanded ? (
            <div className={styles.children}>{renderNodes(node.children!)}</div>
          ) : null}
        </div>
      );
    });
  }

  return <div className={styles.root} role="tree">{renderNodes(nodes)}</div>;
}
