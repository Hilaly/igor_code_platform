/**
 * Разбор `@файл` в тексте композера (docs/sessions-and-projects.md).
 *
 * Чистые функции без React и без запросов: по позиции курсора видно, набирает ли человек ссылку на
 * файл, а подстановка возвращает новый текст и новую позицию курсора. Всё остальное — подсказка,
 * клавиатура и запрос — строится поверх.
 *
 * В отправленное сообщение `@файл` уезжает обычным текстом: содержимое читает агент своим `read`.
 */

/** Набираемая ссылка: где она начинается в тексте и что успели напечатать после `@`. */
export type FileMention = {
  start: number;
  end: number;
  query: string;
};

/**
 * `@` начинает ссылку только в начале слова: адрес почты и `@` внутри слова ссылкой не считаются.
 * Пробел ссылку заканчивает — путь с пробелом набрать так нельзя, и это осознанно: подсказка
 * подставляет путь целиком, а руками такой путь всё равно не наберёшь без ошибки.
 */
export function mentionAt(text: string, caret: number): FileMention | undefined {
  const before = text.slice(0, caret);
  const at = before.lastIndexOf("@");

  if (at === -1) {
    return undefined;
  }

  const query = before.slice(at + 1);

  if (/[\s]/.test(query)) {
    return undefined;
  }

  const preceding = at === 0 ? "" : before[at - 1];

  if (preceding !== "" && !/[\s(]/.test(preceding ?? "")) {
    return undefined;
  }

  return { start: at, end: caret, query };
}

/** Подставить выбранный путь вместо набираемой ссылки. Пробел после — следующее слово начинается сразу. */
export function applyMention(
  text: string,
  mention: FileMention,
  path: string,
): { text: string; caret: number } {
  const inserted = `@${path} `;

  return {
    text: `${text.slice(0, mention.start)}${inserted}${text.slice(mention.end)}`,
    caret: mention.start + inserted.length,
  };
}
