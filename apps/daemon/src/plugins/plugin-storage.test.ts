import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";

import { createPluginStorage, encodePluginKey } from "./plugin-storage.ts";
import type { ContributingPlugin } from "./contribution-registry.ts";
import type { Logger } from "../platform/public.ts";

const records: { level: string; message: string }[] = [];

const logger: Logger = {
  debug: (message) => records.push({ level: "debug", message }),
  info: (message) => records.push({ level: "info", message }),
  warn: (message) => records.push({ level: "warn", message }),
  error: (message) => records.push({ level: "error", message }),
};

const builtin: ContributingPlugin = { key: "builtin:tasks", id: "tasks", source: "builtin" };
const data: ContributingPlugin = { key: "data:tasks", id: "tasks", source: "data" };

let directory = "";

beforeEach(() => {
  records.length = 0;
  directory = mkdtempSync(join(tmpdir(), "sovereign-plugin-storage-"));
});

afterEach(() => {
  rmSync(directory, { recursive: true, force: true });
});

const storage = () => createPluginStorage({ directory, logger });

describe("the key-value storage of a plugin", () => {
  it("gives back what it was given and says nothing about what it was not", async () => {
    const store = storage();

    assert.deepEqual(
      await store.answer(data, { kind: "storage-set", key: "last", value: { id: 7 } }),
      {
        kind: "storage-written",
      },
    );
    assert.deepEqual(await store.answer(data, { kind: "storage-get", key: "last" }), {
      kind: "storage-value",
      value: { id: 7 },
    });
    // Поля нет вовсе: `undefined` через структурное клонирование не отличить от «не клали».
    assert.deepEqual(await store.answer(data, { kind: "storage-get", key: "never" }), {
      kind: "storage-value",
    });
  });

  it("keeps the storage of an overriding copy apart from the storage it overrides", async () => {
    const store = storage();

    await store.answer(builtin, { kind: "storage-set", key: "last", value: "встроенный" });
    await store.answer(data, { kind: "storage-set", key: "last", value: "черновик" });

    // Перекрытие — это другой плагин (docs/plugins.md): черновик из директории данных не имеет
    // права работать с боевыми данными встроенного.
    assert.deepEqual(await store.answer(builtin, { kind: "storage-get", key: "last" }), {
      kind: "storage-value",
      value: "встроенный",
    });
    assert.deepEqual(await store.answer(data, { kind: "storage-get", key: "last" }), {
      kind: "storage-value",
      value: "черновик",
    });
  });

  it("stores arrays as JSON values", async () => {
    const store = storage();

    assert.deepEqual(
      await store.answer(data, { kind: "storage-set", key: "items", value: [1, { ok: true }] }),
      { kind: "storage-written" },
    );
  });

  it("writes a file named by the plugin key, with the colon encoded", async () => {
    const store = storage();

    await store.answer(data, { kind: "storage-set", key: "last", value: 1 });

    // Двоеточие в имени файла незаконно на Windows, поэтому кодируется тем же `%3A`, каким ключ уже
    // кодируется в маршруте предпочтений.
    const path = join(directory, "plugin-storage", "data%3Atasks.json");

    assert.deepEqual(JSON.parse(readFileSync(path, "utf8")), { values: { last: 1 } });
    assert.equal(encodePluginKey("project:b7Kq3xv9pQdT:tasks"), "project%3Ab7Kq3xv9pQdT%3Atasks");
  });

  it("lists the keys in order and forgets a deleted one", async () => {
    const store = storage();

    await store.answer(data, { kind: "storage-set", key: "b", value: 2 });
    await store.answer(data, { kind: "storage-set", key: "a", value: 1 });

    assert.deepEqual(await store.answer(data, { kind: "storage-keys" }), {
      kind: "storage-keys",
      keys: ["a", "b"],
    });

    await store.answer(data, { kind: "storage-delete", key: "a" });

    // Удаление того, чего нет, — не ошибка: платформа отвечает тем же «записано».
    assert.deepEqual(await store.answer(data, { kind: "storage-delete", key: "a" }), {
      kind: "storage-written",
    });
    assert.deepEqual(await store.answer(data, { kind: "storage-keys" }), {
      kind: "storage-keys",
      keys: ["b"],
    });
  });

  it("refuses a key that would not be a key", async () => {
    const store = storage();

    for (const key of ["", "../escape", ".hidden", "с пробелом", "a".repeat(129)]) {
      const answer = await store.answer(data, { kind: "storage-get", key });

      assert.equal(answer.kind, "failed", key);
    }
  });

  it("refuses a value that is not json instead of writing half of the document", async () => {
    const store = storage();
    const cyclic: Record<string, unknown> = {};
    cyclic["self"] = cyclic;

    await store.answer(data, { kind: "storage-set", key: "kept", value: 1 });
    const answer = await store.answer(data, { kind: "storage-set", key: "cyclic", value: cyclic });

    assert.equal(answer.kind, "failed");
    assert.deepEqual(await store.answer(data, { kind: "storage-keys" }), {
      kind: "storage-keys",
      keys: ["kept"],
    });
  });

  it("rejects every value that is not representable as JSON", async () => {
    const store = storage();
    await store.answer(data, { kind: "storage-set", key: "kept", value: 1 });

    const invalid: unknown[] = [
      undefined,
      () => "no",
      Symbol("no"),
      NaN,
      Infinity,
      new Map(),
      { nested: undefined },
      [undefined],
    ];

    for (const value of invalid) {
      const answer = await store.answer(data, { kind: "storage-set", key: "bad", value });

      assert.equal(answer.kind, "failed");
    }

    assert.deepEqual(await store.answer(data, { kind: "storage-keys" }), {
      kind: "storage-keys",
      keys: ["kept"],
    });
  });

  it("refuses to read and to overwrite a broken file, and says so in the journal", async () => {
    mkdirSync(join(directory, "plugin-storage"), { recursive: true });
    const path = join(directory, "plugin-storage", "data%3Atasks.json");
    writeFileSync(path, "{ это не json");

    const store = storage();
    const read = await store.answer(data, { kind: "storage-get", key: "last" });
    const written = await store.answer(data, { kind: "storage-set", key: "last", value: 1 });

    assert.equal(read.kind, "failed");
    assert.equal(written.kind, "failed");
    // Под файлом состояние, которого больше нигде нет: чинит его человек, а не запись поверх
    // (docs/data-directory.md).
    assert.equal(readFileSync(path, "utf8"), "{ это не json");
    assert.ok(records.some((record) => record.level === "error"));
  });

  it("keeps the storage of one plugin readable when another one is broken", async () => {
    mkdirSync(join(directory, "plugin-storage"), { recursive: true });
    writeFileSync(join(directory, "plugin-storage", "data%3Atasks.json"), "битый");

    const store = storage();

    assert.deepEqual(await store.answer(builtin, { kind: "storage-set", key: "last", value: 1 }), {
      kind: "storage-written",
    });
  });
});

describe("the folder of a plugin", () => {
  it("is created by the time the plugin gets its path", async () => {
    const store = storage();
    const answer = await store.answer(data, { kind: "storage-directory" });

    assert.equal(answer.kind, "storage-directory");
    assert.equal(
      answer.kind === "storage-directory" ? answer.path : "",
      join(directory, "plugin-files", "data%3Atasks"),
    );
    // Папка уже есть: плагин, получивший путь, вправе сразу писать в него.
    assert.doesNotThrow(() =>
      writeFileSync(join(directory, "plugin-files", "data%3Atasks", "cache"), "…"),
    );
  });
});

describe("the storage of plugins from a deleted project", () => {
  it("goes away with the project and leaves the other plugins alone", async () => {
    const store = storage();
    const projectPlugin: ContributingPlugin = {
      key: "project:b7Kq3xv9pQdT:tasks",
      id: "tasks",
      source: "project:b7Kq3xv9pQdT",
    };
    const otherProject: ContributingPlugin = {
      key: "project:zzz:tasks",
      id: "tasks",
      source: "project:zzz",
    };

    await store.answer(projectPlugin, { kind: "storage-set", key: "last", value: 1 });
    await store.answer(projectPlugin, { kind: "storage-directory" });
    await store.answer(otherProject, { kind: "storage-set", key: "last", value: 1 });
    await store.answer(data, { kind: "storage-set", key: "last", value: 1 });

    store.removeProject("b7Kq3xv9pQdT");

    assert.deepEqual(await store.answer(projectPlugin, { kind: "storage-keys" }), {
      kind: "storage-keys",
      keys: [],
    });
    assert.deepEqual(await store.answer(otherProject, { kind: "storage-keys" }), {
      kind: "storage-keys",
      keys: ["last"],
    });
    assert.deepEqual(await store.answer(data, { kind: "storage-keys" }), {
      kind: "storage-keys",
      keys: ["last"],
    });
  });
});
