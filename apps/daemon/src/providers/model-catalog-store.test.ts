import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";

import type { LogRecord } from "@sovereign/protocol";

import { ensureDataDirectory } from "../platform/public.ts";
import { createLogger } from "../platform/public.ts";
import { createModelCatalogStore, modelCatalogsFileName } from "./model-catalog-store.ts";

const workspace = mkdtempSync(join(tmpdir(), "sovereign-model-catalogs-"));

after(() => {
  rmSync(workspace, { recursive: true, force: true });
});

let directories = 0;

function store(contents?: string) {
  directories += 1;

  const directory = ensureDataDirectory(join(workspace, `data-${directories}`));

  if (contents !== undefined) {
    writeFileSync(join(directory, modelCatalogsFileName), contents);
  }

  const records: LogRecord[] = [];
  const logger = createLogger({
    source: "core",
    level: () => "debug",
    write: (record) => records.push(record),
  });

  return { store: createModelCatalogStore({ directory, logger }), directory, records };
}

const entry = { models: [{ id: "one" }], etag: '"abc"' };

describe("the model catalogue cache", () => {
  it("keeps an entry across a restart", () => {
    const { store: catalogs, directory, records } = store();

    catalogs.write("radius", entry);

    assert.deepEqual(JSON.parse(readFileSync(join(directory, modelCatalogsFileName), "utf8")), {
      catalogs: { radius: entry },
    });

    const reopened = createModelCatalogStore({
      directory,
      logger: createLogger({ source: "core", level: () => "debug", write: () => {} }),
    });

    assert.deepEqual(reopened.read("radius"), entry);
    assert.equal(records.length, 0);
  });

  it("forgets a broken file instead of refusing, and writes over it", () => {
    const { store: catalogs, directory, records } = store("{ это не json");

    assert.equal(catalogs.read("radius"), undefined);

    // Обратная кредам политика: это кэш, и худшая цена ошибки — один лишний сетевой запрос.
    catalogs.write("radius", entry);

    assert.deepEqual(JSON.parse(readFileSync(join(directory, modelCatalogsFileName), "utf8")), {
      catalogs: { radius: entry },
    });
    assert.ok(records.some((record) => record.level === "warn"));
  });

  it("removes an entry and says nothing about one that was not there", () => {
    const { store: catalogs, directory } = store();

    catalogs.write("radius", entry);
    catalogs.remove("radius");
    catalogs.remove("radius");

    assert.equal(catalogs.read("radius"), undefined);
    assert.deepEqual(JSON.parse(readFileSync(join(directory, modelCatalogsFileName), "utf8")), {
      catalogs: {},
    });
  });
});
