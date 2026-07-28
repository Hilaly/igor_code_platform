/**
 * Публичная поверхность кита (docs/ui-kit.md). Наш интерфейс строится только из него: компонент, сделанный
 * «на месте» в `apps/web`, немедленно становится тем, что плагин воспроизвести не может.
 *
 * Стабильная часть контракта — токены: палитра, роли, объявление схемы и её применение. Набор
 * примитивов пока нестабилен и ломается свободно, пока прикладной код не показал, какие из них нужны
 * на самом деле (docs/ui-kit.md).
 *
 * Стили подключаются отдельно: `import "@sovereign/ui-kit/styles.css"` один раз в приложении.
 */

export * from "./components/badge.tsx";
export * from "./components/button.tsx";
export * from "./components/code.tsx";
export * from "./components/disclosure.tsx";
export * from "./components/list.tsx";
export * from "./components/notice.tsx";
export * from "./components/panel.tsx";
export * from "./components/select.tsx";
export * from "./components/state.tsx";
export * from "./components/text.tsx";
export * from "./components/toggle.tsx";
export * from "./i18n/catalog.ts";
export * from "./i18n/messages/en.ts";
export * from "./i18n/messages/ru.ts";
export * from "./i18n/translator.ts";
export * from "./tokens/apply.ts";
export * from "./tokens/palette.ts";
export * from "./tokens/roles.ts";
export * from "./tokens/scheme.ts";
export * from "./tokens/schemes/base.ts";
export * from "./tokens/schemes/check.ts";
export * from "./tokens/schemes/imperium.ts";
export * from "./tokens/schemes/neutral.ts";
export * from "./tokens/schemes/nord.ts";
export * from "./tokens/schemes/obsidian.ts";
export * from "./tokens/schemes/shipped.ts";
export * from "./tokens/schemes/terminal.ts";
