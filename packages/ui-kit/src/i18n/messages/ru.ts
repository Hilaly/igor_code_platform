/** Русский каталог ядра: идёт в поставке (ADR-0028), остальные языки приносит плагин. */

import { coreNamespace, type CatalogRegistration } from "../catalog.ts";

export const coreRussian: CatalogRegistration = {
  namespace: coreNamespace,
  locale: "ru",
  messages: {
    "appearance.variant.light": "Светлая",
    "appearance.variant.dark": "Тёмная",
    "appearance.variant.system": "Как в системе",
    "appearance.scheme": "Цветовая схема",
    "diagnostics.title": "Диагностика",
    "state.loading": "Загрузка…",
    "state.empty": "Пока пусто",
    "state.failed": "Что-то пошло не так",
  },
};
