/**
 * Отбор инструментов агента шаблонами имён (docs/plugins.md).
 *
 * Метасимвол один — `*`, любой отрезок имени. Регулярных выражений здесь нет намеренно: автор
 * плагина пишет `file-*`, а не экранирует точки, и чужое выражение с возвратами стоило бы платформе
 * времени на каждом сборе набора.
 */

/**
 * Два списка: сначала применяется `include`, из результата вычитается `exclude`. **`exclude`
 * приоритетнее** — решение владельца продукта: набор инструментов растёт со временем, и запрет,
 * который перебивается разрешением, перестаёт быть запретом ровно тогда, когда появляется новый
 * инструмент под старым шаблоном.
 */
export type NamePatternSelection = {
  include: string[];
  exclude: string[];
};

/** Инструменты и скилы выбираются одним языком шаблонов и с одинаковыми безопасными правилами. */
export type AgentToolSelection = NamePatternSelection;
export type AgentSkillSelection = NamePatternSelection;

export function matchesToolPattern(pattern: string, toolName: string): boolean {
  return toRegExp(pattern).test(toolName);
}

/**
 * Имена в порядке набора, а не в порядке шаблонов: порядок собранного набора детерминирован
 * (docs/hooks.md), и отбор его не переставляет.
 */
export function selectNames(names: readonly string[], selection: NamePatternSelection): string[] {
  const included = selection.include.map(toRegExp);
  const excluded = selection.exclude.map(toRegExp);

  return names.filter(
    (name) =>
      included.some((pattern) => pattern.test(name)) &&
      !excluded.some((pattern) => pattern.test(name)),
  );
}

/** Обратная совместимость для существующих потребителей отбора инструментов. */
export function selectToolNames(names: readonly string[], selection: AgentToolSelection): string[] {
  return selectNames(names, selection);
}

const compiled = new Map<string, RegExp>();

function toRegExp(pattern: string): RegExp {
  const known = compiled.get(pattern);

  if (known !== undefined) {
    return known;
  }

  const source = pattern
    .split("*")
    .map((piece) => piece.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`))
    .join(".*");
  const expression = new RegExp(`^${source}$`);

  compiled.set(pattern, expression);

  return expression;
}
