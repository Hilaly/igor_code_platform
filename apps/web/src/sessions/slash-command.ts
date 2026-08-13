/**
 * Разбор `/команды` в тексте композера (docs/sessions-and-projects.md).
 *
 * Чистые функции без React и без запросов — та же дисциплина, что у `file-mention.ts`: по позиции
 * курсора видно, набирает ли человек команду, а подстановка возвращает новый текст и новую позицию
 * курсора. Каталог, клавиатура и сам запуск строятся поверх.
 *
 * Команда живёт только в начале черновика: `/` в середине текста — обычный символ, и путь `src/foo`
 * или дата `12/03` каталога не открывают.
 */

import {
  coreSessionCommandNames,
  isCoreSessionCommandName,
  type SessionSkillSummary,
  type SessionTemplateSummary,
} from "@sovereign/protocol";

/** Набираемая команда: где она кончается в тексте и что успели напечатать после `/`. */
export type SlashDraft = {
  end: number;
  query: string;
};

/**
 * Префикс явного запуска скила. Скил всегда назван им: незапрефиксованное имя принадлежит командам
 * ядра, и скил, назвавшийся `compact`, иначе перехватывал бы встроенную команду.
 */
export const skillPrefix = "skill:";

/**
 * Встроенные команды сессии. Имена приходят из контракта: занять их не может ни шаблон, ни плагин,
 * и знать об этом обязан и демон тоже (docs/sessions-and-projects.md). Здесь к каждому добавлен
 * только ключ подписи — переводится она, как всё остальное в интерфейсе.
 *
 * Ни одна команда не заводит нового поведения: каждая зовёт то, что панель чата уже умеет, — то же
 * правило, по которому написаны команды палитры.
 */
export const coreSessionCommands = coreSessionCommandNames.map((name) => ({
  name,
  descriptionKey: `chat.slash.${name}`,
}));

/** Строка каталога: то, что видно в списке под `/`. */
export type SlashEntry = {
  name: string;
  description: string;
  /** Скил, скрытый от модели: запустить его может только человек, и в списке это видно. */
  hidden?: boolean;
};

/** Набранная команда: имя и всё, что человек дописал после него. */
export type SlashInvocation = {
  name: string;
  arguments: string;
};

export function slashAt(text: string, caret: number): SlashDraft | undefined {
  if (!text.startsWith("/")) {
    return undefined;
  }

  const query = text.slice(1, caret);

  // Пробел кончает имя команды: дальше идут аргументы, и каталог там уже не нужен.
  if (caret === 0 || /\s/.test(query)) {
    return undefined;
  }

  return { end: caret, query };
}

/** Подставить выбранное имя вместо набираемого. Пробел после — аргументы дописываются сразу. */
export function applySlash(
  text: string,
  slash: SlashDraft,
  name: string,
): {
  text: string;
  caret: number;
} {
  const inserted = `/${name} `;

  return { text: `${inserted}${text.slice(slash.end)}`, caret: inserted.length };
}

/**
 * Что набрано в черновике: команда или обычное сообщение. `undefined` — сообщение, даже если внутри
 * него есть `/`.
 */
export function parseInvocation(text: string): SlashInvocation | undefined {
  if (!text.startsWith("/")) {
    return undefined;
  }

  const space = text.search(/\s/);
  const name = space === -1 ? text.slice(1) : text.slice(1, space);

  if (name === "") {
    return undefined;
  }

  return { name, arguments: space === -1 ? "" : text.slice(space + 1).trim() };
}

/** Команда ядра, если набранное имя принадлежит закрытому списку. */
export function coreCommandOf(invocation: SlashInvocation): string | undefined {
  return isCoreSessionCommandName(invocation.name) ? invocation.name : undefined;
}

/** Имя скила, если команда — это явный запуск. */
export function skillOf(invocation: SlashInvocation): string | undefined {
  return invocation.name.startsWith(skillPrefix)
    ? invocation.name.slice(skillPrefix.length)
    : undefined;
}

/**
 * Строка запуска скила. Одна на всех: её подставляет каталог, её же показывает лента, пока турн
 * ждёт очереди, — и разойтись они не могут.
 */
export function skillInvocation(name: string, instructions?: string): string {
  const invocation = `/${skillPrefix}${name}`;

  return instructions === undefined || instructions === ""
    ? invocation
    : `${invocation} ${instructions}`;
}

/**
 * Строка запуска шаблона. Одна на всех — по той же причине, что и у скила.
 */
export function templateInvocation(name: string, args?: string): string {
  return args === undefined || args === "" ? `/${name}` : `/${name} ${args}`;
}

/** Строки каталога под скилы сессии. */
export function skillEntries(skills: readonly SessionSkillSummary[]): SlashEntry[] {
  return skills.map((skill) => ({
    name: `${skillPrefix}${skill.name}`,
    description: skill.description,
    ...(skill.hidden ? { hidden: true } : {}),
  }));
}

/**
 * Строки каталога под шаблоны промптов. Имя без префикса: шаблон — это то же, что команда ядра, с
 * той разницей, что его написал человек (docs/file-resources.md).
 */
export function templateEntries(templates: readonly SessionTemplateSummary[]): SlashEntry[] {
  return templates.map((template) => ({ name: template.name, description: template.description }));
}

/**
 * Каталог под набранным запросом. Порядок задаёт вызывающий; здесь только отбор.
 *
 * Отбор по вхождению, а не по префиксу: имя скила приезжает с неймспейсом плагина, и `review`
 * обязан находить `starter.review`.
 */
export function slashCatalogue(query: string, entries: readonly SlashEntry[]): SlashEntry[] {
  const wanted = query.toLowerCase();

  return entries.filter((entry) => entry.name.toLowerCase().includes(wanted));
}
