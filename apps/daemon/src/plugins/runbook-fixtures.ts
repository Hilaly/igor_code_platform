import { cp, lstat, mkdir, stat, symlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

export const runbookFixtureNames = ["placed", "rival", "browserless"] as const;

export type SeedRunbookFixturesOptions = {
  dataDirectory: string;
  fixturesDirectory?: string;
  sdkDirectory?: string;
};

const initialPreferences = {
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
};

export async function seedRunbookFixtures(options: SeedRunbookFixturesOptions): Promise<void> {
  const dataDirectory = resolve(options.dataDirectory);
  const fixturesDirectory = resolve(
    options.fixturesDirectory ?? join(import.meta.dirname, "fixtures"),
  );
  const sdkDirectory = resolve(
    options.sdkDirectory ?? join(import.meta.dirname, "../../../../packages/sdk"),
  );
  const pluginsDirectory = join(dataDirectory, "plugins");
  const preferencesPath = join(dataDirectory, "preferences.json");
  const sources = runbookFixtureNames.map((name) => join(fixturesDirectory, name));
  const targets = runbookFixtureNames.map((name) => join(pluginsDirectory, name));

  for (const source of sources) {
    await requireDirectory(source, "runbook fixture source");
  }
  await requireDirectory(sdkDirectory, "server SDK source");

  for (const target of targets) {
    await refuseExisting(target);
  }
  await refuseExisting(preferencesPath);

  await mkdir(pluginsDirectory, { recursive: true });

  for (const [index, source] of sources.entries()) {
    const target = targets[index];

    if (target === undefined) {
      throw new Error(`the runbook fixture target is missing for ${source}`);
    }

    await cp(source, target, { recursive: true, errorOnExist: true, force: false });

    const scopeDirectory = join(target, "node_modules", "@sovereign");
    await mkdir(scopeDirectory, { recursive: true });
    await symlink(sdkDirectory, join(scopeDirectory, "sdk"), "dir");
  }

  await writeFile(preferencesPath, `${JSON.stringify(initialPreferences, null, 2)}\n`, {
    flag: "wx",
  });
}

async function requireDirectory(path: string, label: string): Promise<void> {
  try {
    if ((await stat(path)).isDirectory()) {
      return;
    }
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code !== "ENOENT") {
      throw cause;
    }
  }

  throw new Error(`the ${label} is not a directory: ${path}`);
}

async function refuseExisting(path: string): Promise<void> {
  try {
    await lstat(path);
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === "ENOENT") {
      return;
    }

    throw cause;
  }

  throw new Error(`the runbook seed target already exists: ${path}`);
}
