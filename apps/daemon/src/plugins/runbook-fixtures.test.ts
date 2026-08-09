import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { after, describe, it } from "node:test";

type RunbookFixturesModule = typeof import("./runbook-fixtures.ts");

const workspace = mkdtempSync(join(tmpdir(), "sovereign-runbook-fixtures-"));
const workspaceRoot = resolve(import.meta.dirname, "../../../..");
const sdkDirectory = join(workspaceRoot, "packages", "sdk");
const cli = join(import.meta.dirname, "seed-runbook-fixtures.ts");
let created = 0;

after(() => {
  rmSync(workspace, { recursive: true, force: true });
});

async function loadRunbookFixtures(): Promise<RunbookFixturesModule> {
  return import("./runbook-fixtures.ts");
}

function freshPath(label: string): string {
  created += 1;
  return join(workspace, `${label}-${created}`);
}

function seededPluginDirectories(dataDirectory: string): string[] {
  return readdirSync(join(dataDirectory, "plugins"), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

function fixtureSourcesWithout(name: string): string {
  const fixturesDirectory = freshPath("fixtures");

  for (const fixtureName of ["placed", "rival", "browserless"]) {
    if (fixtureName !== name) {
      mkdirSync(join(fixturesDirectory, fixtureName), { recursive: true });
    }
  }

  return fixturesDirectory;
}

function spawnCli(arguments_: string[]) {
  return spawnSync(process.execPath, [cli, ...arguments_], {
    cwd: workspaceRoot,
    encoding: "utf8",
  });
}

function spawnPackageCli(arguments_: string[]) {
  return spawnSync(
    "pnpm",
    ["--filter", "@sovereign/daemon", "run", "seed-runbook", "--", ...arguments_],
    {
      cwd: workspaceRoot,
      encoding: "utf8",
    },
  );
}

describe("seedRunbookFixtures", () => {
  it("copies exactly the three tracked runbook fixtures into a fresh data directory", async () => {
    const dataDirectory = freshPath("fresh");
    const { runbookFixtureNames, seedRunbookFixtures } = await loadRunbookFixtures();

    await seedRunbookFixtures({ dataDirectory });

    assert.deepEqual(runbookFixtureNames, ["placed", "rival", "browserless"]);
    assert.deepEqual(seededPluginDirectories(dataDirectory), ["browserless", "placed", "rival"]);
    for (const fixtureName of runbookFixtureNames) {
      assert.ok(statSync(join(dataDirectory, "plugins", fixtureName, "package.json")).isFile());
    }
  });

  it("writes the initial contribution preferences used by the runbook stages", async () => {
    const dataDirectory = freshPath("preferences");
    const { seedRunbookFixtures } = await loadRunbookFixtures();

    await seedRunbookFixtures({ dataDirectory });

    assert.deepEqual(JSON.parse(readFileSync(join(dataDirectory, "preferences.json"), "utf8")), {
      plugins: {
        "data:placed": {
          enabled: true,
          disabledContributions: ["placed.plugins", "placed.boom"],
        },
        "data:rival": {
          enabled: true,
          disabledContributions: ["rival.plugins", "rival.board", "rival.board-action"],
        },
        "data:browserless": { enabled: true, disabledContributions: [] },
      },
    });
  });

  it("links every copied worker fixture to the workspace server SDK", async () => {
    const dataDirectory = freshPath("sdk-links");
    const { runbookFixtureNames, seedRunbookFixtures } = await loadRunbookFixtures();

    await seedRunbookFixtures({ dataDirectory });

    for (const fixtureName of runbookFixtureNames) {
      const link = join(dataDirectory, "plugins", fixtureName, "node_modules", "@sovereign", "sdk");

      assert.equal(lstatSync(link).isSymbolicLink(), true);
      assert.equal(statSync(link).isDirectory(), true);
      assert.equal(realpathSync(link), realpathSync(sdkDirectory));
    }
  });

  it("accepts an existing empty plugins root", async () => {
    const dataDirectory = freshPath("empty-root");
    mkdirSync(join(dataDirectory, "plugins"), { recursive: true });
    const { seedRunbookFixtures } = await loadRunbookFixtures();

    await seedRunbookFixtures({ dataDirectory });

    assert.deepEqual(seededPluginDirectories(dataDirectory), ["browserless", "placed", "rival"]);
  });

  it("refuses a repeated seed without changing files in any existing target", async () => {
    const dataDirectory = freshPath("repeat");
    const { runbookFixtureNames, seedRunbookFixtures } = await loadRunbookFixtures();
    await seedRunbookFixtures({ dataDirectory });

    for (const fixtureName of runbookFixtureNames) {
      writeFileSync(join(dataDirectory, "plugins", fixtureName, "sentinel.txt"), fixtureName);
    }

    await assert.rejects(
      () => seedRunbookFixtures({ dataDirectory }),
      (error: unknown) =>
        error instanceof Error && error.message.includes(join(dataDirectory, "plugins", "placed")),
    );

    for (const fixtureName of runbookFixtureNames) {
      assert.equal(
        readFileSync(join(dataDirectory, "plugins", fixtureName, "sentinel.txt"), "utf8"),
        fixtureName,
      );
    }
  });

  it("refuses an existing preferences file before copying a fixture", async () => {
    const dataDirectory = freshPath("existing-preferences");
    mkdirSync(dataDirectory, { recursive: true });
    const preferences = join(dataDirectory, "preferences.json");
    writeFileSync(preferences, "sentinel preferences");
    const { seedRunbookFixtures } = await loadRunbookFixtures();

    await assert.rejects(
      () => seedRunbookFixtures({ dataDirectory }),
      (error: unknown) => error instanceof Error && error.message.includes(preferences),
    );

    assert.equal(readFileSync(preferences, "utf8"), "sentinel preferences");
    assert.equal(existsSync(join(dataDirectory, "plugins")), false);
  });

  it("refuses one existing plugin target before copying the other fixtures", async () => {
    const dataDirectory = freshPath("existing-target");
    const existingTarget = join(dataDirectory, "plugins", "rival");
    mkdirSync(existingTarget, { recursive: true });
    writeFileSync(join(existingTarget, "sentinel.txt"), "rival sentinel");
    const { seedRunbookFixtures } = await loadRunbookFixtures();

    await assert.rejects(
      () => seedRunbookFixtures({ dataDirectory }),
      (error: unknown) => error instanceof Error && error.message.includes(existingTarget),
    );

    assert.deepEqual(readdirSync(join(dataDirectory, "plugins")), ["rival"]);
    assert.equal(readFileSync(join(existingTarget, "sentinel.txt"), "utf8"), "rival sentinel");
  });

  it("validates every fixture source before creating the data directory", async () => {
    const dataDirectory = freshPath("missing-source");
    const fixturesDirectory = fixtureSourcesWithout("rival");
    const missingSource = join(fixturesDirectory, "rival");
    const { seedRunbookFixtures } = await loadRunbookFixtures();

    await assert.rejects(
      () => seedRunbookFixtures({ dataDirectory, fixturesDirectory, sdkDirectory }),
      (error: unknown) => error instanceof Error && error.message.includes(missingSource),
    );

    assert.equal(existsSync(dataDirectory), false);
  });

  it("validates the SDK source before creating the data directory", async () => {
    const dataDirectory = freshPath("missing-sdk-data");
    const fixturesDirectory = fixtureSourcesWithout("none");
    const missingSdkDirectory = freshPath("missing-sdk");
    const { seedRunbookFixtures } = await loadRunbookFixtures();

    await assert.rejects(
      () =>
        seedRunbookFixtures({
          dataDirectory,
          fixturesDirectory,
          sdkDirectory: missingSdkDirectory,
        }),
      (error: unknown) => error instanceof Error && error.message.includes(missingSdkDirectory),
    );

    assert.equal(existsSync(dataDirectory), false);
  });
});

describe("seed-runbook-fixtures CLI", () => {
  it("accepts the documented pnpm invocation with its argument separator", () => {
    const dataDirectory = freshPath("package-cli-success");

    const result = spawnPackageCli([dataDirectory]);

    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trimEnd().split("\n").at(-1), resolve(dataDirectory));
    assert.deepEqual(readdirSync(dataDirectory).sort(), ["plugins", "preferences.json"]);
  });

  it("seeds one resolved data-directory argument and prints only that path", () => {
    const dataDirectory = freshPath("cli-success");
    const argument = relative(workspaceRoot, dataDirectory);

    const result = spawnCli([argument]);

    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, `${resolve(dataDirectory)}\n`);
    assert.deepEqual(readdirSync(dataDirectory).sort(), ["plugins", "preferences.json"]);
  });

  it("rejects any arity other than one positional argument", () => {
    for (const arguments_ of [[], ["first", "second"]]) {
      const result = spawnCli(arguments_);

      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /expected exactly one data-directory argument/);
    }
  });

  it("reports a seed refusal unchanged and leaves the existing target alone", () => {
    const dataDirectory = freshPath("cli-refusal");
    const existingTarget = join(dataDirectory, "plugins", "placed");
    mkdirSync(existingTarget, { recursive: true });
    writeFileSync(join(existingTarget, "sentinel.txt"), "do not replace");

    const result = spawnCli([dataDirectory]);

    assert.notEqual(result.status, 0);
    assert.match(
      result.stderr,
      new RegExp(existingTarget.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&")),
    );
    assert.equal(readFileSync(join(existingTarget, "sentinel.txt"), "utf8"), "do not replace");
    assert.equal(existsSync(join(dataDirectory, "preferences.json")), false);
  });
});
