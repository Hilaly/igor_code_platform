import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer, request as sendRequest, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { after, describe, it } from "node:test";

import type { LogRecord } from "@sovereign/protocol";

import { createLogger } from "../platform/public.ts";
import { createDispatcher, respondWithJson, type Route } from "./dispatcher.ts";
import { staticAssetsRoute } from "./static-assets.ts";

const servers: Server[] = [];

after(async () => {
  for (const server of servers) {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});

const payload = (entries: Record<string, string>): Map<string, Uint8Array> =>
  new Map(Object.entries(entries).map(([path, text]) => [path, Buffer.from(text, "utf8")]));

/** Соседи по таблице: без них не проверить, что фронтенд не съедает адреса API. */
const apiRoutes: Route[] = [
  {
    method: "GET",
    path: "/api/health",
    access: "open",
    handle: ({ response }) => respondWithJson(response, 200, { status: "ok" }),
  },
  {
    method: "PUT",
    path: "/api/plugins",
    handle: ({ response }) => respondWithJson(response, 200, {}),
  },
];

async function serve(files: Map<string, Uint8Array>) {
  const records: LogRecord[] = [];
  const server = createServer(
    createDispatcher({
      routes: [...apiRoutes, staticAssetsRoute(files)],
      logger: createLogger({
        source: "core",
        level: () => "debug",
        write: (record) => records.push(record),
      }),
      // Сессии нет ни у одного запроса: интерфейс обязан загружаться до входа.
      authenticate: () => ({ kind: "none" }),
    }),
  );

  servers.push(server);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  const { port } = server.address() as AddressInfo;

  return (method: string, path: string, body?: string) =>
    new Promise<{
      status: number;
      headers: Record<string, string | string[] | undefined>;
      body: string;
    }>((resolve, reject) => {
      const outgoing = sendRequest(
        {
          host: "127.0.0.1",
          port,
          method,
          path,
          headers: method === "GET" ? {} : { "content-type": "application/json" },
        },
        (incoming) => {
          let text = "";
          incoming.setEncoding("utf8");
          incoming.on("data", (chunk: string) => {
            text += chunk;
          });
          incoming.on("end", () =>
            resolve({ status: incoming.statusCode ?? 0, headers: incoming.headers, body: text }),
          );
        },
      );

      outgoing.on("error", reject);
      outgoing.end(body);
    });
}

const site = payload({
  "index.html": "<!doctype html><div id=root></div>",
  "assets/main-a1b2c3.js": "export const app = 1;",
  "assets/main-a1b2c3.css": ".app{}",
  "assets/onest-cyrillic-400.woff2": "font",
  "favicon.ico": "icon",
});

describe("staticAssetsRoute", () => {
  it("answers the root with the application document and without a session", async () => {
    const call = await serve(site);

    const answer = await call("GET", "/");

    assert.equal(answer.status, 200);
    assert.equal(answer.headers["content-type"], "text/html; charset=utf-8");
    assert.match(answer.body, /id=root/);
  });

  it("gives hashed assets an immutable cache and the document a revalidating one", async () => {
    const call = await serve(site);

    assert.equal(
      (await call("GET", "/assets/main-a1b2c3.js")).headers["cache-control"],
      "public, max-age=31536000, immutable",
    );
    assert.equal((await call("GET", "/")).headers["cache-control"], "no-cache");
  });

  it("names the type of every kind of file the frontend ships", async () => {
    const call = await serve(site);

    assert.equal(
      (await call("GET", "/assets/main-a1b2c3.css")).headers["content-type"],
      "text/css; charset=utf-8",
    );
    assert.equal(
      (await call("GET", "/assets/onest-cyrillic-400.woff2")).headers["content-type"],
      "font/woff2",
    );
    assert.equal(
      (await call("GET", "/favicon.ico")).headers["content-type"],
      "image/vnd.microsoft.icon",
    );
  });

  it("gives an address of the browser router the application, not a refusal", async () => {
    const call = await serve(site);

    for (const path of [
      "/settings/plugins",
      "/sessions/abc",
      "/p/placed/log/entry/7?filter=warn",
    ]) {
      const answer = await call("GET", path);

      assert.equal(answer.status, 200, path);
      assert.match(answer.body, /id=root/, path);
    }
  });

  it("refuses a missing file instead of answering it with the document", async () => {
    const call = await serve(site);

    // Отсутствующий скрипт, отданный как HTML, упал бы разбором в браузере, а не отказом.
    const answer = await call("GET", "/assets/gone-000000.js");

    assert.equal(answer.status, 404);
    assert.equal(answer.headers["content-type"], "application/json");
  });

  it("leaves the addresses of the api and of plugin assets alone", async () => {
    const call = await serve(site);

    assert.deepEqual(JSON.parse((await call("GET", "/api/health")).body), { status: "ok" });

    const unknownApi = await call("GET", "/api/nothing");

    assert.equal(unknownApi.status, 404);
    assert.equal(unknownApi.headers["content-type"], "application/json");

    const asset = await call("GET", "/plugin-assets/data%3Aplaced/rev/browser.js");

    assert.equal(asset.status, 404);
    assert.equal(asset.headers["content-type"], "application/json");
  });

  it("keeps a changing request to an unknown api address a 404, not a 405", async () => {
    const call = await serve(site);

    const answer = await call("POST", "/api/nothing", "{}");

    assert.equal(answer.status, 404);
    assert.equal(answer.headers["allow"], undefined);
    assert.equal((await call("DELETE", "/api/plugins")).status, 405);
  });
});
