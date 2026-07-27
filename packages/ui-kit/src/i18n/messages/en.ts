/**
 * Базовый каталог ядра. Ключи и исходные строки на английском (ADR-0028): по ним же видно, чего не
 * хватает в остальных локалях.
 */

import { coreNamespace, type CatalogRegistration } from "../catalog.ts";

export const coreEnglish: CatalogRegistration = {
  namespace: coreNamespace,
  locale: "en",
  messages: {
    "appearance.variant.light": "Light",
    "appearance.variant.dark": "Dark",
    "appearance.variant.system": "System",
    "appearance.scheme": "Colour scheme",
    "diagnostics.title": "Diagnostics",
    "state.loading": "Loading…",
    "state.empty": "Nothing here yet",
    "state.failed": "Something went wrong",
  },
};
