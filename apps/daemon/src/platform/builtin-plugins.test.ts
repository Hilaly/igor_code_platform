import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import {
  builtinDirectoryName,
  builtinStampFileName,
  unpackBuiltinPlugins,
} from "./builtin-plugins.ts";
import { createLogger, type Logger } from "./logger.ts";

const workspace = mkdtempSync(join(tmpdir(), "sovereign-builtin-plugins-"));
let made = 0;

const dataDirectory = (): string => {
  made += 1;

  const directory = join(workspace, `data-${String(made)}`);

  mkdirSync(directory, { recursive: true });

  return directory;
};

const records: { message: string; fields?: unknown }[] = [];
const logger: Logger = createLogger({
  source: "core",
  level: () => "debug",
  write: (record) => records.push({ message: record.message, fields: record.fields }),
});

const payload = (worker = "export const activate = () => {};\n"): Map<string, Uint8Array> =>
  new Map([
    ["starter/package.json", Buffer.from('{"sovereign":{"id":"starter"}}', "utf8")],
    ["starter/src/worker.ts", Buffer.from(worker, "utf8")],
    [
      "starter/node_modules/@sovereign/sdk/index.js",
      Buffer.from("export const contribute = {};\n", "utf8"),
    ],
  ]);

const unpack = (
  directory: string,
  overrides: Partial<Parameters<typeof unpackBuiltinPlugins>[0]> = {},
): string =>
  unpackBuiltinPlugins({
    dataDirectory: directory,
    version: "0.1.0",
    digest: "first",
    files: payload(),
    logger,
    ...overrides,
  });

describe("unpackBuiltinPlugins", () => {
  it("lays the payload out as a plugin root inside the directory of the version", () => {
    const data = dataDirectory();

    const root = unpack(data);

    assert.equal(root, join(data, builtinDirectoryName, "0.1.0"));
    assert.equal(
      readFileSync(join(root, "starter", "package.json"), "utf8"),
      '{"sovereign":{"id":"starter"}}',
    );
    // Вложенность восстанавливается из ключа: `node_modules` рядом с манифестом — то, из-за чего
    // распакованному плагину не нужен `npm`.
    assert.equal(
      existsSync(join(root, "starter", "node_modules", "@sovereign", "sdk", "index.js")),
      true,
    );
    assert.equal(readFileSync(join(root, builtinStampFileName), "utf8").trim(), "first");
  });

  it("leaves everything alone when the payload is the one already unpacked", () => {
    const data = dataDirectory();
    const root = unpack(data);
    const marker = join(root, "starter", "left-by-hand.md");

    writeFileSync(marker, "a file nobody asked for");
    unpack(data);

    // Отпечаток тот же, значит и распаковки нет: иначе каждый старт переписывал бы мегабайты.
    assert.equal(existsSync(marker), true);
  });

  it("replaces the directory of the version when the payload changed", () => {
    const data = dataDirectory();
    const root = unpack(data);

    writeFileSync(join(root, "starter", "src", "worker.ts"), "// правка руками\n");
    unpack(data, { digest: "second", files: payload("export const activate = async () => {};\n") });

    // Правка руками затирается обновлением артефакта — это и есть обещание каталога.
    assert.equal(
      readFileSync(join(root, "starter", "src", "worker.ts"), "utf8"),
      "export const activate = async () => {};\n",
    );
    assert.equal(readFileSync(join(root, builtinStampFileName), "utf8").trim(), "second");
  });

  it("forgets past versions and staging left by a torn unpacking", () => {
    const data = dataDirectory();
    const root = join(data, builtinDirectoryName);

    mkdirSync(join(root, "0.0.9"), { recursive: true });
    mkdirSync(join(root, ".0.1.0.incoming-abc123"), { recursive: true });
    writeFileSync(join(root, "0.0.9", "stale.md"), "a version nobody runs any more");

    unpack(data);

    assert.deepEqual(readdirSync(root), ["0.1.0"]);
  });

  it("keeps no half-unpacked directory when writing the payload fails", () => {
    const data = dataDirectory();
    const files = new Map<string, Uint8Array>([
      ["starter/package.json", Buffer.from("{}", "utf8")],
      // Каталог и файл под одним именем: второй записи взяться неоткуда, и это обрыв посреди работы.
      ["starter/package.json/nested.js", Buffer.from("", "utf8")],
    ]);

    assert.throws(() => unpack(data, { files }));

    // Ни готового каталога версии, ни брошенного временного: следующий старт распакует заново.
    assert.deepEqual(readdirSync(join(data, builtinDirectoryName)), []);
  });
});
