/**
 * Вкладки. Набор приходит данными, а не составляется из детей: у полосы вкладок один порядок, и он же
 * порядок обхода стрелками. Составной вариант (`Tabs` с детьми `Tab` и `TabPanel`) требует реестра
 * вкладок и сортировки по `compareDocumentPosition` — только чтобы узнать порядок, который вызывающий
 * уже знал. Здесь порядок известен из массива, и реестра нет вовсе.
 *
 * Клавиатура — по образцу вкладок из ARIA: стрелки и Home/End переставляют **фокус**, не выбирая
 * вкладку; выбор делает щелчок или Enter по нативной кнопке. Иначе проход по вкладкам с клавиатуры
 * дёргает содержимое страницы на каждом нажатии.
 */

import type { KeyboardEvent, ReactNode } from "react";
import { useId, useRef } from "react";

import { nextEnabledIndex } from "./roving-focus.ts";
import styles from "./tabs.module.css";

export type TabDescription = {
  id: string;
  label: string;
  disabled?: boolean;
  /** Содержимое панели. Рисуется только у выбранной вкладки. */
  content: ReactNode;
};

export type TabsProps = {
  tabs: TabDescription[];
  value: string;
  onChange: (value: string) => void;
  /** Название набора для скринридера: у полосы вкладок нет своей подписи. */
  label: string;
};

/**
 * Идентификатор вкладки приходит данными и может содержать что угодно, а `aria-controls` и
 * `aria-labelledby` разделяют значения пробелом: без кодирования ссылка распалась бы на две.
 */
function elementId(baseId: string, kind: "tab" | "panel", tabId: string): string {
  return `${baseId}-${kind}-${encodeURIComponent(tabId)}`;
}

export function Tabs({ tabs, value, onChange, label }: TabsProps) {
  const baseId = useId();
  const tabElements = useRef<(HTMLButtonElement | null)[]>([]);

  const isEnabled = (tab: TabDescription): boolean => tab.disabled !== true;
  /**
   * Единственная вкладка, доступная с Tab, — выбранная: остальные набираются стрелками. Права на фокус
   * она лишается, только если недоступна или выбранной вкладки в наборе нет вовсе, — иначе полоса
   * выпала бы из обхода клавиатурой целиком.
   *
   * Стрелки этот выбор не двигают: они переставляют фокус, а не выбор, и вернувшийся в полосу Tab
   * обязан попасть на выбранную вкладку, а не туда, где стрелки остановились в прошлый раз.
   */
  const rovingId =
    tabs.find((tab) => tab.id === value && isEnabled(tab))?.id ?? tabs.find(isEnabled)?.id;

  /** Home и End выражены тем же шагом от края набора, что и стрелки: см. `nextEnabledIndex`. */
  function focusTarget(key: string, index: number): number | undefined {
    switch (key) {
      case "ArrowRight":
      case "ArrowDown":
        return nextEnabledIndex(tabs, index, 1);
      case "ArrowLeft":
      case "ArrowUp":
        return nextEnabledIndex(tabs, index, -1);
      case "Home":
        return nextEnabledIndex(tabs, -1, 1);
      case "End":
        return nextEnabledIndex(tabs, tabs.length, -1);
      default:
        return undefined;
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number): void {
    const target = focusTarget(event.key, index);

    if (target === undefined) {
      return;
    }

    // Стрелки в полосе вкладок не прокручивают страницу: они переставляют фокус.
    event.preventDefault();
    tabElements.current[target]?.focus();
  }

  return (
    <div className={styles.root}>
      <div className={styles.list} role="tablist" aria-label={label}>
        {tabs.map((tab, index) => (
          <button
            key={tab.id}
            type="button"
            className={styles.tab}
            ref={(element) => {
              tabElements.current[index] = element;
            }}
            role="tab"
            id={elementId(baseId, "tab", tab.id)}
            aria-controls={elementId(baseId, "panel", tab.id)}
            aria-selected={tab.id === value}
            disabled={tab.disabled}
            tabIndex={tab.id === rovingId ? 0 : -1}
            onClick={() => onChange(tab.id)}
            onKeyDown={(event) => handleKeyDown(event, index)}
          >
            {tab.label}
          </button>
        ))}
      </div>
      {tabs.map((tab) => (
        <div
          key={tab.id}
          className={styles.panel}
          role="tabpanel"
          id={elementId(baseId, "panel", tab.id)}
          aria-labelledby={elementId(baseId, "tab", tab.id)}
          hidden={tab.id !== value}
          // Панель попадает в обход клавиатурой сама: содержимое в ней может быть нечитаемым текстом
          // без единого контрола, и до него иначе не добраться.
          tabIndex={0}
        >
          {/*
           * Скрытая панель остаётся в разметке — на неё ссылается `aria-controls` выбранной вкладки, —
           * но содержимое не рисуется: невидимое дерево не должно ни считать, ни грузить.
           */}
          {tab.id === value ? tab.content : undefined}
        </div>
      ))}
    </div>
  );
}
