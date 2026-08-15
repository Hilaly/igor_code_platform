/**
 * То, что продакшн-артефакт кладёт на диск, чтобы работать (docs/toolchain.md). Артефакт — один
 * файл, но две вещи внутри него файлом быть обязаны:
 *
 * - **бутстрап воркера плагина** — `new Worker` принимает путь, а не код, и стек-трейс упавшего
 *   воркера должен указывать на что-то, что можно открыть;
 * - **зависимости, которые не вшиваются** — сегодня одна, `esbuild`: у него нативный бинарь, и в
 *   один файл он не помещается. Ставит их `npm` из `PATH` тем же способом, что и зависимости
 *   внешнего плагина (`npm-dependencies.ts`).
 *
 * Обе живут в `<директория данных>/runtime/<версия платформы>/`, то есть внутри директории данных и
 * за её пределы ничего не пишут (docs/data-directory.md).
 *
 * Атомарность здесь пофайловая, а не на каталог. Каталог целиком заменять нельзя: тогда провалившаяся
 * установка зависимостей унесла бы с собой и бутстрап, то есть отказ «браузерную часть плагина не
 * собрать» превратился бы в «ни один плагин не запускается». Готовность зависимостей отмечает штамп
 * внутри `node_modules`: нет штампа — следующий старт поставит их заново.
 */

import { createRequire } from "node:module";
import { mkdirSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { writeFileAtomically } from "./atomic-file.ts";
import type { Logger } from "./logger.ts";
import { ensureInstalledDependencies, type DependencyOutcome } from "./npm-dependencies.ts";

export const runtimeDirectoryName = "runtime";

/** Имя собранного бутстрапа. `.js`, а не `.ts`: в нагрузку он приезжает уже без типов. */
export const workerBootstrapFileName = "plugin-worker.js";

export type RuntimeDirectory = {
  directory: string;
  /** Путь, который супервизор передаёт в `new Worker`. */
  workerBootstrap: string;
  /**
   * Чем кончилась установка. Отказ демон не роняет: интерфейс и плагины без браузерной части
   * работают, а плагин с ней получит отказ сборки с причиной.
   */
  dependencies: DependencyOutcome;
};

export type PrepareRuntimeDirectoryOptions = {
  dataDirectory: string;
  /** Версия платформы: каталог версии переживает обновление артефакта, прошлые удаляются. */
  version: string;
  /** Собранный бутстрап воркера из нагрузки артефакта. */
  workerBootstrap: Uint8Array;
  /** Зависимости, которые не вшиваются. Пустой набор — законное значение: ставить нечего. */
  dependencies: Record<string, string>;
  logger: Logger;
  /** Внедряется, чтобы тест не ходил в сеть и не требовал установленного npm. */
  ensureDependencies?: (directory: string) => Promise<DependencyOutcome>;
};

export async function prepareRuntimeDirectory(
  options: PrepareRuntimeDirectoryOptions,
): Promise<RuntimeDirectory> {
  const root = join(options.dataDirectory, runtimeDirectoryName);
  const directory = join(root, options.version);

  mkdirSync(directory, { recursive: true });

  const workerBootstrap = join(directory, workerBootstrapFileName);

  // Оба файла переписываются на каждый старт, а не «если их нет»: они принадлежат артефакту, и
  // артефакт мог смениться, не сменив версию платформы. Стоят они десяток килобайт.
  writeFileAtomically(workerBootstrap, options.workerBootstrap);
  writeFileAtomically(
    join(directory, "package.json"),
    manifest(options.version, options.dependencies),
  );

  forgetOtherVersions(root, options.version, options.logger);

  const ensureDependencies =
    options.ensureDependencies ??
    ((target: string) =>
      ensureInstalledDependencies({ directory: target, logger: options.logger }));

  const dependencies = await ensureDependencies(directory);

  if (dependencies.kind === "failed") {
    options.logger.error("the runtime dependencies of the artifact are not installed", {
      directory,
      dependencies: Object.keys(options.dependencies),
      reason: dependencies.reason,
    });
  }

  return { directory, workerBootstrap, dependencies };
}

/**
 * Модуль, установленный в каталоге версии. Разрешается **из этого каталога**, а не по имени: рядом
 * с артефактом никакого `node_modules` нет, и обычный `import "esbuild"` из бандла не нашёл бы
 * ничего (runtime-checks.md, проверка 37).
 */
export function runtimeModuleUrl(directory: string, specifier: string): string {
  const resolve = createRequire(join(directory, "package.json"));

  return pathToFileURL(resolve.resolve(specifier)).href;
}

/**
 * Загрузка установленного модуля. Импорт динамический и по вычисленному адресу — иначе он был бы
 * разрешён на сборке артефакта, а модуля тогда ещё нет ни на одной машине. Живёт он здесь, а не в
 * точке композиции: там вычисляемый импорт запрещён правилом границ областей.
 */
export function loadRuntimeModule<Module>(directory: string, specifier: string): Promise<Module> {
  // Это абсолютный file: URL модуля в директории данных, а не импорт соседней области демона.
  // eslint-disable-next-line no-restricted-syntax
  return import(runtimeModuleUrl(directory, specifier)) as Promise<Module>;
}

function manifest(version: string, dependencies: Record<string, string>): string {
  return `${JSON.stringify(
    {
      name: "sovereign-runtime",
      private: true,
      version,
      // Каталог принадлежит платформе, и человеку в нём делать нечего; поле стоит ради `npm`.
      description: "Runtime dependencies of the Sovereign artifact. Managed by the platform.",
      dependencies,
    },
    undefined,
    2,
  )}\n`;
}

/**
 * Каталог прошлой версии — это мегабайты нативных бинарей, которые больше никому не нужны. Не
 * убрав их, директория данных росла бы на каждое обновление артефакта (docs/toolchain.md).
 */
function forgetOtherVersions(root: string, version: string, logger: Logger): void {
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (entry.name === version) {
      continue;
    }

    try {
      rmSync(join(root, entry.name), { recursive: true, force: true });
    } catch (cause) {
      // Не удалить чужой каталог — не повод не запускаться: место занято, работа продолжается.
      logger.warn("a runtime directory of a past version could not be removed", {
        directory: join(root, entry.name),
        reason: cause instanceof Error ? cause.message : String(cause),
      });
    }
  }
}
