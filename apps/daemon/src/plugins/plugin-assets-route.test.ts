import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, it } from "node:test";

import { pluginAssetAddress } from "@sovereign/protocol";

import { createDispatcher } from "../http/public.ts";
import { createLogger } from "../platform/public.ts";
import { pluginAssetsRoute } from "./plugin-assets-route.ts";
import { createPluginAssetStore } from "./plugin-assets.ts";

const pluginKey = "project:p1:browsered";
const revision = "abcdefghijkl";
const script = "export const view = () => null;\n";

function store() {
  const assets = createPluginAssetStore();

  assets.put(pluginKey, {
    revision,
    files: new Map([
      ["browser.js", new TextEncoder().encode(script)],
      ["browser.css", new TextEncoder().encode(".badge{display:flex}")],
      ["browser.js.map", new TextEncoder().encode('{"version":3}')],
    ]),
  });

  return assets;
}

/**
 * Живой сервер, а не вызов обработчика: заголовки и коды — это ровно то, что проверяется, и часть из
 * них ставит диспетчер, а не маршрут.
 */
async function serving(
  authenticated: boolean,
): Promise<{ port: number; close: () => Promise<void> }> {
  const assets = store();
  const server: Server = createServer(
    createDispatcher({
      routes: [pluginAssetsRoute({ plugins: { browserAsset: assets.read } })],
      logger: createLogger({ source: "core", level: () => "debug", write: () => {} }),
      authenticate: () =>
        authenticated ? { kind: "session" as const, id: "the-session" } : { kind: "none" as const },
    }),
  );

  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  return {
    port: (server.address() as AddressInfo).port,
    close: async () => {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

describe("pluginAssetsRoute", () => {
  it("gives back the file of the asked revision with the caching headers", async () => {
    const served = await serving(true);

    try {
      const answer = await fetch(
        `http://127.0.0.1:${served.port}${pluginAssetAddress(pluginKey, revision, "browser.js")}`,
      );

      assert.equal(answer.status, 200);
      assert.equal(answer.headers.get("content-type"), "text/javascript; charset=utf-8");
      assert.equal(answer.headers.get("content-length"), String(Buffer.byteLength(script)));
      assert.equal(answer.headers.get("cache-control"), "private, max-age=31536000, immutable");
      assert.equal(await answer.text(), script);
    } finally {
      await served.close();
    }
  });

  it("names the type of the stylesheet and of the source map", async () => {
    const served = await serving(true);

    try {
      const styles = await fetch(
        `http://127.0.0.1:${served.port}${pluginAssetAddress(pluginKey, revision, "browser.css")}`,
      );
      const map = await fetch(
        `http://127.0.0.1:${served.port}${pluginAssetAddress(pluginKey, revision, "browser.js.map")}`,
      );

      assert.equal(styles.headers.get("content-type"), "text/css; charset=utf-8");
      assert.equal(map.headers.get("content-type"), "application/json; charset=utf-8");
      assert.equal(await map.text(), '{"version":3}');
    } finally {
      await served.close();
    }
  });

  it("asks for a session like the rest of the application does", async () => {
    const served = await serving(false);

    try {
      const answer = await fetch(
        `http://127.0.0.1:${served.port}${pluginAssetAddress(pluginKey, revision, "browser.js")}`,
      );

      assert.equal(answer.status, 401);
    } finally {
      await served.close();
    }
  });

  it("tells a gone revision apart from a mistyped address", async () => {
    const served = await serving(true);

    try {
      const gone = await fetch(
        `http://127.0.0.1:${served.port}${pluginAssetAddress(pluginKey, "gonegonegone", "browser.js")}`,
      );
      const unknownPlugin = await fetch(
        `http://127.0.0.1:${served.port}${pluginAssetAddress("data:nobody", revision, "browser.js")}`,
      );
      const unknownFile = await fetch(
        `http://127.0.0.1:${served.port}${pluginAssetAddress(pluginKey, revision, "worker.js")}`,
      );
      const foreignExtension = await fetch(
        `http://127.0.0.1:${served.port}${pluginAssetAddress(pluginKey, revision, "package.json")}`,
      );

      assert.equal(gone.status, 404);
      assert.match(String(((await gone.json()) as { error: string }).error), /reload the page/);
      assert.equal(unknownPlugin.status, 404);
      assert.equal(unknownFile.status, 404);
      assert.equal(foreignExtension.status, 404);
      assert.match(
        String(((await foreignExtension.json()) as { error: string }).error),
        /is not a plugin asset/,
      );
    } finally {
      await served.close();
    }
  });

  it("does not let a path segment reach the file system", async () => {
    const served = await serving(true);

    try {
      // Сегмент — ключ `Map`, а не путь; проверка сторожит именно это, а не нормализацию адреса.
      const answer = await fetch(
        `http://127.0.0.1:${served.port}${pluginAssetAddress(pluginKey, revision, "../../../package.json")}`,
      );

      assert.equal(answer.status, 404);
    } finally {
      await served.close();
    }
  });

  it("refuses a method other than GET with the allowed one named", async () => {
    const served = await serving(true);

    try {
      const answer = await fetch(
        `http://127.0.0.1:${served.port}${pluginAssetAddress(pluginKey, revision, "browser.js")}`,
        { method: "POST" },
      );

      assert.equal(answer.status, 405);
      assert.equal(answer.headers.get("allow"), "GET");
    } finally {
      await served.close();
    }
  });
});
