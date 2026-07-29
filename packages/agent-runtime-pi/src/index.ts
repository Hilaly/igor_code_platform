/**
 * Реализация агентного рантайма на Pi. Единственный пакет, которому разрешён импорт
 * `@earendil-works/*` (docs/architecture.md); наружу отдаются только типы `@sovereign/protocol`.
 */

export * from "./catalogue.ts";
export * from "./credentials.ts";
export * from "./describe.ts";
export * from "./environment.ts";
