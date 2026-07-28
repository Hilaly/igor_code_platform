/**
 * Моноширинный блок: схема нагрузки, причина отказа, путь к папке плагина. Прокрутка и переносы
 * живут внутри блока — длинная строка не имеет права растягивать страницу.
 */

import styles from "./code.module.css";

export type CodeBlockProps = {
  children: string;
};

export function CodeBlock({ children }: CodeBlockProps) {
  return <pre className={styles.block}>{children}</pre>;
}

export type CodeProps = {
  children: string;
};

/** Строчный вариант: идентификатор или ключ внутри обычного текста. */
export function Code({ children }: CodeProps) {
  return <code className={styles.inline}>{children}</code>;
}
