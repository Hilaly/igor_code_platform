/**
 * Перевод публичного адреса ядра в наш `Location` (docs/ui-extension-model.md).
 *
 * Место ровно одно и нарочно: `CoreDestination` — это то, что плагин собрал у себя в бандле, а
 * форма пути остаётся внутренним делом `apps/web`. Второй такой перевод означал бы, что канонизация
 * маршрутов чинится в двух местах, а ломается в одном.
 */

import type { CoreDestination } from "@sovereign/protocol";
import { normalizePagePath } from "@sovereign/browser-sdk/host";

import type { Location } from "../router.ts";

export function locationOfDestination(destination: CoreDestination): Location {
  switch (destination.kind) {
    case "home":
      return { page: { kind: "home" }, query: {} };
    case "session":
      return { page: { kind: "session", sessionId: destination.sessionId }, query: {} };
    case "new-session":
      return { page: { kind: "new-session" }, query: {} };
    case "session-archive":
      return { page: { kind: "session-archive" }, query: {} };
    case "settings":
      return { page: { kind: "settings", section: destination.section }, query: {} };
    case "plugin-page":
      return {
        page: {
          kind: "plugin",
          pluginId: destination.pluginId,
          pageId: destination.pageId,
          // Хвост хранится без ведущего слэша: `pathOf` приклеивает его сам.
          rest: normalizePagePath(destination.path ?? "").slice(1),
        },
        query: destination.query ?? {},
      };
  }
}
