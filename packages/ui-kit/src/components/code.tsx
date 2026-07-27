/**
 * Моноширинный блок: схема нагрузки, причина отказа, путь к папке плагина. Прокрутка и переносы
 * живут внутри блока — длинная строка не имеет права растягивать страницу.
 */

export type CodeBlockProps = {
  children: string;
};

export function CodeBlock({ children }: CodeBlockProps) {
  return <pre className="sv-code">{children}</pre>;
}

export type CodeProps = {
  children: string;
};

/** Строчный вариант: идентификатор или ключ внутри обычного текста. */
export function Code({ children }: CodeProps) {
  return <code className="sv-code-inline">{children}</code>;
}
