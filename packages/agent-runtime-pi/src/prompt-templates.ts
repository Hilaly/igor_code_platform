/**
 * Шаблоны промптов из файлов `commands/<name>.md` (docs/file-resources.md).
 *
 * Загрузчик живёт здесь, а не в демоне, по той же причине, по которой здесь живёт harness: читает
 * файлы `loadSourcedPromptTemplates` самого Pi, а `@earendil-works/*` разрешён только этому пакету
 * (docs/architecture.md). Наружу уезжает наша форма и наши диагностики; записи Pi границу не
 * пересекают.
 */

import { loadSourcedPromptTemplates, parseCommandArgs } from "@earendil-works/pi-agent-core";
import { NodeExecutionEnv } from "@earendil-works/pi-agent-core/node";

/** Где лежит корень шаблонов. Тот же словарь областей, что у файловых агентов и скилов. */
export type PromptTemplateScope = "user" | "project";

export type PromptTemplateRoot = {
  path: string;
  scope: PromptTemplateScope;
};

/** Шаблон, прочитанный из файла. `content` — тело без frontmatter, с плейсхолдерами аргументов. */
export type PromptTemplate = {
  name: string;
  description: string;
  content: string;
  scope: PromptTemplateScope;
};

/** Что пошло не так при чтении корня. Причина названа вместе с путём — как у файловых ресурсов. */
export type PromptTemplateDiagnostic = {
  scope: PromptTemplateScope;
  path: string;
  reason: string;
};

export type LoadedPromptTemplates = {
  templates: PromptTemplate[];
  diagnostics: PromptTemplateDiagnostic[];
};

/**
 * Прочитать шаблоны всех корней. Отсутствующий корень — не ошибка: папку `commands/` заводят тогда,
 * когда в ней появляется первый шаблон.
 *
 * Порядок корней задаёт вызывающий, и он же разрешает совпадение имён: здесь ничего не отбрасывается
 * — иначе проигравший шаблон исчез бы без следа, и объяснить человеку, почему его файл не работает,
 * было бы нечем.
 */
export async function loadPromptTemplates(
  roots: readonly PromptTemplateRoot[],
): Promise<LoadedPromptTemplates> {
  const environment = new NodeExecutionEnv({ cwd: process.cwd() });
  const loaded = await loadSourcedPromptTemplates(
    environment,
    roots.map((root) => ({ path: root.path, source: root.scope })),
  );

  return {
    templates: loaded.promptTemplates.map(({ promptTemplate, source }) => ({
      name: promptTemplate.name,
      description: promptTemplate.description ?? "",
      content: promptTemplate.content,
      scope: source,
    })),
    diagnostics: loaded.diagnostics.map((diagnostic) => ({
      scope: diagnostic.source,
      path: diagnostic.path,
      reason: diagnostic.message,
    })),
  };
}

/**
 * Разобрать строку аргументов так же, как её разберёт подстановка. Своих правил кавычек платформа
 * не заводит: `$1` и `${@:2}` считает Pi, и второй разбор рядом разошёлся бы с ним на первой же
 * строке с кавычками.
 */
export function parsePromptTemplateArguments(args: string): string[] {
  return parseCommandArgs(args);
}
