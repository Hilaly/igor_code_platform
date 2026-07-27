/**
 * Базовый каталог ядра. Ключи и исходные строки на английском (ADR-0028): по ним же видно, чего не
 * хватает в остальных локалях.
 */

import { coreNamespace, type CatalogRegistration } from "../catalog.ts";

export const coreEnglish: CatalogRegistration = {
  namespace: coreNamespace,
  locale: "en",
  messages: {
    "appearance.variant": "Theme",
    "appearance.variant.light": "Light",
    "appearance.variant.dark": "Dark",
    "appearance.variant.system": "System",
    "appearance.scheme": "Colour scheme",
    "appearance.scheme.base": "Base",
    "appearance.scheme.check": "Check (deliberately loud)",
    "appearance.locale": "Language",
    "connection.connecting": "Connecting",
    "connection.open": "Connected",
    "connection.reconnecting": "Reconnecting",
    "daemon.title": "Daemon",
    "daemon.uptime": "up {duration}",
    "daemon.unreachable": "Unreachable: {reason}",
    "diagnostics.title": "Diagnostics",
    "diagnostics.empty": "Nothing to report",
    "duration.hours": "{count}h",
    "duration.minutes": "{count}m",
    "duration.seconds": "{count}s",
    "nav.title": "Views",
    "nav.home": "Overview",
    "page.home.title": "The shell is up",
    "page.home.hint": "The plugin view lands here next.",
    "page.plugin.title": "This page belongs to a plugin",
    "page.plugin.hint": "Plugin pages arrive with the browser code the daemon builds.",
    "page.unknown.title": "No such page",
    "page.unknown.hint": "The address {path} does not match anything the shell knows.",
    "panel.left": "Navigation",
    "panel.right": "Side panel",
    "state.loading": "Loading…",
    "state.empty": "Nothing here yet",
    "state.failed": "Something went wrong",
  },
};
