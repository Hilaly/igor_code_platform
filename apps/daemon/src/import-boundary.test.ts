import assert from "node:assert/strict";
import { join } from "node:path";
import { describe, it } from "node:test";

import { ESLint } from "eslint";

const repositoryRoot = join(import.meta.dirname, "..", "..", "..");
const linter = new ESLint({ cwd: repositoryRoot });

async function messagesFor(relativePath: string, source: string): Promise<string[]> {
  const [result] = await linter.lintText(source, { filePath: join(repositoryRoot, relativePath) });

  assert.ok(result, `линтер ничего не сказал про ${relativePath}`);

  return result.messages
    .filter(
      (message) =>
        message.ruleId === "no-restricted-imports" || message.ruleId === "no-restricted-syntax",
    )
    .map((message) => message.message);
}

describe("the daemon area boundary", () => {
  it("lets sessions depend on the projects facade", async () => {
    assert.deepEqual(
      await messagesFor(
        "apps/daemon/src/sessions/example.ts",
        'import type { ProjectStore } from "../projects/public.ts";\n',
      ),
      [],
    );
  });

  it("refuses deep imports into another area", async () => {
    assert.equal(
      (
        await messagesFor(
          "apps/daemon/src/sessions/example.ts",
          'import type { ProjectStore } from "../projects/project-store.ts";\n',
        )
      ).length,
      1,
    );
  });

  it("refuses reverse area dependencies", async () => {
    assert.equal(
      (
        await messagesFor(
          "apps/daemon/src/projects/example.ts",
          'import type { SessionService } from "../sessions/public.ts";\n',
        )
      ).length,
      1,
    );
  });

  it("refuses reverse area dependencies written with redundant relative segments", async () => {
    assert.equal(
      (
        await messagesFor(
          "apps/daemon/src/projects/example.ts",
          'import type { SessionService } from "./../sessions/public.ts";\n',
        )
      ).length,
      1,
    );
  });

  it("refuses deep imports written with redundant relative segments", async () => {
    assert.equal(
      (
        await messagesFor(
          "apps/daemon/src/sessions/example.ts",
          'import type { ProjectStore } from "./../projects/project-store.ts";\n',
        )
      ).length,
      1,
    );
  });

  it("refuses dynamic imports that cross an area boundary", async () => {
    assert.equal(
      (
        await messagesFor(
          "apps/daemon/src/projects/example.ts",
          'const sessions = import("../sessions/public.ts");\nvoid sessions;\n',
        )
      ).length,
      1,
    );
  });

  it("refuses computed dynamic imports whose boundary cannot be checked", async () => {
    assert.equal(
      (
        await messagesFor(
          "apps/daemon/src/projects/example.ts",
          'const area = "sessions";\nconst module = import(`../${area}/public.ts`);\nvoid module;\n',
        )
      ).length,
      1,
    );
  });

  it("does not widen the plugin worker exception to arbitrary computed imports", async () => {
    assert.equal(
      (
        await messagesFor(
          "apps/daemon/src/plugins/plugin-worker.ts",
          'const path = "../sessions/public.ts";\nconst module = import(path);\nvoid module;\n',
        )
      ).length,
      1,
    );
  });

  it("lets the composition root import area facades", async () => {
    assert.deepEqual(
      await messagesFor(
        "apps/daemon/src/main.ts",
        [
          'import { createEventBus } from "./platform/public.ts";',
          'import { createDaemonServer } from "./http/public.ts";',
          'import { createSessionService } from "./sessions/public.ts";',
        ].join("\n"),
      ),
      [],
    );
  });

  it("refuses dynamic area imports from the composition root", async () => {
    assert.equal(
      (
        await messagesFor(
          "apps/daemon/src/main.ts",
          'const platform = import("./platform/public.ts");\nvoid platform;\n',
        )
      ).length,
      1,
    );
  });

  it("keeps the ban on importing Pi from the daemon", async () => {
    assert.equal(
      (
        await messagesFor(
          "apps/daemon/src/providers/example.ts",
          'import type { Models } from "@earendil-works/pi-ai";\n',
        )
      ).length,
      1,
    );
  });
});
