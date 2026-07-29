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
import { ensureDataDirectory } from "./data-directory.ts";
import { createLogger } from "./logger.ts";

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

function fileAt(directory: string): unknown {
  return JSON.parse(readFileSync(join(directory, credentialsFileName), "utf8"));
}

const apiKey = (key: string) => ({ type: "api_key", key });

describe("the credential store", () => {
  it("is empty before anything was written, and writes no file", () => {
    const { store: credentials, directory } = store();

    assert.deepEqual(credentials.list(), []);
    assert.equal(
      statSync(join(directory, credentialsFileName), { throwIfNoEntry: false }),
      undefined,
    );
  });

  it("keeps a credential across a restart", async () => {
    const { store: credentials, directory } = store();

    await credentials.modify("anthropic", async () => apiKey("s3cret"));

    assert.deepEqual(fileAt(directory), { credentials: { anthropic: apiKey("s3cret") } });

    const reopened = createCredentialStore({
      directory,
      logger: createLogger({ source: "core", level: () => "debug", write: () => {} }),
    });

    assert.deepEqual(await reopened.read("anthropic"), apiKey("s3cret"));
    assert.deepEqual(reopened.list(), ["anthropic"]);
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
    assert.deepEqual(fileAt(directory), { credentials: { anthropic: apiKey("fast") } });
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

    const reopened = createCredentialStore({
      directory,
      logger: createLogger({ source: "core", level: () => "debug", write: () => {} }),
    });
    assert.deepEqual(await reopened.read("anthropic"), apiKey("first"));
  });

  it("refuses every write over a file it could not read, and keeps the file", async () => {
    const { store: credentials, directory } = store("{ это не json");
    const before = readFileSync(join(directory, credentialsFileName), "utf8");

    assert.match(credentials.problem() ?? "", /credentials\.json/);
    assert.equal(await credentials.read("anthropic"), undefined);
    assert.deepEqual(credentials.list(), []);

    await assert.rejects(credentials.modify("anthropic", async () => apiKey("s3cret")));
    await assert.rejects(credentials.remove("anthropic"));

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
    await credentials.remove("anthropic");

    const written = JSON.stringify(records);

    assert.ok(!written.includes(secret), `значение креда попало в журнал: ${written}`);
    assert.ok(
      records.some((record) => JSON.stringify(record).includes("anthropic")),
      "про провайдера в журнале не сказано вовсе",
    );
  });
});
