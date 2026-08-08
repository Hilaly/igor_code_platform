/**
 * Сборка браузерной части плагина (docs/ui-extension-model.md). Собирает демон, а не автор плагина:
 * иначе в репозитории плагина лежал бы собранный код, а singleton-зависимости хоста пришлось бы
 * согласовывать честным словом.
 *
 * Модуль без состояния и без журнала: он отвечает исходом, а решает вызывающий, — как и сосед
 * `plugin-dependencies.ts`. Прошлые ревизии помнит хранилище, здесь памяти нет.
 */

import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";

import { build, formatMessages, stop, type Plugin } from "esbuild";
import {
  hostModuleRegistryKey,
  hostModuleSpecifiers,
  pluginBrowserFileNames,
} from "@sovereign/protocol";

/** Собранный бандл целиком: имя файла → содержимое. Диска он не касается (docs/data-directory.md). */
export type PluginBrowserBundle = {
  /** Ревизия содержимого; она же сегмент адреса и ключ кеша браузера. */
  revision: string;
  files: ReadonlyMap<string, Uint8Array>;
};

export type BrowserBuildOutcome =
  /** Плагин не объявил `sovereign.browser`: интерфейса у него нет, и собирать нечего. */
  | { kind: "not-needed" }
  | { kind: "built"; bundle: PluginBrowserBundle }
  /** Причина — текст esbuild с файлом и строкой: человеку чинить именно его. */
  | { kind: "failed"; reason: string };

export type BuildPluginBrowserOptions = {
  /** Едет в имена классов CSS Modules: между плагинами их разводит платформа, а не сборщик. */
  pluginKey: string;
  directory: string;
  /** Путь точки входа относительно папки плагина; его отсутствие — не ошибка. */
  browserEntry?: string;
};

/**
 * Длина ревизии в символах base64url. 12 символов это 72 бита: коллизия между двумя ревизиями
 * одного плагина невозможна на практике, а адрес остаётся читаемым в журнале и в Network.
 */
const revisionLength = 12;

/** Виртуальный каталог выхода: с `write: false` он никогда не создаётся, но esbuild требует имени. */
const outputDirectoryName = "__sovereign-browser__";

const hostModuleNamespace = "sovereign-host-module";
const scopedCssNamespace = "sovereign-scoped-css";

export async function buildPluginBrowser(
  options: BuildPluginBrowserOptions,
): Promise<BrowserBuildOutcome> {
  const { pluginKey, directory, browserEntry } = options;

  if (browserEntry === undefined) {
    return { kind: "not-needed" };
  }

  try {
    const result = await build({
      absWorkingDir: directory,
      entryPoints: [resolve(directory, browserEntry)],
      outdir: join(directory, outputDirectoryName),
      // Одна точка входа и никакого code splitting: выход обязан быть плоским, иначе в адресе
      // ассета не хватило бы одного сегмента файла.
      entryNames: basename(pluginBrowserFileNames.script, ".js"),
      bundle: true,
      format: "esm",
      platform: "browser",
      target: ["es2022"],
      jsx: "automatic",
      // Результат нужен в памяти: собранного кода на диске не появляется вовсе.
      write: false,
      // Иначе esbuild печатает ошибку сборки плагина в stdout демона мимо журнала (docs/logging.md).
      logLevel: "silent",
      // `minifyIdentifiers` выключен намеренно: он схлопывает и локальные имена CSS Modules до
      // одной буквы, а на них смотрит человек, отлаживающий чужой интерфейс.
      minifyWhitespace: true,
      minifySyntax: true,
      minifyIdentifiers: false,
      sourcemap: "linked",
      define: { "process.env.NODE_ENV": '"production"' },
      // Мелкие ассеты инлайнятся: отдельный файл сломал бы плоский выход, а ссылка на него —
      // адресацию по ревизии.
      loader: { ".svg": "dataurl", ".png": "dataurl", ".woff2": "dataurl" },
      plugins: [hostModulesPlugin(), scopedCssModulesPlugin(pluginKey)],
    });

    const files = new Map<string, Uint8Array>(
      result.outputFiles.map((file) => [basename(file.path), file.contents]),
    );

    return { kind: "built", bundle: { revision: revisionOf(files), files } };
  } catch (cause) {
    return { kind: "failed", reason: await describeBuildFailure(cause) };
  }
}

/**
 * Остановить сборщик. esbuild держит дочерний процесс-сервис, и без этого демон не завершается —
 * его же требует и остановка тестового прогона.
 */
export function stopPluginBrowserBuilds(): void {
  stop();
}

/**
 * Подмена singleton-зависимостей хоста заглушкой, читающей глобальный реестр
 * (docs/ui-extension-model.md). Фильтр ловит спецификатор от любого импортёра, поэтому чужой React,
 * приехавший транзитивной зависимостью плагина, перехватывается тоже.
 */
function hostModulesPlugin(): Plugin {
  const filter = new RegExp(`^(${hostModuleSpecifiers.map(escapeForRegExp).join("|")})$`);

  return {
    name: "sovereign-host-modules",
    setup(build) {
      build.onResolve({ filter }, (args) => ({ path: args.path, namespace: hostModuleNamespace }));

      // Заглушка именно CommonJS: esbuild разворачивает импорты из неё через `__toESM`, и
      // перечислять имена экспортов не нужно ни здесь, ни в браузере — работают и именованный,
      // и default, и namespace-импорт.
      build.onLoad({ filter: /.*/, namespace: hostModuleNamespace }, (args) => ({
        contents: hostModuleStub(args.path),
        loader: "js",
      }));
    },
  };
}

function hostModuleStub(specifier: string): string {
  const key = JSON.stringify(hostModuleRegistryKey);
  const name = JSON.stringify(specifier);

  // Отсутствие модуля в реестре — ошибка, а не `undefined`: без явного текста автор плагина
  // получил бы «Cannot read properties of undefined» где-то в глубине своего кода.
  return `var registry = globalThis[${key}];
var value = registry === undefined ? undefined : registry[${name}];
if (value === undefined) {
  throw new Error("the host module " + ${name} + " is not registered in globalThis[" + ${key} + "]");
}
module.exports = value;
`;
}

/**
 * Уникальность имён классов CSS Modules между плагинами. У esbuild в имени класса нет хеша вовсе —
 * имя это `<файл>_<локальное имя>`, а уникальность обеспечена счётчиком внутри одной сборки. Два
 * плагина с одинаковым `badge.module.css`, собранные по отдельности, молча перекрыли бы друг друга,
 * поэтому ключ плагина въезжает в имя файла, из которого esbuild составляет имя класса.
 */
function scopedCssModulesPlugin(pluginKey: string): Plugin {
  const prefix = cssSafeKey(pluginKey);

  return {
    name: "sovereign-scoped-css-modules",
    setup(build) {
      build.onResolve({ filter: /\.module\.css$/ }, async (args) => {
        const source = resolve(args.resolveDir, args.path);

        // Несуществующий файл отдаётся обратно esbuild: он напишет обычное «Could not resolve» с
        // местом импорта, тогда как ошибка из `onLoad` приехала бы автору плагина вместе со стеком
        // по нашим модулям и по внутренностям esbuild.
        if (!(await isReadableFile(source))) {
          return undefined;
        }

        return {
          path: join(dirname(source), `${prefix}--${basename(source)}`),
          namespace: scopedCssNamespace,
          pluginData: { source },
        };
      });

      build.onLoad({ filter: /.*/, namespace: scopedCssNamespace }, async (args) => {
        const source = (args.pluginData as { source: string }).source;

        return {
          contents: await readFile(source, "utf8"),
          loader: "local-css",
          // Настоящий каталог исходника: из него резолвятся `composes ... from` и `url()`.
          resolveDir: dirname(source),
        };
      });
    },
  };
}

/** Существование файла проверяется до подмены пути, а не ловится исключением при чтении. */
async function isReadableFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === "ENOENT") {
      return false;
    }

    throw cause;
  }
}

/**
 * Ключ плагина содержит двоеточия (`project:<проект>:<id>`), а имя класса CSS их не допускает.
 * Base64url кодирует ключ целиком: он обратим, не содержит небезопасных символов и не позволяет
 * разным ключам схлопнуться в один префикс.
 */
function cssSafeKey(pluginKey: string): string {
  return Buffer.from(pluginKey).toString("base64url");
}

function escapeForRegExp(value: string): string {
  return value.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
}

/**
 * Ревизия — содержимое, а не счётчик и не время. Счётчик после перезапуска демона начинается заново,
 * и по закешированному `immutable`-адресу браузер отдал бы чужой код; mtime не переживает
 * `git checkout`. От содержимого же ревизия не меняется, пока не менялся исходник, — а демон в
 * разработке перезапускается на каждую свою правку.
 */
function revisionOf(files: ReadonlyMap<string, Uint8Array>): string {
  const digest = createHash("sha256");

  for (const name of [...files.keys()].sort()) {
    digest.update(name);
    digest.update(files.get(name) ?? new Uint8Array());
  }

  return digest.digest("base64url").slice(0, revisionLength);
}

async function describeBuildFailure(cause: unknown): Promise<string> {
  const errors = (cause as { errors?: unknown }).errors;

  if (!Array.isArray(errors) || errors.length === 0) {
    return cause instanceof Error ? cause.message : String(cause);
  }

  const formatted = await formatMessages(errors, { kind: "error", color: false });

  return formatted.join("\n").trim();
}
