/** Компонент раскрывающегося спискового аккордеона Accordion. */

import { useState, type ReactNode } from "react";

import styles from "./accordion.module.css";

export type AccordionItem = {
  id: string;
  title: string;
  content: ReactNode;
  disabled?: boolean;
};

export type AccordionProps = {
  items: AccordionItem[];
  multiple?: boolean;
  defaultExpandedIds?: string[];
};

export function Accordion({
  items,
  multiple = false,
  defaultExpandedIds = [],
}: AccordionProps) {
  const [expandedIds, setExpandedIds] = useState<string[]>(defaultExpandedIds);

  function toggleItem(id: string) {
    if (expandedIds.includes(id)) {
      setExpandedIds(expandedIds.filter((item) => item !== id));
    } else {
      setExpandedIds(multiple ? [...expandedIds, id] : [id]);
    }
  }

  return (
    <div className={styles.root}>
      {items.map((item) => {
        const isExpanded = expandedIds.includes(item.id);

        return (
          <div
            key={item.id}
            className={`${styles.item}${isExpanded ? ` ${styles.expanded}` : ""}`}
          >
            <button
              type="button"
              className={styles.header}
              aria-expanded={isExpanded}
              disabled={item.disabled}
              onClick={() => toggleItem(item.id)}
            >
              <span>{item.title}</span>
              <span className={styles.icon}>▼</span>
            </button>
            {isExpanded ? <div className={styles.content}>{item.content}</div> : null}
          </div>
        );
      })}
    </div>
  );
}
