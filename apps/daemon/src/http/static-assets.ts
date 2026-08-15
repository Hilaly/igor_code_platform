/**
 * Отдача собранного фронтенда (docs/toolchain.md, docs/web-api.md). Тот же слой, что у браузерных
 * ассетов плагина: байты лежат в памяти, путь служит ключом `Map`, файловой системы маршрут не
 * касается вовсе — значит и обходить каталог через `..` тут нечего.
 *
 * Каталога со статикой рядом с артефактом не существует, поэтому не существует и отказа «приложение
 * запустилось, а интерфейса нет». Нет нагрузки — значит это разработка, и маршрута нет вовсе:
 * интерфейс в этом режиме отдаёт Vite (docs/runbook.md).
 */

import { pluginAssetPrefix } from "@sovereign/protocol";

import type { PayloadFiles } from "../platform/public.ts";
import { respondWithError, type Route } from "./dispatcher.ts";

/** Точка входа приложения. Она же ответ на любой адрес, который принадлежит браузерному роутеру. */
export const indexFileName = "index.html";

/**
 * Имена внутри `assets/` несут хеш содержимого — их ставит сборка фронтенда, — поэтому повторный
 * запрос по тому же адресу бессмысленен по построению: новая сборка это новый адрес. `public`, а
 * не `private`, как у ассетов плагина: этот ответ отдаётся и без сессии, секрета в нём нет.
 */
const immutableCacheControl = "public, max-age=31536000, immutable";

/**
 * У `index.html` адрес один на все версии, и закешированный намертво он показал бы старое
 * приложение после обновления артефакта. `no-cache` — это не «не кешируй», а «спроси перед тем как
 * взять»: документ маленький, а ассеты за ним всё равно неизменяемые.
 */
const documentCacheControl = "no-cache";

/** Хешированные имена сборки фронтенда лежат здесь, и только они отдаются неизменяемыми. */
const immutableDirectory = "assets/";

/** Чужого типа в ответе не появится: расширение не из этого списка — не файл фронтенда. */
const contentTypes: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/vnd.microsoft.icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
};

/**
 * Корни, которые фронтенду не принадлежат ни при каких обстоятельствах. Без них `GET /api/нет-такого`
 * отвечал бы страницей приложения вместо json-отказа, то есть клиент получал бы `200` и разбирал бы
 * HTML как ответ API — худший вид отказа, потому что он выглядит удачей.
 */
const foreignPrefixes = ["api", pluginAssetPrefix.replace("/", "")];

export function staticAssetsRoute(files: PayloadFiles): Route {
  return {
    method: "GET",
    path: "/*",
    // Открыт намеренно: форма входа обязана загрузиться до всякой сессии, иначе войти нечем.
    // Ассеты плагина остаются за сессией — они внутренность работающего приложения, а не вход в него.
    access: "open",
    handle: ({ response, url }) => {
      const path = url.pathname.replace(/^\/+/, "");

      if (foreignPrefixes.includes(path.split("/")[0] ?? "")) {
        respondWithError(response, 404, "not found");

        return;
      }

      const contents = files.get(path);

      if (contents !== undefined) {
        send(response, path, contents);

        return;
      }

      // Адрес, которого нет среди файлов, принадлежит маршрутизатору в браузере: `/settings/plugins`
      // и `/p/<плагин>/<страница>/*` обязаны переживать перезагрузку страницы (apps/web/src/router.ts).
      // Промах **с расширением** — это промах по файлу, и отвечать на него приложением нельзя:
      // отсутствующий скрипт вернулся бы как HTML и упал бы разбором в браузере.
      const document = extensionOf(path) === "" ? files.get(indexFileName) : undefined;

      if (document === undefined) {
        respondWithError(response, 404, "not found");

        return;
      }

      send(response, indexFileName, document);
    },
  };
}

function send(
  response: Parameters<Route["handle"]>[0]["response"],
  path: string,
  contents: Uint8Array,
): void {
  response.writeHead(200, {
    "content-type": contentTypes[extensionOf(path)] ?? "application/octet-stream",
    "content-length": contents.byteLength,
    "cache-control": path.startsWith(immutableDirectory)
      ? immutableCacheControl
      : documentCacheControl,
  });
  response.end(contents);
}

function extensionOf(path: string): string {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");

  return dot === -1 ? "" : name.slice(dot);
}
