import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import type { ArtifactPayload } from "../src/platform/artifact-payload.ts";
import {
  payloadDigest,
  payloadModuleSource,
  readDirectoryFiles,
  type PayloadContents,
} from "./artifact-payload-module.ts";

const workspace = mkdtempSync(join(tmpdir(), "sovereign-artifact-payload-"));
let made = 0;

const contents = (overrides: Partial<PayloadContents> = {}): PayloadContents => ({
  web: new Map([
    ["index.html", Buffer.from("<!doctype html>", "utf8")],
    ["assets/main-a1b2c3.js", Buffer.from("export const app = 1;", "utf8")],
  ]),
  builtin: new Map([["starter/package.json", Buffer.from('{"name":"starter"}', "utf8")]]),
  worker: Buffer.from("export const bootstrap = 1;", "utf8"),
  runtimeDependencies: { esbuild: "0.28.1" },
  ...overrides,
});

/** Единственный честный способ проверить сгенерированный модуль — исполнить его. */
async function loadPayload(source: string): Promise<ArtifactPayload> {
  made += 1;

  const directory = join(workspace, `module-${String(made)}`);
  mkdirSync(directory, { recursive: true });

  const path = join(directory, "payload.mjs");
  writeFileSync(path, source);

  const module = (await import(path)) as { artifactPayload: () => ArtifactPayload };

  return module.artifactPayload();
}

describe("payloadModuleSource", () => {
  it("produces a module that matches the shape of the seam", async () => {
    const payload = await loadPayload(payloadModuleSource(contents()));

    assert.equal(payload.web.get("index.html")?.byteLength, 15);
    assert.equal(
      Buffer.from(payload.web.get("assets/main-a1b2c3.js") ?? new Uint8Array()).toString("utf8"),
      "export const app = 1;",
    );
    assert.equal(
      Buffer.from(payload.builtin.get("starter/package.json") ?? new Uint8Array()).toString("utf8"),
      '{"name":"starter"}',
    );
    assert.equal(Buffer.from(payload.worker).toString("utf8"), "export const bootstrap = 1;");
    assert.deepEqual(payload.runtimeDependencies, { esbuild: "0.28.1" });
    assert.equal(payload.digest, payloadDigest(contents()));
  });

  it("carries binary files through without touching them", async () => {
    const bytes = Buffer.from([0x00, 0xff, 0x77, 0x4f, 0x46, 0x32, 0x0a, 0x80]);
    const payload = await loadPayload(
      payloadModuleSource(contents({ web: new Map([["assets/onest.woff2", bytes]]) })),
    );

    assert.deepEqual(Buffer.from(payload.web.get("assets/onest.woff2") ?? new Uint8Array()), bytes);
  });
});

describe("payloadDigest", () => {
  it("stays the same when only the order of the files changes", () => {
    const straight = contents();
    const reversed = contents({ web: new Map([...straight.web.entries()].reverse()) });

    assert.equal(payloadDigest(straight), payloadDigest(reversed));
  });

  it("changes when any part of the payload changes", () => {
    const digest = payloadDigest(contents());

    assert.notEqual(
      digest,
      payloadDigest(contents({ worker: Buffer.from("export const bootstrap = 2;", "utf8") })),
    );
    assert.notEqual(
      digest,
      payloadDigest(contents({ runtimeDependencies: { esbuild: "0.28.2" } })),
    );
    assert.notEqual(
      digest,
      payloadDigest(contents({ web: new Map([["index.html", Buffer.from("<html>", "utf8")]]) })),
    );
    assert.notEqual(
      digest,
      payloadDigest(
        contents({
          builtin: new Map([["starter/package.json", Buffer.from('{"name":"other"}', "utf8")]]),
        }),
      ),
    );
  });
});

describe("readDirectoryFiles", () => {
  it("walks the whole tree and names files by their address, not by their path", () => {
    made += 1;

    const root = join(workspace, `tree-${String(made)}`);
    mkdirSync(join(root, "assets"), { recursive: true });
    writeFileSync(join(root, "index.html"), "<!doctype html>");
    writeFileSync(join(root, "assets", "main-a1b2c3.js"), "export const app = 1;");

    const files = readDirectoryFiles(root);

    // Ключ — адрес в браузере, поэтому разделитель `/` и на Windows.
    assert.deepEqual([...files.keys()].sort(), ["assets/main-a1b2c3.js", "index.html"]);
  });
});
