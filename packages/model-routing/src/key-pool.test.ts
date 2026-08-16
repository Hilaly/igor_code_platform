import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createKeyPool } from "./key-pool.ts";

function pool(startAt = 1_000) {
  let clock = startAt;

  return {
    pool: createKeyPool({ now: () => clock }),
    advance: (ms: number) => {
      clock += ms;
    },
  };
}

const keys = ["key-1", "key-2", "key-3"];

describe("the key pool", () => {
  it("gives a fresh key to every new session, in turn", () => {
    const { pool: keyPool } = pool();

    // Лимит одного ключа собирается на одном ключе, если раздавать всем первый.
    assert.deepEqual(
      [
        keyPool.lease("anthropic", keys),
        keyPool.lease("anthropic", keys),
        keyPool.lease("anthropic", keys),
      ],
      ["key-1", "key-2", "key-3"],
    );
    assert.equal(keyPool.lease("anthropic", keys), "key-1");
  });

  it("counts the keys of one provider apart from the keys of another", () => {
    const { pool: keyPool } = pool();

    keyPool.lease("anthropic", keys);

    // Одинаковые идентификаторы у разных провайдеров — обычное дело: ключи нумеруются по провайдеру.
    assert.equal(keyPool.lease("openai", keys), "key-1");
  });

  it("skips a key that is cooling and comes back to it once it is over", () => {
    const { pool: keyPool, advance } = pool();

    keyPool.report("anthropic", "key-1", { kind: "cooling", forMs: 60_000 });

    assert.equal(keyPool.lease("anthropic", ["key-1", "key-2"]), "key-2");
    assert.deepEqual(keyPool.state("anthropic", "key-1"), { kind: "cooling", until: 61_000 });

    advance(60_000);

    // Остывший становится годным сам: следующего отчёта по нему не будет — его никто не выбирает.
    assert.deepEqual(keyPool.state("anthropic", "key-1"), { kind: "healthy" });
    assert.equal(keyPool.usable("anthropic", ["key-1"])[0], "key-1");
  });

  it("keeps a refused key out until something says otherwise", () => {
    const { pool: keyPool, advance } = pool();

    keyPool.report("anthropic", "key-1", { kind: "refused", reason: "invalid x-api-key" });
    advance(24 * 60 * 60 * 1000);

    assert.deepEqual(keyPool.state("anthropic", "key-1"), {
      kind: "refused",
      reason: "invalid x-api-key",
    });
    assert.deepEqual(keyPool.usable("anthropic", ["key-1", "key-2"]), ["key-2"]);
  });

  it("takes a key back into service on the first success", () => {
    const { pool: keyPool } = pool();

    keyPool.report("anthropic", "key-1", { kind: "refused", reason: "invalid x-api-key" });
    keyPool.report("anthropic", "key-1", "success");

    assert.deepEqual(keyPool.state("anthropic", "key-1"), { kind: "healthy" });
  });

  it("gives out nothing when every key is spent", () => {
    const { pool: keyPool } = pool();

    keyPool.report("anthropic", "key-1", { kind: "refused", reason: "нет" });
    keyPool.report("anthropic", "key-2", { kind: "cooling", forMs: 60_000 });

    // Остывающий в раздачу не идёт: сессия живёт долго, и начинать её с занятого ключа значит
    // начать с отказа.
    assert.equal(keyPool.lease("anthropic", ["key-1", "key-2"]), undefined);
    // А в порядке пригодности он есть: попытке, которой больше нечем ходить, он ещё пригодится.
    assert.deepEqual(keyPool.usable("anthropic", ["key-1", "key-2"]), ["key-2"]);
  });

  it("puts the soonest cooling key before the ones that wait longer", () => {
    const { pool: keyPool } = pool();

    keyPool.report("anthropic", "key-1", { kind: "cooling", forMs: 90_000 });
    keyPool.report("anthropic", "key-2", { kind: "cooling", forMs: 10_000 });

    assert.deepEqual(keyPool.usable("anthropic", ["key-1", "key-2"]), ["key-2", "key-1"]);
  });

  it("puts every healthy key before every cooling one", () => {
    const { pool: keyPool } = pool();

    keyPool.report("anthropic", "key-1", { kind: "cooling", forMs: 10_000 });

    assert.deepEqual(keyPool.usable("anthropic", keys), ["key-2", "key-3", "key-1"]);
  });

  it("knows nothing about a key nobody reported, and calls it healthy", () => {
    const { pool: keyPool } = pool();

    assert.deepEqual(keyPool.state("anthropic", "key-9"), { kind: "healthy" });
  });
});
