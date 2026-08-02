import assert from "node:assert/strict";
import { once } from "node:events";
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { createServer, request as sendRequest, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";

import { filesystemPath } from "@sovereign/protocol";

import { createDispatcher } from "./dispatcher.ts";
import { createLogger } from "./logger.ts";
import { filesystemRoutes } from "./filesystem.ts";

const quietLogger = createLogger({ source: "core", level: () => "debug", write: () => {} });

// Тесты поднимают настоящий HTTP-сервер на 127.0.0.1 — тот же способ, что в dispatcher.test.ts и
// appearance-preferences.test.ts: иначе слой node:http и разбор url не проверить. Временный
// каталог — листинг реальной файловой системы, а не мока.

const servers: Server[] = [];

after(async () => {
  for (const server of servers) {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});

type Answer = { status: number; body: string };

async function serve(): Promise<(path: string) => Promise<Answer>> {
  const server = createServer(
    createDispatcher({
      routes: filesystemRoutes(),
      logger: quietLogger,
      authenticate: () => ({ kind: "session", id: "the-session" }),
    }),
  );

  servers.push(server);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  const { port } = server.address() as AddressInfo;

  return (path: string) =>
    new Promise((resolve, reject) => {
      const outgoing = sendRequest({ host: "127.0.0.1", port, method: "GET", path }, (incoming) => {
        let text = "";
        incoming.setEncoding("utf8");
        incoming.on("data", (chunk: string) => {
          text += chunk;
        });
        incoming.on("end", () => resolve({ status: incoming.statusCode ?? 0, body: text }));
      });

      outgoing.on("error", reject);
      outgoing.end();
    });
}

describe("filesystem listing route", () => {
  it("lists directories first then files, dropping hidden and node_modules", async () => {
    const root = mkdtempSync(join(tmpdir(), "sovereign-fs-"));

    mkdirSync(join(root, "beta"));
    mkdirSync(join(root, "alpha"));
    writeFileSync(join(root, "readme.md"), "");
    writeFileSync(join(root, ".hidden"), "");
    mkdirSync(join(root, "node_modules"));

    const call = await serve();

    const answer = await call(`${filesystemPath}?path=${encodeURIComponent(root)}`);

    assert.equal(answer.status, 200);
    const body = JSON.parse(answer.body) as {
      path: string;
      entries: { name: string; kind: string }[];
    };

    assert.equal(body.path, root);
    assert.deepEqual(
      body.entries.map((entry) => `${entry.kind}:${entry.name}`),
      ["directory:alpha", "directory:beta", "file:readme.md"],
    );
  });

  it("answers 400 when the path parameter is missing", async () => {
    const call = await serve();

    const answer = await call(filesystemPath);

    assert.equal(answer.status, 400);
    assert.equal(JSON.parse(answer.body).error, "the path query parameter is required");
  });

  it("answers 404 for a directory that is not there", async () => {
    const call = await serve();

    const answer = await call(`${filesystemPath}?path=${encodeURIComponent("/no/such/dir")}`);

    assert.equal(answer.status, 404);
    assert.equal(JSON.parse(answer.body).error, "no such directory");
  });

  it("answers 403 for a directory that cannot be read", async () => {
    // На POSIX без прав на чтение каталога `readdirSync` падает с EACCES. На Windows `chmod` не
    // эквивалентен, и тест проверяет только платформу, где поведение воспроизводимо.
    if (process.platform === "win32") {
      return;
    }

    const root = mkdtempSync(join(tmpdir(), "sovereign-fs-"));
    const locked = join(root, "locked");

    mkdirSync(locked);
    writeFileSync(join(locked, "secret.txt"), "");
    chmodSync(locked, 0o000);

    const call = await serve();

    try {
      const answer = await call(`${filesystemPath}?path=${encodeURIComponent(locked)}`);

      assert.equal(answer.status, 403);
      assert.equal(JSON.parse(answer.body).error, "the directory cannot be read");
    } finally {
      // Вернуть права, чтобы временный каталог удалось убрать при очистке.
      chmodSync(locked, 0o700);
    }
  });
});
