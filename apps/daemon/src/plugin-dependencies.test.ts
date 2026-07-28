import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";

import { createLogger, type Logger } from "./logger.ts";
import {
  ensurePluginDependencies,
  installStampFileName,
  type InstallRun,
} from "./plugin-dependencies.ts";

const workspace = mkdtempSync(join(tmpdir(), "sovereign-plugin-dependencies-"));
let created = 0;

after(() => rmSync(workspace, { recursive: true, force: true }));

const silent: Logger = createLogger({ source: "core", level: () => "error", write: () => {} });

type PluginFolderOptions = {
  dependencies?: Record<string, string> | string;
  modules?: "brought-along" | "ours" | "none";
  stamp?: string;
};

function pluginFolder(options: PluginFolderOptions = {}): string {
  created += 1;
  const directory = join(workspace, `plugin-${created}`);
  mkdirSync(directory, { recursive: true });

  writeFileSync(
    join(directory, "package.json"),
    JSON.stringify({
      name: "hello",
      version: "0.0.0",
      sovereign: { id: "hello", worker: "src/worker.ts", platform: "*" },
      ...(options.dependencies === undefined ? {} : { dependencies: options.dependencies }),
    }),
  );

  if (options.modules !== undefined && options.modules !== "none") {
    mkdirSync(join(directory, "node_modules"), { recursive: true });
  }

  if (options.modules === "ours") {
    writeFileSync(
      join(directory, "node_modules", installStampFileName),
      options.stamp ?? JSON.stringify(options.dependencies ?? {}),
    );
  }

  return directory;
}

const succeeds = async (): Promise<InstallRun> => ({ ok: true, output: "added 1 package" });

describe("ensurePluginDependencies", () => {
  it("installs nothing when the plugin declares no dependencies", async () => {
    const directory = pluginFolder();
    let called = false;

    const outcome = await ensurePluginDependencies({
      directory,
      logger: silent,
      runInstall: async () => {
        called = true;

        return { ok: true, output: "" };
      },
    });

    assert.deepEqual(outcome, { kind: "not-needed" });
    assert.equal(called, false);
  });

  it("leaves node_modules that came with the plugin alone", async () => {
    const directory = pluginFolder({ dependencies: { left: "^1.0.0" }, modules: "brought-along" });
    let called = false;

    const outcome = await ensurePluginDependencies({
      directory,
      logger: silent,
      runInstall: async () => {
        called = true;

        return { ok: true, output: "" };
      },
    });

    assert.deepEqual(outcome, { kind: "brought-along" });
    assert.equal(called, false);
  });

  it("installs when there is nothing to work with and stamps its own work", async () => {
    const directory = pluginFolder({ dependencies: { left: "^1.0.0" } });
    let installStarted = false;

    const outcome = await ensurePluginDependencies({
      directory,
      logger: silent,
      runInstall: async (target) => {
        mkdirSync(join(target, "node_modules"), { recursive: true });

        return succeeds();
      },
      onInstallStart: () => {
        installStarted = true;
      },
    });

    assert.deepEqual(outcome, { kind: "installed" });
    assert.equal(installStarted, true);

    // Второй заход по тому же манифесту ничего не переустанавливает: штамп совпал.
    const again = await ensurePluginDependencies({
      directory,
      logger: silent,
      runInstall: async () => {
        throw new Error("must not install twice");
      },
    });

    assert.deepEqual(again, { kind: "already-installed" });
  });

  it("reinstalls when the manifest changed, but only what we installed ourselves", async () => {
    const directory = pluginFolder({
      dependencies: { left: "^2.0.0" },
      modules: "ours",
      stamp: JSON.stringify({ left: "^1.0.0" }),
    });
    let called = false;

    const outcome = await ensurePluginDependencies({
      directory,
      logger: silent,
      runInstall: async () => {
        called = true;

        return succeeds();
      },
    });

    assert.deepEqual(outcome, { kind: "installed" });
    assert.equal(called, true);
  });

  it("ignores the order of dependencies in the manifest", async () => {
    const directory = pluginFolder({
      dependencies: { right: "^1.0.0", left: "^1.0.0" },
      modules: "ours",
      stamp: JSON.stringify({ left: "^1.0.0", right: "^1.0.0" }),
    });

    const outcome = await ensurePluginDependencies({
      directory,
      logger: silent,
      runInstall: async () => {
        throw new Error("must not install after a mere reordering");
      },
    });

    assert.deepEqual(outcome, { kind: "already-installed" });
  });

  it("reports a failed install with the installer output", async () => {
    const directory = pluginFolder({ dependencies: { left: "^1.0.0" } });

    const outcome = await ensurePluginDependencies({
      directory,
      logger: silent,
      runInstall: async () => ({ ok: false, output: "npm error code E404" }),
    });

    assert.deepEqual(outcome, { kind: "failed", reason: "npm error code E404" });
  });

  it("refuses a manifest whose dependencies are not an object", async () => {
    const directory = pluginFolder({ dependencies: "all of them" });

    const outcome = await ensurePluginDependencies({ directory, logger: silent });

    assert.equal(outcome.kind, "failed");
  });

  it("kills an npm install that hangs past its deadline", async () => {
    // Реальный spawn-путь (а не внедрённый runInstall): фальшивый `npm` в PATH висит и не выходит.
    const bin = mkdtempSync(join(tmpdir(), "sovereign-fake-npm-"));
    const fakeNpm = join(bin, process.platform === "win32" ? "npm.cmd" : "npm");
    writeFileSync(
      fakeNpm,
      [
        "#!/usr/bin/env node",
        "// Имитирует зависший npm: сетевой запрос к реестру не возвращается.",
        "process.stdout.write('hanging npm started\\n');",
        "setInterval(() => {}, 60_000);",
      ].join("\n"),
    );
    chmodSync(fakeNpm, 0o755);

    const directory = pluginFolder({ dependencies: { left: "^1.0.0" } });
    const previousPath = process.env.PATH;
    process.env.PATH = `${bin}:${previousPath ?? ""}`;

    try {
      const outcome = await ensurePluginDependencies({
        directory,
        logger: silent,
        installTimeoutMilliseconds: 300,
      });

      assert.equal(outcome.kind, "failed");
      if (outcome.kind === "failed") {
        assert.match(outcome.reason, /timed out after 300ms and was killed/);
      }
      // Не должно остаться зомби-процессов: spawnSync ниже отчитывает только живых наследников.
      const stillAlive = spawnSync(process.execPath, ["-e", "process.exit(0)"]);
      assert.equal(stillAlive.status, 0);
    } finally {
      process.env.PATH = previousPath;
      rmSync(bin, { recursive: true, force: true });
    }
  });
});
