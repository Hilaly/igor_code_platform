import assert from "node:assert/strict";
import { join } from "node:path";
import { describe, it } from "node:test";

import { ESLint } from "eslint";

/**
 * Граница `@earendil-works/*` объявлена в docs/architecture.md, а держится плоским конфигом
 * ESLint, у которого опции правила у более узкого блока **заменяют** опции у более широкого.
 * Разрешающий блок этого пакета обязан повторить запрет на импорт приложений — забытый повтор
 * снял бы старую защиту молча, и поймать это можно только запуском линтера.
 *
 * Проверяется настоящий корневой конфиг: тест на копии правил проверял бы копию.
 */

const repositoryRoot = join(import.meta.dirname, "..", "..", "..");
const linter = new ESLint({ cwd: repositoryRoot });

async function messagesFor(relativePath: string, source: string): Promise<string[]> {
  const [result] = await linter.lintText(source, { filePath: join(repositoryRoot, relativePath) });

  assert.ok(result, `линтер ничего не сказал про ${relativePath}`);

  return result.messages
    .filter((message) => message.ruleId === "no-restricted-imports")
    .map((message) => message.message);
}

const importsPi = 'import { builtinModels } from "@earendil-works/pi-ai/providers/all";\n';
const importsPiRoot = 'import type { Models } from "@earendil-works/pi-ai";\n';
const importsDaemon = 'import { start } from "@sovereign/daemon";\n';

describe("the agent runtime boundary", () => {
  it("lets the runtime package import pi, including its subpaths", async () => {
    assert.deepEqual(
      await messagesFor("packages/agent-runtime-pi/src/catalogue.ts", importsPi + importsPiRoot),
      [],
    );
  });

  it("refuses pi in the daemon, in another package and in a plugin", async () => {
    for (const path of [
      "apps/daemon/src/providers.ts",
      "apps/web/src/providers/api.ts",
      "packages/sdk/src/providers.ts",
      "plugins/base-agent/src/worker.ts",
    ]) {
      assert.equal((await messagesFor(path, importsPi)).length, 1, `подпакет Pi прошёл в ${path}`);
      assert.equal(
        (await messagesFor(path, importsPiRoot)).length,
        1,
        `корневой импорт Pi прошёл в ${path}`,
      );
    }
  });

  it("keeps the older ban on importing applications, the runtime package included", async () => {
    for (const path of [
      "apps/web/src/providers/api.ts",
      "packages/sdk/src/providers.ts",
      "plugins/base-agent/src/worker.ts",
      "packages/agent-runtime-pi/src/catalogue.ts",
    ]) {
      assert.equal(
        (await messagesFor(path, importsDaemon)).length,
        1,
        `импорт демона прошёл в ${path}`,
      );
    }
  });
});
