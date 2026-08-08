/**
 * Отдача собранного браузерного кода плагина (docs/web-api.md, docs/ui-extension-model.md). Маршрут
 * ядра, а не плагина: байты принадлежат платформе, и ходить за ними через таблицу вкладов незачем.
 *
 * Файловой системы этот маршрут не касается вовсе — сегменты пути служат ключами `Map`, поэтому
 * обходить каталог через `..` тут нечего.
 */

import { pluginAssetPathPattern } from "@sovereign/protocol";

import { respondWithError, type Route } from "../http/public.ts";
import type { PluginSupervisor } from "./plugin-supervisor.ts";

/**
 * Год — потолок, который признаёт спецификация кеширования. Вместе с `immutable` это значит «больше
 * не спрашивай»: ревизия в адресе делает повторный запрос бессмысленным по построению, поэтому ни
 * `ETag`, ни `304` тут не нужны.
 *
 * `private`, а не `public`: ответ доступен только по сессии, и разделяемому кешу класть его в общий
 * котёл нельзя.
 */
const cacheControl = "private, max-age=31536000, immutable";

/** Чужого типа в ответе не появится: расширение не из этого списка — не ассет плагина. */
const contentTypes: Record<string, string> = {
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".map": "application/json; charset=utf-8",
};

export type PluginAssetSources = {
  plugins: Pick<PluginSupervisor, "browserAsset">;
};

export function pluginAssetsRoute(sources: PluginAssetSources): Route {
  return {
    method: "GET",
    // `access` не указан намеренно: бандл плагина — внутренность приложения, и сессия ему нужна.
    path: pluginAssetPathPattern,
    handle: ({ response, parameters }) => {
      const { pluginKey, revision, file } = parameters as Record<
        "pluginKey" | "revision" | "file",
        string
      >;
      const contentType = contentTypes[extensionOf(file)];

      if (contentType === undefined) {
        respondWithError(response, 404, `${file} is not a plugin asset`);
        return;
      }

      const contents = sources.plugins.browserAsset(pluginKey, revision, file);

      if (contents === undefined) {
        // Отдельный текст про ревизию: страница, открытая до перезагрузки плагина, обязана отличить
        // «сборки больше нет, обновись» от опечатки в адресе.
        respondWithError(
          response,
          404,
          `there is no revision ${revision} of ${pluginKey} any more, reload the page`,
        );
        return;
      }

      response.writeHead(200, {
        "content-type": contentType,
        "content-length": contents.byteLength,
        "cache-control": cacheControl,
      });
      response.end(contents);
    },
  };
}

function extensionOf(file: string): string {
  const dot = file.lastIndexOf(".");

  return dot === -1 ? "" : file.slice(dot);
}
