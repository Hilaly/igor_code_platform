/**
 * Публичная поверхность кита (ADR-0027). Наш интерфейс строится только из него: компонент, сделанный
 * «на месте» в `apps/web`, немедленно становится тем, что плагин воспроизвести не может.
 *
 * Стабильная часть контракта — токены: палитра, роли, объявление схемы и её применение. Всё
 * остальное пока нестабильно и ломается свободно, пока прикладной код не показал, какие примитивы
 * нужны на самом деле (ADR-0031).
 */

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
