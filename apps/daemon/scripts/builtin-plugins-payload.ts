/**
 * Сбор встроенных плагинов в нагрузку артефакта (docs/toolchain.md). В артефакт едут исходники
 * плагина и его рантайм-зависимости, а на диске из них получается обычный корень плагинов: воркер
 * плагина — отдельный поток со своим разрешением модулей, и «из памяти» ему подсунуть нечего.
 *
 * SDK едет **собранным**, а не исходниками. Node отказывается стирать типы у файлов под
 * `node_modules` (`ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`, runtime-checks.md, проверка 39), а
 * в разработке это не видно: pnpm кладёт туда симлинк, и настоящий путь оказывается вне
 * `node_modules`. Распакованный плагин симлинков не содержит, поэтому TypeScript в его
 * `node_modules` не запустился бы вовсе.
 */

import { readFileSync, readdirSync } from "node:fs";
import { basename, join, relative, sep } from "node:path";

import { build } from "esbuild";

/** Имя папки, в которую плагину кладутся его зависимости. Совпадать с ожиданиями Node обязано. */
const modulesDirectoryName = "node_modules";

/**
 * Пакеты рабочего пространства, которые сборка умеет класть плагину. Список закрытый: незнакомая
 * зависимость обязана уронить сборку, а не доехать до пользователя плагином, который не стартует.
 */
const shippedWorkspacePackages = ["@sovereign/sdk"];

/**
 * Что в плагине не нужно рантайму. Тесты и конфигурация инструментов — это про репозиторий: они
 * тянут `vitest`, `@testing-library` и прочее, чего рядом с распакованным плагином нет и не будет.
 */
const developmentOnlyFileNames = new Set(["tsconfig.json", "vitest.config.ts"]);

export type BuiltinPluginsOptions = {
  /** Корень `plugins/` репозитория. */
  pluginsRoot: string;
  /** Корень `packages/` репозитория: оттуда берутся исходники пакетов рабочего пространства. */
  packagesRoot: string;
};

/**
 * Содержимое встроенных плагинов: ключ — путь от корня встроенных (`starter/package.json`).
 * Разделитель всегда `/`, как и у статики: путь собирается обратно при распаковке.
 */
export async function readBuiltinPlugins(
  options: BuiltinPluginsOptions,
): Promise<Map<string, Uint8Array>> {
  const files = new Map<string, Uint8Array>();
  const shipped = new Map<string, Map<string, Uint8Array>>();

  for (const directory of builtinPluginDirectories(options.pluginsRoot)) {
    const plugin = basename(directory);

    for (const [path, bytes] of readPluginFiles(directory)) {
      files.set(`${plugin}/${path}`, bytes);
    }

    for (const dependency of declaredDependencies(directory, plugin)) {
      // Собирается один раз на все плагины, а кладётся каждому свой экземпляр: `node_modules`
      // рядом с манифестом — то, что делает установку зависимостей ненужной (docs/plugins.md).
      let contents = shipped.get(dependency);

      if (contents === undefined) {
        contents = await buildWorkspacePackage(options.packagesRoot, dependency);
        shipped.set(dependency, contents);
      }

      for (const [path, bytes] of contents) {
        files.set(`${plugin}/${modulesDirectoryName}/${dependency}/${path}`, bytes);
      }
    }
  }

  return files;
}

/**
 * Папки, объявившие себя плагином. Обход тот же, что у демона (`plugins/plugin-sources.ts`): папка
 * без манифеста — не плагин, а `README.md` рядом с плагинами — не папка.
 */
function builtinPluginDirectories(root: string): string[] {
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
    .map((entry) => join(root, entry.name))
    .filter((directory) => readManifest(directory) !== undefined)
    .sort();
}

function readPluginFiles(directory: string): Map<string, Uint8Array> {
  const files = new Map<string, Uint8Array>();

  for (const entry of readdirSync(directory, { recursive: true, withFileTypes: true })) {
    const absolute = join(entry.parentPath, entry.name);
    const path = relative(directory, absolute).split(sep).join("/");

    if (!entry.isFile() || !isShipped(path)) {
      continue;
    }

    files.set(path, readFileSync(absolute));
  }

  return files;
}

function isShipped(path: string): boolean {
  const segments = path.split("/");
  const name = segments.at(-1) ?? "";

  return (
    !segments.includes(modulesDirectoryName) &&
    !segments.some((segment) => segment.startsWith(".")) &&
    !developmentOnlyFileNames.has(name) &&
    !name.includes(".test.") &&
    !name.includes(".test-helper.")
  );
}

/**
 * Зависимости плагина по его манифесту. Незнакомая роняет сборку: `node_modules` у распакованного
 * плагина есть, значит установка зависимостей сочтёт их привезёнными и ничего не поставит
 * (`platform/npm-dependencies.ts`), а плагин упадёт на импорте уже у пользователя.
 */
function declaredDependencies(directory: string, plugin: string): string[] {
  const manifest = readManifest(directory);
  const declared = (manifest as { dependencies?: Record<string, string> } | undefined)
    ?.dependencies;
  const names = Object.keys(declared ?? {});

  for (const name of names) {
    if (!shippedWorkspacePackages.includes(name)) {
      throw new Error(
        `the builtin plugin ${plugin} depends on ${name}, which the artifact build does not know how to ship: add it to shippedWorkspacePackages or drop the dependency`,
      );
    }
  }

  return names;
}

function readManifest(directory: string): unknown {
  let raw: string;

  try {
    raw = readFileSync(join(directory, "package.json"), "utf8");
  } catch (cause) {
    if (cause instanceof Error && (cause as { code?: unknown }).code === "ENOENT") {
      return undefined;
    }

    throw cause;
  }

  return JSON.parse(raw);
}

/**
 * Сборка пакета рабочего пространства в то, что кладётся плагину. Точки входа — все, объявленные в
 * `exports` пакета, и общий код между ними остаётся общим (`splitting`): у SDK есть модульное
 * состояние — списки подписчиков и обработчиков, — и две копии одного модуля развели бы плагин,
 * подписавшийся через одну точку входа, с платформой, спрашивающей через другую.
 */
async function buildWorkspacePackage(
  packagesRoot: string,
  name: string,
): Promise<Map<string, Uint8Array>> {
  const directory = join(packagesRoot, name.replace("@sovereign/", ""));
  const manifest = readManifest(directory) as {
    version?: string;
    exports?: Record<string, string>;
  };
  const exported = Object.entries(manifest.exports ?? {});

  if (exported.length === 0) {
    throw new Error(`${name} declares no exports, so there is nothing to ship to a plugin.`);
  }

  const result = await build({
    absWorkingDir: directory,
    entryPoints: Object.fromEntries(exported.map(([key, source]) => [entryName(key), source])),
    outdir: join(directory, "__sovereign-builtin__"),
    bundle: true,
    splitting: true,
    format: "esm",
    // Ни `node`, ни `browser`: тот же собранный SDK читает и воркер плагина, и сборка его браузерной
    // части, а сам он ни на что из Node не опирается.
    platform: "neutral",
    target: ["node24"],
    // Результат нужен в памяти: собранного кода в репозитории не появляется.
    write: false,
    logLevel: "warning",
  });

  const files = new Map<string, Uint8Array>(
    result.outputFiles.map((file) => [basename(file.path), file.contents]),
  );

  files.set(
    "package.json",
    Buffer.from(shippedManifest(name, manifest.version ?? "0.0.0", exported)),
  );

  return files;
}

/** Ключ `exports` в имя файла: `.` — точка входа пакета, `./testing` — `testing.js`. */
function entryName(key: string): string {
  return key === "." ? "index" : key.replace("./", "");
}

/**
 * Манифест того, что уехало плагину. `exports` переписан на собранные файлы: исходный указывает на
 * `.ts`, которых в распакованном пакете нет.
 */
function shippedManifest(name: string, version: string, exported: [string, string][]): string {
  return `${JSON.stringify(
    {
      name,
      version,
      private: true,
      type: "module",
      description: "Built for the Sovereign artifact. Managed by the platform.",
      exports: Object.fromEntries(exported.map(([key]) => [key, `./${entryName(key)}.js`])),
    },
    undefined,
    2,
  )}\n`;
}
