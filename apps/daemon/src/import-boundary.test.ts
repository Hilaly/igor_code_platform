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
    .filter((message) => message.ruleId === "no-restricted-imports")
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
