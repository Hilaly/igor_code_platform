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

import type { SessionSkillSummary } from "@sovereign/protocol";

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
 * Встроенные команды сессии. Закрытый список: только эти имена ходят без префикса, и занять их
 * ничем нельзя. Ни одна не заводит нового поведения — каждая зовёт то, что панель чата уже умеет,
 * по тому же правилу, что и команды палитры.
 */
export const coreSessionCommands = [
  { name: "compact", descriptionKey: "chat.slash.compact" },
  { name: "fork", descriptionKey: "chat.slash.fork" },
  { name: "rename", descriptionKey: "chat.slash.rename" },
  { name: "archive", descriptionKey: "chat.slash.archive" },
] as const;

export type CoreSessionCommandName = (typeof coreSessionCommands)[number]["name"];

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
 * Каталог под набранным запросом. Команды ядра идут первыми: их четыре и они всегда применимы, а
 * скилов бывают десятки — и искать четыре знакомых имени в их хвосте человеку незачем.
 *
 * Отбор по вхождению, а не по префиксу: имя скила приезжает с неймспейсом плагина, и `review`
 * обязан находить `starter.review`.
 */
export function slashCatalogue(
  query: string,
  core: SlashEntry[],
  skills: SessionSkillSummary[],
): SlashEntry[] {
  const wanted = query.toLowerCase();
  const entries: SlashEntry[] = [
    ...core,
    ...skills.map((skill) => ({
      name: `${skillPrefix}${skill.name}`,
      description: skill.description,
      ...(skill.hidden ? { hidden: true } : {}),
    })),
  ];

  return entries.filter((entry) => entry.name.toLowerCase().includes(wanted));
}
