import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, beforeEach, describe, it } from "node:test";

import type { LogRecord } from "@sovereign/protocol";

import {
  createCredentialStore,
  credentialsFileName,
  type CredentialStore,
} from "./credential-store.ts";
import { ensureDataDirectory } from "../platform/public.ts";
import { createLogger } from "../platform/public.ts";

const workspace = mkdtempSync(join(tmpdir(), "sovereign-credential-store-"));

after(() => {
  rmSync(workspace, { recursive: true, force: true });
});

let directories = 0;
let records: LogRecord[] = [];

beforeEach(() => {
  records = [];
});

function store(contents?: string): { store: CredentialStore; directory: string } {
  directories += 1;

  const directory = ensureDataDirectory(join(workspace, `data-${directories}`));

  if (contents !== undefined) {
    writeFileSync(join(directory, credentialsFileName), contents);
  }

  const logger = createLogger({
    source: "core",
    level: () => "debug",
    write: (record) => records.push(record),
  });

  return { store: createCredentialStore({ directory, logger }), directory };
}

function reopen(directory: string): CredentialStore {
  return createCredentialStore({
    directory,
    logger: createLogger({ source: "core", level: () => "debug", write: () => {} }),
  });
}

function fileAt(directory: string): unknown {
  return JSON.parse(readFileSync(join(directory, credentialsFileName), "utf8"));
}

const apiKey = (key: string) => ({ type: "api_key", key });
const keySet = (keys: { id: string; label: string; credential: unknown }[], selected: string) => ({
  keys,
  selected,
});

describe("the credential store", () => {
  it("is empty before anything was written, and writes no file", () => {
    const { store: credentials, directory } = store();

    assert.deepEqual(credentials.list(), []);
    assert.deepEqual(credentials.keys("anthropic"), []);
    assert.equal(credentials.selected("anthropic"), undefined);
    assert.equal(
      statSync(join(directory, credentialsFileName), { throwIfNoEntry: false }),
      undefined,
    );
  });

  it("keeps a credential across a restart", async () => {
    const { store: credentials, directory } = store();

    await credentials.modify("anthropic", async () => apiKey("s3cret"));

    assert.deepEqual(fileAt(directory), {
      credentials: {
        anthropic: keySet([{ id: "key-1", label: "", credential: apiKey("s3cret") }], "key-1"),
      },
    });

    const reopened = reopen(directory);

    assert.deepEqual(await reopened.read("anthropic"), apiKey("s3cret"));
    assert.deepEqual(reopened.list(), ["anthropic"]);
    assert.deepEqual(reopened.keys("anthropic"), [{ id: "key-1", label: "" }]);
  });

  it("writes the file so only its owner can read it", async () => {
    const { store: credentials, directory } = store();

    await credentials.modify("anthropic", async () => apiKey("s3cret"));

    const mode = statSync(join(directory, credentialsFileName)).mode & 0o777;

    assert.equal(mode, 0o600, `права файла кредов ${mode.toString(8)}, а не 600`);
  });

  it("shows the current credential to the function that writes the next one", async () => {
    const { store: credentials } = store();
    const seen: unknown[] = [];

    await credentials.modify("anthropic", async (current) => {
      seen.push(current);

      return apiKey("first");
    });
    await credentials.modify("anthropic", async (current) => {
      seen.push(current);

      return apiKey("second");
    });

    assert.deepEqual(seen, [undefined, apiKey("first")]);
  });

  it("leaves the entry alone when the function returns nothing", async () => {
    const { store: credentials } = store();

    await credentials.modify("anthropic", async () => apiKey("first"));

    assert.deepEqual(await credentials.modify("anthropic", async () => undefined), apiKey("first"));
    assert.deepEqual(await credentials.read("anthropic"), apiKey("first"));
  });

  it("does not lose a write when two modifications of one provider overlap", async () => {
    const { store: credentials, directory } = store();
    const order: string[] = [];

    // Ровно тот случай, ради которого modify существует: внутри него Pi обновляет OAuth-токен
    // сетевым запросом, и параллельный вход не должен ни потерять запись, ни увидеть старую.
    const slow = credentials.modify("anthropic", async (current) => {
      order.push(`slow saw ${JSON.stringify(current)}`);
      await new Promise((resolve) => setTimeout(resolve, 20));
      order.push("slow wrote");

      return apiKey("slow");
    });
    const fast = credentials.modify("anthropic", async (current) => {
      order.push(`fast saw ${JSON.stringify(current)}`);

      return apiKey("fast");
    });

    await Promise.all([slow, fast]);

    assert.deepEqual(order, [
      "slow saw undefined",
      "slow wrote",
      'fast saw {"type":"api_key","key":"slow"}',
    ]);
    assert.deepEqual(fileAt(directory), {
      credentials: {
        anthropic: keySet([{ id: "key-1", label: "", credential: apiKey("fast") }], "key-1"),
      },
    });
  });

  it("does not serialize modifications of different providers against each other", async () => {
    const { store: credentials } = store();
    const order: string[] = [];

    // Общий замок означал бы, что зависшее обновление токена одного провайдера блокирует запись
    // для всех остальных, а держится оно секундами сетевого запроса.
    const slow = credentials.modify("anthropic", async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      order.push("anthropic");

      return apiKey("slow");
    });
    const fast = credentials.modify("openai", async () => {
      order.push("openai");

      return apiKey("fast");
    });

    await Promise.all([slow, fast]);

    assert.deepEqual(order, ["openai", "anthropic"]);
  });

  it("serializes a removal against a modification of the same provider", async () => {
    const { store: credentials, directory } = store();

    await credentials.modify("anthropic", async () => apiKey("first"));

    const modification = credentials.modify("anthropic", async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));

      return apiKey("second");
    });
    const removal = credentials.remove("anthropic");

    await Promise.all([modification, removal]);

    assert.equal(await credentials.read("anthropic"), undefined);
    assert.deepEqual(fileAt(directory), { credentials: {} });
  });

  it("lets a failing modification through instead of swallowing it", async () => {
    const { store: credentials } = store();

    await credentials.modify("anthropic", async () => apiKey("first"));
    await assert.rejects(
      credentials.modify("anthropic", async () => {
        throw new Error("вход не удался");
      }),
      /вход не удался/,
    );

    // Провалившийся вход не стирает то, что уже лежало: перелогиниться человек ещё может.
    assert.deepEqual(await credentials.read("anthropic"), apiKey("first"));
  });

  it("keeps memory and disk on the last committed credential when persistence fails", async () => {
    const { store: credentials, directory } = store();
    const path = join(directory, credentialsFileName);
    const backup = `${path}.backup`;

    await credentials.modify("anthropic", async () => apiKey("first"));
    renameSync(path, backup);
    mkdirSync(path);

    try {
      await assert.rejects(
        credentials.modify("anthropic", async () => apiKey("second")),
        /EISDIR|directory|invalid argument/i,
      );
      assert.deepEqual(await credentials.read("anthropic"), apiKey("first"));
    } finally {
      rmSync(path, { recursive: true, force: true });
      renameSync(backup, path);
    }

    assert.deepEqual(await reopen(directory).read("anthropic"), apiKey("first"));
  });

  it("refuses every write over a file it could not read, and keeps the file", async () => {
    const { store: credentials, directory } = store("{ это не json");
    const before = readFileSync(join(directory, credentialsFileName), "utf8");

    assert.match(credentials.problem() ?? "", /credentials\.json/);
    assert.equal(await credentials.read("anthropic"), undefined);
    assert.deepEqual(credentials.list(), []);

    await assert.rejects(credentials.modify("anthropic", async () => apiKey("s3cret")));
    await assert.rejects(credentials.remove("anthropic"));
    await assert.rejects(credentials.select("anthropic", "key-1"));
    await assert.rejects(credentials.removeKey("anthropic", "key-1"));

    // Под нечитаемым файлом лежат OAuth-токены, и переписать его значит потерять их насовсем.
    assert.equal(readFileSync(join(directory, credentialsFileName), "utf8"), before);
    assert.ok(records.some((record) => record.level === "error"));
  });

  it("refuses a file whose entries are not objects", () => {
    const { store: credentials } = store('{"credentials":{"anthropic":"s3cret"}}');

    assert.match(credentials.problem() ?? "", /anthropic/);
  });

  it("never lets a credential value reach the log", async () => {
    const secret = "sk-ant-очень-секретное-значение";
    const { store: credentials } = store();

    await credentials.modify("anthropic", async () => apiKey(secret));
    await credentials.read("anthropic");
    await credentials.rename("anthropic", "key-1", "личный");
    await credentials.remove("anthropic");

    const written = JSON.stringify(records);

    assert.ok(!written.includes(secret), `значение креда попало в журнал: ${written}`);
    assert.ok(
      records.some((record) => JSON.stringify(record).includes("anthropic")),
      "про провайдера в журнале не сказано вовсе",
    );
  });
});

describe("the credential store on a file of the previous shape", () => {
  const previous = `{"credentials":{"anthropic":${JSON.stringify(apiKey("s3cret"))}}}\n`;

  it("reads the single credential as the only key of the provider", async () => {
    const { store: credentials } = store(previous);

    assert.equal(credentials.problem(), undefined);
    assert.deepEqual(await credentials.read("anthropic"), apiKey("s3cret"));
    assert.deepEqual(credentials.keys("anthropic"), [{ id: "key-1", label: "" }]);
    assert.equal(credentials.selected("anthropic"), "key-1");
  });

  it("does not rewrite the file until something is written", async () => {
    const { store: credentials, directory } = store(previous);

    await credentials.read("anthropic");
    credentials.keys("anthropic");

    assert.equal(readFileSync(join(directory, credentialsFileName), "utf8"), previous);

    await credentials.modify("anthropic", async () => apiKey("rotated"));

    assert.deepEqual(fileAt(directory), {
      credentials: {
        anthropic: keySet([{ id: "key-1", label: "", credential: apiKey("rotated") }], "key-1"),
      },
    });
  });

  it("refuses a set that names a key it does not have", () => {
    const { store: credentials } = store(
      '{"credentials":{"anthropic":{"keys":[{"id":"key-1","credential":{"type":"api_key"}}],"selected":"key-9"}}}',
    );

    assert.match(credentials.problem() ?? "", /key-9/);
  });

  it("refuses a set with two keys of one identifier", () => {
    const { store: credentials } = store(
      '{"credentials":{"anthropic":{"keys":[{"id":"key-1","credential":{"type":"api_key"}},{"id":"key-1","credential":{"type":"api_key"}}]}}}',
    );

    assert.match(credentials.problem() ?? "", /two keys/);
  });

  it("refuses an empty set instead of reading it as a provider without a credential", () => {
    const { store: credentials } = store('{"credentials":{"anthropic":{"keys":[]}}}');

    assert.match(credentials.problem() ?? "", /empty/);
  });
});

describe("the key set of a provider", () => {
  it("adds a key by the login target and keeps the selection on the first one", async () => {
    const { store: credentials, directory } = store();

    const first = await credentials.withKeyTarget(
      "anthropic",
      { kind: "new", label: "личный" },
      () => credentials.modify("anthropic", async () => apiKey("personal")),
    );
    const second = await credentials.withKeyTarget(
      "anthropic",
      { kind: "new", label: "рабочий" },
      () => credentials.modify("anthropic", async () => apiKey("work")),
    );

    assert.equal(first.keyId, "key-1");
    assert.equal(second.keyId, "key-2");
    assert.deepEqual(credentials.keys("anthropic"), [
      { id: "key-1", label: "личный" },
      { id: "key-2", label: "рабочий" },
    ]);
    // Второй ключ не перехватывает выбор: выбранным ходит всё, что спрашивает провайдера целиком.
    assert.equal(credentials.selected("anthropic"), "key-1");
    assert.deepEqual(await credentials.read("anthropic"), apiKey("personal"));
    assert.deepEqual(await credentials.readKey("anthropic", "key-2"), apiKey("work"));
    assert.deepEqual(fileAt(directory), {
      credentials: {
        anthropic: keySet(
          [
            { id: "key-1", label: "личный", credential: apiKey("personal") },
            { id: "key-2", label: "рабочий", credential: apiKey("work") },
          ],
          "key-1",
        ),
      },
    });
  });

  it("writes over the named key when the login replaces one", async () => {
    const { store: credentials } = store();

    await credentials.withKeyTarget("anthropic", { kind: "new", label: "первый" }, () =>
      credentials.modify("anthropic", async () => apiKey("one")),
    );
    await credentials.withKeyTarget("anthropic", { kind: "new", label: "второй" }, () =>
      credentials.modify("anthropic", async () => apiKey("two")),
    );

    const replaced = await credentials.withKeyTarget(
      "anthropic",
      { kind: "existing", keyId: "key-2" },
      () => credentials.modify("anthropic", async () => apiKey("two-again")),
    );

    assert.equal(replaced.keyId, "key-2");
    assert.deepEqual(await credentials.readKey("anthropic", "key-2"), apiKey("two-again"));
    assert.deepEqual(credentials.keys("anthropic"), [
      { id: "key-1", label: "первый" },
      { id: "key-2", label: "второй" },
    ]);
  });

  it("leaves no key behind when the login writes nothing", async () => {
    const { store: credentials, directory } = store();

    const cancelled = await credentials.withKeyTarget(
      "anthropic",
      { kind: "new", label: "отменённый" },
      () => credentials.modify("anthropic", async () => undefined),
    );

    assert.equal(cancelled.keyId, undefined);
    assert.deepEqual(credentials.keys("anthropic"), []);
    assert.equal(
      statSync(join(directory, credentialsFileName), { throwIfNoEntry: false }),
      undefined,
    );
  });

  it("routes a plain modification back to the selected key once the target is gone", async () => {
    const { store: credentials } = store();

    await credentials.withKeyTarget("anthropic", { kind: "new", label: "первый" }, () =>
      credentials.modify("anthropic", async () => apiKey("one")),
    );
    await credentials.withKeyTarget("anthropic", { kind: "new", label: "второй" }, () =>
      credentials.modify("anthropic", async () => apiKey("two")),
    );

    // Так обновляется OAuth-токен: рантайм зовёт modify и о наборе не знает вовсе.
    await credentials.modify("anthropic", async () => apiKey("refreshed"));

    assert.deepEqual(await credentials.readKey("anthropic", "key-1"), apiKey("refreshed"));
    assert.deepEqual(await credentials.readKey("anthropic", "key-2"), apiKey("two"));
  });

  it("changes the selected key and reports an unknown one", async () => {
    const { store: credentials } = store();

    await credentials.withKeyTarget("anthropic", { kind: "new", label: "первый" }, () =>
      credentials.modify("anthropic", async () => apiKey("one")),
    );
    await credentials.withKeyTarget("anthropic", { kind: "new", label: "второй" }, () =>
      credentials.modify("anthropic", async () => apiKey("two")),
    );

    assert.equal(await credentials.select("anthropic", "key-2"), true);
    assert.equal(credentials.selected("anthropic"), "key-2");
    assert.deepEqual(await credentials.read("anthropic"), apiKey("two"));
    assert.equal(await credentials.select("anthropic", "key-9"), false);
    assert.equal(await credentials.select("openai", "key-1"), false);
  });

  it("renames a key without touching its credential", async () => {
    const { store: credentials } = store();

    await credentials.withKeyTarget("anthropic", { kind: "new", label: "" }, () =>
      credentials.modify("anthropic", async () => apiKey("one")),
    );

    assert.equal(await credentials.rename("anthropic", "key-1", "личный"), true);
    assert.deepEqual(credentials.keys("anthropic"), [{ id: "key-1", label: "личный" }]);
    assert.deepEqual(await credentials.read("anthropic"), apiKey("one"));
    assert.equal(await credentials.rename("anthropic", "key-9", "нет такого"), false);
  });

  it("moves the selection to the first key left when the selected one is removed", async () => {
    const { store: credentials } = store();

    for (const label of ["первый", "второй", "третий"]) {
      await credentials.withKeyTarget("anthropic", { kind: "new", label }, () =>
        credentials.modify("anthropic", async () => apiKey(label)),
      );
    }

    assert.equal(await credentials.select("anthropic", "key-2"), true);
    assert.equal(await credentials.removeKey("anthropic", "key-2"), true);

    assert.deepEqual(credentials.keys("anthropic"), [
      { id: "key-1", label: "первый" },
      { id: "key-3", label: "третий" },
    ]);
    assert.equal(credentials.selected("anthropic"), "key-1");
    assert.equal(await credentials.removeKey("anthropic", "key-2"), false);
  });

  it("drops the provider when its last key is removed", async () => {
    const { store: credentials, directory } = store();

    await credentials.withKeyTarget("anthropic", { kind: "new", label: "" }, () =>
      credentials.modify("anthropic", async () => apiKey("one")),
    );

    assert.equal(await credentials.removeKey("anthropic", "key-1"), true);
    assert.deepEqual(credentials.list(), []);
    assert.deepEqual(fileAt(directory), { credentials: {} });
  });

  it("gives a removed identifier back to the next key", async () => {
    const { store: credentials } = store();

    await credentials.withKeyTarget("anthropic", { kind: "new", label: "первый" }, () =>
      credentials.modify("anthropic", async () => apiKey("one")),
    );
    await credentials.withKeyTarget("anthropic", { kind: "new", label: "второй" }, () =>
      credentials.modify("anthropic", async () => apiKey("two")),
    );
    await credentials.removeKey("anthropic", "key-1");
    await credentials.withKeyTarget("anthropic", { kind: "new", label: "третий" }, () =>
      credentials.modify("anthropic", async () => apiKey("three")),
    );

    assert.deepEqual(credentials.keys("anthropic"), [
      { id: "key-2", label: "второй" },
      { id: "key-1", label: "третий" },
    ]);
  });

  it("refuses a login into a key the provider does not have", async () => {
    const { store: credentials, directory } = store();

    await assert.rejects(
      credentials.withKeyTarget("anthropic", { kind: "existing", keyId: "key-9" }, () =>
        credentials.modify("anthropic", async () => apiKey("ghost")),
      ),
      /key-9/,
    );

    assert.deepEqual(credentials.keys("anthropic"), []);
    // Набор без ключей и с именем выбранного — негодный файл: перезапуск отказал бы по нему всем
    // провайдерам сразу, а чинилось бы это только правкой руками.
    assert.equal(
      statSync(join(directory, credentialsFileName), { throwIfNoEntry: false }),
      undefined,
    );
  });

  it("writes nothing when the key of a running login is removed under it", async () => {
    const { store: credentials, directory } = store();

    await credentials.withKeyTarget("anthropic", { kind: "new", label: "первый" }, () =>
      credentials.modify("anthropic", async () => apiKey("one")),
    );
    await credentials.withKeyTarget("anthropic", { kind: "new", label: "второй" }, () =>
      credentials.modify("anthropic", async () => apiKey("two")),
    );

    await assert.rejects(
      credentials.withKeyTarget("anthropic", { kind: "existing", keyId: "key-2" }, async () => {
        await credentials.removeKey("anthropic", "key-2");

        return credentials.modify("anthropic", async () => apiKey("two-again"));
      }),
      /key-2/,
    );

    // Файл остался годным: оставшийся ключ читается перезапуском, а не уносит с собой весь файл.
    const reopened = reopen(directory);

    assert.equal(reopened.problem(), undefined);
    assert.deepEqual(reopened.keys("anthropic"), [{ id: "key-1", label: "первый" }]);
    assert.deepEqual(await reopened.read("anthropic"), apiKey("one"));
  });

  it("writes nothing when the named key is gone", async () => {
    const { store: credentials } = store();

    await credentials.withKeyTarget("anthropic", { kind: "new", label: "" }, () =>
      credentials.modify("anthropic", async () => apiKey("one")),
    );

    assert.equal(
      await credentials.modifyKey("anthropic", "key-9", async () => apiKey("ghost")),
      undefined,
    );
    assert.deepEqual(credentials.keys("anthropic"), [{ id: "key-1", label: "" }]);
  });

  it("keeps the whole set across a restart", async () => {
    const { store: credentials, directory } = store();

    await credentials.withKeyTarget("anthropic", { kind: "new", label: "личный" }, () =>
      credentials.modify("anthropic", async () => apiKey("one")),
    );
    await credentials.withKeyTarget("anthropic", { kind: "new", label: "рабочий" }, () =>
      credentials.modify("anthropic", async () => apiKey("two")),
    );
    await credentials.select("anthropic", "key-2");

    const reopened = reopen(directory);

    assert.deepEqual(reopened.keys("anthropic"), [
      { id: "key-1", label: "личный" },
      { id: "key-2", label: "рабочий" },
    ]);
    assert.equal(reopened.selected("anthropic"), "key-2");
    assert.deepEqual(await reopened.read("anthropic"), apiKey("two"));
  });
});
