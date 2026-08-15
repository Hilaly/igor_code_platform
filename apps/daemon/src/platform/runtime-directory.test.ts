import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import { createLogger, type Logger } from "./logger.ts";
import type { DependencyOutcome } from "./npm-dependencies.ts";
import {
  prepareRuntimeDirectory,
  runtimeDirectoryName,
  runtimeModuleUrl,
  workerBootstrapFileName,
} from "./runtime-directory.ts";

const workspace = mkdtempSync(join(tmpdir(), "sovereign-runtime-directory-"));
let made = 0;

const dataDirectory = (): string => {
  made += 1;

  const directory = join(workspace, `data-${String(made)}`);

  mkdirSync(directory, { recursive: true });

  return directory;
};

const records: { message: string; fields?: unknown }[] = [];
const logger: Logger = createLogger({
  source: "core",
  level: () => "debug",
  write: (record) => records.push({ message: record.message, fields: record.fields }),
});

const installed = async (): Promise<DependencyOutcome> => ({ kind: "installed" });

const prepare = (
  directory: string,
  overrides: Partial<Parameters<typeof prepareRuntimeDirectory>[0]> = {},
) =>
  prepareRuntimeDirectory({
    dataDirectory: directory,
    version: "0.1.0",
    workerBootstrap: Buffer.from("export const bootstrap = 1;\n", "utf8"),
    dependencies: { esbuild: "0.28.1" },
    logger,
    ensureDependencies: installed,
    ...overrides,
  });

describe("prepareRuntimeDirectory", () => {
  it("puts the worker bootstrap and the manifest into the directory of the version", async () => {
    const data = dataDirectory();

    const runtime = await prepare(data);

    assert.equal(runtime.directory, join(data, runtimeDirectoryName, "0.1.0"));
    assert.equal(runtime.workerBootstrap, join(runtime.directory, workerBootstrapFileName));
    assert.equal(readFileSync(runtime.workerBootstrap, "utf8"), "export const bootstrap = 1;\n");
    assert.deepEqual(
      JSON.parse(readFileSync(join(runtime.directory, "package.json"), "utf8")).dependencies,
      { esbuild: "0.28.1" },
    );
  });

  it("rewrites the bootstrap of an artifact that kept the same version", async () => {
    const data = dataDirectory();

    await prepare(data);
    const runtime = await prepare(data, {
      workerBootstrap: Buffer.from("export const bootstrap = 2;\n", "utf8"),
    });

    // Версия платформы между двумя сборками артефакта не меняется, поэтому «есть — не трогаем»
    // оставило бы на диске бутстрап от прошлой сборки.
    assert.equal(readFileSync(runtime.workerBootstrap, "utf8"), "export const bootstrap = 2;\n");
  });

  it("keeps the installed dependencies of the current version in place", async () => {
    const data = dataDirectory();

    const first = await prepare(data);
    const modules = join(first.directory, "node_modules", "esbuild");
    mkdirSync(modules, { recursive: true });
    writeFileSync(join(modules, "marker"), "installed");

    await prepare(data);

    // Каталог не пересоздаётся целиком: иначе каждая перезагрузка демона стоила бы новой установки.
    assert.equal(readFileSync(join(modules, "marker"), "utf8"), "installed");
  });

  it("forgets the directory of a past version", async () => {
    const data = dataDirectory();
    const past = join(data, runtimeDirectoryName, "0.0.9");
    mkdirSync(join(past, "node_modules"), { recursive: true });

    await prepare(data);

    assert.equal(existsSync(past), false);
  });

  it("carries a failed install out as an outcome and does not throw", async () => {
    const data = dataDirectory();
    records.length = 0;

    const runtime = await prepare(data, {
      ensureDependencies: async (): Promise<DependencyOutcome> => ({
        kind: "failed",
        reason: "npm was not found in PATH",
      }),
    });

    assert.deepEqual(runtime.dependencies, {
      kind: "failed",
      reason: "npm was not found in PATH",
    });
    // Бутстрап на месте: плагин без браузерной части обязан запуститься и без сборщика.
    assert.equal(existsSync(runtime.workerBootstrap), true);
    assert.equal(
      records.some(
        (record) => record.message === "the runtime dependencies of the artifact are not installed",
      ),
      true,
    );
  });

  it("resolves an installed module out of the directory of the version", async () => {
    const data = dataDirectory();
    const runtime = await prepare(data);
    const module = join(runtime.directory, "node_modules", "pretend");
    mkdirSync(module, { recursive: true });
    writeFileSync(
      join(module, "package.json"),
      JSON.stringify({ name: "pretend", main: "main.js" }),
    );
    writeFileSync(join(module, "main.js"), "module.exports = {};");

    const url = runtimeModuleUrl(runtime.directory, "pretend");

    assert.match(url, /^file:\/\//);
    assert.match(decodeURIComponent(url), /node_modules\/pretend\/main\.js$/);
  });
});
