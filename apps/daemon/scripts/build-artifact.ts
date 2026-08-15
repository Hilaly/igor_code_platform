/**
 * Сборка продакшн-артефакта (docs/toolchain.md). На выходе один файл `dist/sovereign.js`, в который
 * вшиты весь наш код, статика фронтенда и собранный бутстрап воркера плагина.
 *
 * Наружу остаётся только то, что в один файл не помещается, — нативный бинарь `esbuild`. Его
 * ставит `npm` в директорию данных при первом запуске версии (`src/platform/runtime-directory.ts`),
 * а список таких зависимостей здесь один и тот же и для `external`, и для нагрузки: разъехавшись,
 * они дали бы либо бандл с нативным бинарём внутри, либо ненайденный модуль в рантайме.
 */

import { mkdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

import { build, type BuildOptions } from "esbuild";

import {
  payloadModuleSource,
  readDirectoryFiles,
  type PayloadContents,
} from "./artifact-payload-module.ts";
import { readBuiltinPlugins } from "./builtin-plugins-payload.ts";

const daemonRoot = join(import.meta.dirname, "..");
const repositoryRoot = join(daemonRoot, "..", "..");
const webOutput = join(repositoryRoot, "apps", "web", "dist");
const artifactDirectory = join(repositoryRoot, "dist");
const artifactFileName = "sovereign.js";

/**
 * Зависимости, которые не бандлятся. Сегодня одна: у `esbuild` нативный бинарь, распаковываемый
 * `postinstall`, и в JS-файл он не помещается ни в каком виде (runtime-checks.md, проверка 37).
 */
const unbundlable = ["esbuild"];

/**
 * Зависимости из npm бывают CommonJS, а вывод у нас ESM: без этих строк `require`, `__dirname` и
 * `__filename` внутри них падают на первом же обращении.
 */
const commonJsInterop = [
  "import { createRequire as __sovereignCreateRequire } from 'node:module';",
  "import { fileURLToPath as __sovereignFileURLToPath } from 'node:url';",
  "import { dirname as __sovereignDirname } from 'node:path';",
  "const require = __sovereignCreateRequire(import.meta.url);",
  "const __filename = __sovereignFileURLToPath(import.meta.url);",
  "const __dirname = __sovereignDirname(__filename);",
].join("\n");

const shared: BuildOptions = {
  absWorkingDir: repositoryRoot,
  bundle: true,
  platform: "node",
  format: "esm",
  target: ["node24"],
  external: unbundlable,
  banner: { js: commonJsInterop },
  logLevel: "warning",
};

async function bundleWorkerBootstrap(): Promise<Uint8Array> {
  const result = await build({
    ...shared,
    entryPoints: [join(daemonRoot, "src", "plugins", "plugin-worker.ts")],
    outfile: join(artifactDirectory, "plugin-worker.js"),
    write: false,
  });

  const [file] = result.outputFiles ?? [];

  if (file === undefined) {
    throw new Error("The worker bootstrap produced no output.");
  }

  return file.contents;
}

/**
 * Версии — точные и **разрешённые**, а не диапазон из манифеста демона. Диапазон означал бы, что
 * две установки одного артефакта получают разные сборщики, то есть это не один артефакт; а взять
 * версию надо ту, на которой репозиторий проверялся, а не ту, что окажется в реестре потом.
 */
function readRuntimeDependencies(): Record<string, string> {
  const resolve = createRequire(join(daemonRoot, "package.json"));
  const resolved: Record<string, string> = {};

  for (const name of unbundlable) {
    let manifest: unknown;

    try {
      manifest = JSON.parse(readFileSync(resolve.resolve(`${name}/package.json`), "utf8"));
    } catch (cause) {
      throw new Error(
        `${name} is not installed for the daemon, so the artifact cannot pin its version: ${
          cause instanceof Error ? cause.message : String(cause)
        }`,
      );
    }

    const version = (manifest as { version?: unknown }).version;

    if (typeof version !== "string") {
      throw new Error(`The installed ${name} does not name its version.`);
    }

    resolved[name] = version;
  }

  return resolved;
}

function readWebOutput(): Map<string, Uint8Array> {
  const files = readDirectoryFiles(webOutput);

  // Без точки входа фронтенда артефакт собрался бы и запустился, а интерфейса бы не отдал: это
  // ровно тот отказ, ради отсутствия которого статика и вшивается (docs/toolchain.md).
  if (!files.has("index.html")) {
    throw new Error(
      `There is no index.html in ${webOutput}: build the web interface before the artifact.`,
    );
  }

  return files;
}

const contents: PayloadContents = {
  web: readWebOutput(),
  builtin: await readBuiltinPlugins({
    pluginsRoot: join(repositoryRoot, "plugins"),
    packagesRoot: join(repositoryRoot, "packages"),
  }),
  worker: await bundleWorkerBootstrap(),
  runtimeDependencies: readRuntimeDependencies(),
};

rmSync(artifactDirectory, { recursive: true, force: true });
mkdirSync(artifactDirectory, { recursive: true });

const artifactPath = join(artifactDirectory, artifactFileName);
const seam = join(daemonRoot, "src", "platform", "artifact-payload.ts");
const payloadSource = payloadModuleSource(contents);

await build({
  ...shared,
  entryPoints: [join(daemonRoot, "src", "main.ts")],
  outfile: artifactPath,
  plugins: [
    {
      name: "sovereign-artifact-payload",
      setup(builder) {
        // Подмена модуля, а не генерация файла в `src`: сгенерированный исходник пришлось бы
        // исключать из линтера, форматтера и проверки типов, то есть из `make check`.
        builder.onLoad({ filter: /artifact-payload\.ts$/ }, (args) =>
          args.path === seam ? { contents: payloadSource, loader: "js" } : undefined,
        );
      },
    },
  ],
});

/** Первый сегмент пути — имя плагина: отчёт сборки называет то, что человек потом увидит в списке. */
function builtinPluginNames(files: Map<string, Uint8Array>): string[] {
  return [...new Set([...files.keys()].map((path) => path.split("/")[0] ?? ""))].sort();
}

const { size } = statSync(artifactPath);

process.stdout.write(
  [
    `${artifactPath}`,
    `  ${(size / 1024 / 1024).toFixed(1)} MB, ${String(contents.web.size)} files of the frontend inside`,
    `  builtin plugins: ${builtinPluginNames(contents.builtin).join(", ")}`,
    `  installed on the first run: ${Object.entries(contents.runtimeDependencies)
      .map(([name, version]) => `${name}@${version}`)
      .join(", ")}`,
    "",
  ].join("\n"),
);
