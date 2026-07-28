/**
 * Зависимости внешнего плагина (docs/plugins.md): привезённые не трогаем, недостающие ставим `npm` из
 * `PATH`. Своего установщика не пишем — lock-файлы, кеш и целостность это отдельный продукт.
 *
 * «Переустановка при изменении манифеста» и «привезённое не трогаем» противоречат друг другу, пока
 * нельзя отличить одно от другого. Отличает файл-штамп внутри `node_modules`: он появляется вместе с
 * нашей установкой и исчезает вместе с ней. Нет штампа — модули привезли, и они не наши.
 */

import { spawn } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { manifestFileName } from "@sovereign/protocol";

import type { Logger } from "./logger.ts";

export const installStampFileName = ".sovereign-install.json";

/**
 * Таймаут на один `npm install`. Без него зависший на сетевом запросе к реестру или на сломанном
 * postinstall процесс держит плагин в `installing` бесконечно: супервизор считает состояние живым,
 * повторов нет, и единственное восстановление — перезапуск демона. 120 с хватает на холодный
 * fetch типичного набора зависимостей и режет именно зависание.
 */
export const defaultInstallTimeoutMilliseconds = 120_000;

export type DependencyOutcome =
  | { kind: "not-needed" }
  /** `node_modules` привезли вместе с плагином: содержимое не сверяется с манифестом. */
  | { kind: "brought-along" }
  | { kind: "already-installed" }
  | { kind: "installed" }
  | { kind: "failed"; reason: string };

export type InstallRun = {
  ok: boolean;
  /** Вывод `npm` целиком: без него диагностика провала бесполезна. */
  output: string;
};

export type EnsurePluginDependenciesOptions = {
  directory: string;
  logger: Logger;
  /** Запуск установщика внедряется: иначе тест зависит от сети и от установленного npm. */
  runInstall?: (directory: string) => Promise<InstallRun>;
  /** Зовётся, только если установка действительно начинается: этап видим ровно тогда, когда он есть. */
  onInstallStart?: () => void;
  /**
   * Дедлайн на `npm install` по умолчанию. Внедряется, чтобы тест на зависание не ждал две минуты.
   * Применяется только к стандартному `runNpmInstall`: чужой `runInstall` отвечает за свой таймаут сам.
   */
  installTimeoutMilliseconds?: number;
};

export async function ensurePluginDependencies(
  options: EnsurePluginDependenciesOptions,
): Promise<DependencyOutcome> {
  const { directory, logger } = options;
  const runInstall =
    options.runInstall ??
    ((target: string) =>
      runNpmInstall(target, options.installTimeoutMilliseconds ?? defaultInstallTimeoutMilliseconds));

  let declared: Record<string, string>;

  try {
    declared = readDeclaredDependencies(directory);
  } catch (cause) {
    return { kind: "failed", reason: cause instanceof Error ? cause.message : String(cause) };
  }

  if (Object.keys(declared).length === 0) {
    return { kind: "not-needed" };
  }

  const modules = join(directory, "node_modules");
  const stampPath = join(modules, installStampFileName);

  if (existsSync(modules)) {
    const stamp = readStamp(stampPath);

    if (stamp === undefined) {
      return { kind: "brought-along" };
    }

    if (stamp === serialiseDependencies(declared)) {
      return { kind: "already-installed" };
    }
  }

  logger.info("installing the plugin dependencies", {
    directory,
    dependencies: Object.keys(declared),
  });

  options.onInstallStart?.();

  const run = await runInstall(directory);

  if (!run.ok) {
    return { kind: "failed", reason: run.output };
  }

  writeFileSync(stampPath, `${serialiseDependencies(declared)}\n`);

  return { kind: "installed" };
}

function readDeclaredDependencies(directory: string): Record<string, string> {
  const raw = readFileSync(join(directory, manifestFileName), "utf8");
  const document: unknown = JSON.parse(raw);
  const dependencies =
    typeof document === "object" && document !== null
      ? (document as { dependencies?: unknown }).dependencies
      : undefined;

  if (dependencies === undefined) {
    return {};
  }

  if (typeof dependencies !== "object" || dependencies === null || Array.isArray(dependencies)) {
    throw new Error(`${manifestFileName}: dependencies must be an object`);
  }

  return dependencies as Record<string, string>;
}

/** Ключи сортируются: перестановка в манифесте не должна выглядеть как смена зависимостей. */
function serialiseDependencies(dependencies: Record<string, string>): string {
  return JSON.stringify(
    Object.fromEntries(
      Object.entries(dependencies).sort(([left], [right]) => (left < right ? -1 : 1)),
    ),
  );
}

function readStamp(path: string): string | undefined {
  try {
    return readFileSync(path, "utf8").trim();
  } catch (cause) {
    if (cause instanceof Error && (cause as { code?: unknown }).code === "ENOENT") {
      return undefined;
    }

    throw cause;
  }
}

function runNpmInstall(directory: string, timeoutMilliseconds: number): Promise<InstallRun> {
  return new Promise((resolve) => {
    // Только заявленные зависимости: инструменты разработки автора плагину в работе не нужны.
    const npm = spawn("npm", ["install", "--omit=dev", "--no-audit", "--no-fund"], {
      cwd: directory,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let output = "";

    npm.stdout.on("data", (chunk: Buffer) => {
      output += chunk.toString();
    });

    npm.stderr.on("data", (chunk: Buffer) => {
      output += chunk.toString();
    });

    // SIGKILL, а не SIGTERM: зависший npm часто игнорирует мягкую просьбу, а плагин не должен
    // держать выгрузку до мягкого завершения чужого процесса. Потоки дочитываются, но не вечно:
    // после kill `close` приходит почти сразу.
    const timer = setTimeout(() => {
      npm.kill("SIGKILL");
      resolve({
        ok: false,
        output: `${output.trim()}\nnpm install timed out after ${timeoutMilliseconds}ms and was killed`,
      });
    }, timeoutMilliseconds);
    timer.unref?.();

    npm.on("error", (cause: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      resolve({
        ok: false,
        output:
          cause.code === "ENOENT"
            ? "npm was not found in PATH: a plugin with dependencies needs either an installer in the system or node_modules brought along"
            : cause.message,
      });
    });

    npm.on("close", (code) => {
      clearTimeout(timer);
      resolve({ ok: code === 0, output: output.trim() });
    });
  });
}
