/**
 * Публичная поверхность кита (docs/ui-kit.md). Наш интерфейс строится только из него: компонент, сделанный
 * «на месте» в `apps/web`, немедленно становится тем, что плагин воспроизвести не может.
 *
 * Стабильная часть контракта — токены: палитра, роли, объявление схемы и её применение. Набор
 * примитивов пока нестабилен и ломается свободно, пока прикладной код не показал, какие из них нужны
 * на самом деле (docs/ui-kit.md).
 *
 * Стили подключаются отдельно: `import "@sovereign/ui-kit/styles.css"` один раз в приложении;
 * оформление самих примитивов приезжает вместе с их импортом файлами `*.module.css`.
 *
 * Наружу выходят только примитивы и токены. Фокус-трап диалога (`hooks/use-focus-trap.ts`) и счёт
 * перемещения фокуса по кругу (`components/roving-focus.ts`) остаются внутренними: это внутренности
 * двух конкретных примитивов, а не то, из чего строят интерфейс.
 */

export * from "./components/accordion.tsx";
export * from "./components/badge.tsx";
export * from "./components/brand-lockup.tsx";
export * from "./components/breadcrumbs.tsx";
export * from "./components/button.tsx";
export * from "./components/code.tsx";
export * from "./components/combobox.tsx";
export * from "./components/dialog.tsx";
export * from "./components/disclosure.tsx";
export * from "./components/field.tsx";
export * from "./components/file-picker.tsx";
export * from "./components/form.tsx";
export * from "./components/icon.tsx";
export * from "./components/input.tsx";
export * from "./components/icons.tsx";
export * from "./components/link.tsx";
export * from "./components/list.tsx";
export * from "./components/markdown.tsx";
export * from "./components/menu.tsx";
export * from "./components/message-feed.tsx";
export * from "./components/model-picker.tsx";
export * from "./components/multi-select.tsx";
export * from "./components/notice.tsx";
export * from "./components/panel.tsx";
export * from "./components/popover.tsx";
export * from "./components/progress.tsx";
export * from "./components/radio-group.tsx";
export * from "./components/raised-surface.tsx";
export * from "./components/segmented-control.tsx";
export * from "./components/select.tsx";
export * from "./components/skeleton.tsx";
export * from "./components/settings-frame.tsx";
export * from "./components/slider.tsx";
export * from "./components/state.tsx";
export * from "./components/status-dot.tsx";
export * from "./components/streaming-text.tsx";
export * from "./components/tabs.tsx";
export * from "./components/text.tsx";
export * from "./components/toast.tsx";
export * from "./components/toggle.tsx";
export * from "./components/tool-call.tsx";
export * from "./components/tooltip.tsx";
export * from "./components/tree.tsx";
export * from "./components/tree-context-card.tsx";
export * from "./components/view-header.tsx";
export * from "./i18n/catalog.ts";
export * from "./i18n/messages/en.ts";
export * from "./i18n/messages/ru.ts";
export * from "./i18n/translator.ts";
export * from "./tokens/apply.ts";
export * from "./tokens/palette.ts";
export * from "./tokens/roles.ts";
export * from "./tokens/scheme.ts";
export * from "./tokens/schemes/imperium.ts";
export * from "./tokens/schemes/nord.ts";
export * from "./tokens/schemes/oled.ts";
export * from "./tokens/schemes/sage.ts";
export * from "./tokens/schemes/shipped.ts";
