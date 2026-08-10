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

  it("lets the sdk module of hooks re-export the event types of pi", async () => {
    // Единственное названное исключение (docs/hooks.md). Проверяется настоящим конфигом: без него
    // обещание «исключение появится тем же коммитом, что и хуки» осталось бы текстом.
    assert.deepEqual(await messagesFor("packages/sdk/src/hooks.ts", importsPi + importsPiRoot), []);
  });

  it("keeps the exception to one file of the sdk", async () => {
    for (const path of [
      "packages/sdk/src/index.ts",
      "packages/sdk/src/host.ts",
      "packages/sdk/src/tools.ts",
      "packages/sdk/src/hooks-extra.ts",
    ]) {
      assert.equal(
        (await messagesFor(path, importsPiRoot)).length,
        1,
        `исключение расползлось на ${path}`,
      );
    }
  });

  it("keeps the ban on importing applications inside the exception", async () => {
    // Плоский конфиг заменяет опции правила целиком, поэтому разрешающий блок обязан повторить
    // остальные запреты. Забытый повтор снял бы старую защиту молча.
    assert.equal((await messagesFor("packages/sdk/src/hooks.ts", importsDaemon)).length, 1);
  });

  it("refuses pi in the daemon, in another package and in a plugin", async () => {
    for (const path of [
      "apps/daemon/src/providers.ts",
      "apps/web/src/providers/api.ts",
      "packages/sdk/src/providers.ts",
      "plugins/starter/src/worker.ts",
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
      "plugins/starter/src/worker.ts",
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
