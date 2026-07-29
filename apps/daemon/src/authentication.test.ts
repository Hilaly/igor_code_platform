import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, request as sendRequest, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";

import { sessionCookieName, type LogRecord } from "@sovereign/protocol";

import { accountFileName, createAccountStore, type ScryptParameters } from "./account.ts";
import { authenticationRoutes, createSessionCheck } from "./authentication.ts";
import { createDispatcher, respondWithJson, type Route } from "./dispatcher.ts";
import { createLoginSessionStore } from "./login-sessions.ts";
import { createLogger } from "./logger.ts";

/** Дешёвые параметры: стоимость хеша проверяется в account.test.ts, здесь проверяются маршруты. */
const cheapParameters: ScryptParameters = {
  cost: 1_024,
  blockSize: 8,
  parallelization: 1,
  keyLengthBytes: 64,
};

const password = "правильный пароль";

const servers: Server[] = [];
const directories: string[] = [];

after(async () => {
  for (const server of servers) {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }

  for (const directory of directories) {
    rmSync(directory, { recursive: true, force: true });
  }
});

type Answer = {
  status: number;
  setCookie: string[];
  body: Record<string, unknown>;
};

async function serve(options: { directory?: string } = {}) {
  const directory = options.directory ?? mkdtempSync(join(tmpdir(), "sovereign-auth-"));

  if (options.directory === undefined) {
    directories.push(directory);
  }

  const records: LogRecord[] = [];
  const logger = createLogger({
    source: "core",
    level: () => "debug",
    write: (record) => records.push(record),
  });

  const account = createAccountStore({
    directory,
    logger,
    parameters: cheapParameters,
    wait: () => Promise.resolve(),
  });
  const sessions = createLoginSessionStore({ directory, logger });

  // Защищённый маршрут рядом с маршрутами входа: проверка живёт в диспетчере, и без такого соседа
  // не видно, что она вообще применяется.
  const guarded: Route = {
    method: "GET",
    path: "/api/plugins",
    handle: ({ response, session }) => respondWithJson(response, 200, { session }),
  };

  const server = createServer(
    createDispatcher({
      routes: [...authenticationRoutes({ account, sessions, logger }), guarded],
      logger,
      authenticate: createSessionCheck({ sessions, account }),
    }),
  );

  servers.push(server);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  const { port } = server.address() as AddressInfo;

  const call = (
    method: string,
    path: string,
    payload?: { body?: unknown; cookie?: string },
  ): Promise<Answer> =>
    new Promise((resolve, reject) => {
      const text = payload?.body === undefined ? undefined : JSON.stringify(payload.body);
      const outgoing = sendRequest(
        {
          host: "127.0.0.1",
          port,
          method,
          path,
          headers: {
            ...(text === undefined ? {} : { "content-type": "application/json" }),
            ...(payload?.cookie === undefined ? {} : { cookie: payload.cookie }),
          },
        },
        (incoming) => {
          let received = "";
          incoming.setEncoding("utf8");
          incoming.on("data", (chunk: string) => {
            received += chunk;
          });
          incoming.on("end", () =>
            resolve({
              status: incoming.statusCode ?? 0,
              setCookie: incoming.headers["set-cookie"] ?? [],
              body: received === "" ? {} : (JSON.parse(received) as Record<string, unknown>),
            }),
          );
        },
      );

      outgoing.on("error", reject);
      outgoing.end(text);
    });

  /** Cookie из `Set-Cookie` в том виде, в котором её вернёт браузер. */
  const cookieOf = (answer: Answer): string => {
    const header = answer.setCookie.find((value) => value.startsWith(`${sessionCookieName}=`));

    assert.ok(header !== undefined, "the answer carries no session cookie");

    return header.split(";")[0] ?? "";
  };

  return { call, cookieOf, directory, records };
}

describe("the authentication routes", () => {
  it("does not answer on the old path of the login session", async () => {
    const { call } = await serve();

    // Переименование ломающее и обязано быть заметным: молчаливая поддержка обоих путей означала бы
    // два имени у одного состояния входа, и оба пришлось бы держать вечно.
    assert.equal((await call("GET", "/api/session")).status, 404);
  });

  it("asks for a registration while there is no account", async () => {
    const { call } = await serve();

    const answer = await call("GET", "/api/login-session");

    assert.equal(answer.status, 200);
    assert.deepEqual(answer.body, { state: "registration-required" });
  });

  it("refuses a login while there is no account", async () => {
    const { call } = await serve();

    const answer = await call("POST", "/api/login-session", { body: { password } });

    // Отказ отличим от неверного пароля: интерфейс обязан показать форму регистрации, а не ошибку.
    assert.equal(answer.status, 409);
    assert.match(String(answer.body["error"]), /registration/);
  });

  it("creates the account by the first login and opens a session at once", async () => {
    const { call, cookieOf } = await serve();

    const answer = await call("POST", "/api/account", { body: { password } });

    assert.equal(answer.status, 200);
    assert.deepEqual(answer.body, { state: "authenticated" });

    // Вход отдельным запросом стоил бы ещё одного счёта хеша сразу после регистрации.
    assert.match(cookieOf(answer), new RegExp(`^${sessionCookieName}=.+`));
  });

  it("sets the cookie the way the browser has to keep it", async () => {
    const { call } = await serve();

    const [header] = (await call("POST", "/api/account", { body: { password } })).setCookie;

    assert.match(String(header), /HttpOnly/i);
    assert.match(String(header), /SameSite=Strict/i);
    assert.match(String(header), /Path=\//i);

    // Флаг `Secure` не ставится: по `http` браузер такую cookie не отправил бы вовсе
    // (docs/authentication.md).
    assert.doesNotMatch(String(header), /Secure/i);

    // Срок у cookie есть: без него закрытие браузера выкидывало бы из интерфейса при живой сессии.
    assert.match(String(header), /Expires=/i);
  });

  it("refuses a second account", async () => {
    const { call } = await serve();

    await call("POST", "/api/account", { body: { password } });

    const answer = await call("POST", "/api/account", { body: { password: "другой пароль" } });

    assert.equal(answer.status, 409);
    assert.match(String(answer.body["error"]), /already/);
  });

  it("says the session is live only to the request that carries the cookie", async () => {
    const { call, cookieOf } = await serve();

    const cookie = cookieOf(await call("POST", "/api/account", { body: { password } }));

    assert.deepEqual((await call("GET", "/api/login-session", { cookie })).body, {
      state: "authenticated",
    });
    assert.deepEqual((await call("GET", "/api/login-session")).body, { state: "unauthenticated" });
  });

  it("lets the right password in and keeps the wrong one out", async () => {
    const { call, cookieOf } = await serve();

    await call("POST", "/api/account", { body: { password } });

    const accepted = await call("POST", "/api/login-session", { body: { password } });

    assert.equal(accepted.status, 200);
    assert.deepEqual(accepted.body, { state: "authenticated" });
    assert.deepEqual(
      (await call("GET", "/api/login-session", { cookie: cookieOf(accepted) })).body,
      {
        state: "authenticated",
      },
    );

    const refused = await call("POST", "/api/login-session", { body: { password: "мимо кассы" } });

    assert.equal(refused.status, 401);
    assert.deepEqual(refused.setCookie, []);
  });

  it("says the same thing about a wrong password and about a slowed attempt", async () => {
    const { call } = await serve();

    await call("POST", "/api/account", { body: { password } });

    const first = await call("POST", "/api/login-session", { body: { password: "мимо" } });
    const fifth = await (async () => {
      let answer = first;

      for (let attempt = 0; attempt < 4; attempt += 1) {
        answer = await call("POST", "/api/login-session", { body: { password: "мимо" } });
      }

      return answer;
    })();

    // Ответ не различает «пароль неверен» и «ты слишком частишь»: факт торможения виден владельцу в
    // журнале, а не тому, кто стучится (docs/authentication.md).
    assert.deepEqual(first.body, fifth.body);
    assert.equal(first.status, fifth.status);
  });

  it("refuses a body without a password and says what is wrong with it", async () => {
    const { call } = await serve();

    const answer = await call("POST", "/api/account", { body: { pass: password } });

    assert.equal(answer.status, 400);
    assert.match(String(answer.body["error"]), /password/);
  });

  it("refuses to create an account on a password that is too short", async () => {
    const { call } = await serve();

    const answer = await call("POST", "/api/account", { body: { password: "мало" } });

    assert.equal(answer.status, 400);
    assert.deepEqual((await call("GET", "/api/login-session")).body, {
      state: "registration-required",
    });
  });

  it("closes the session on the way out and clears the cookie", async () => {
    const { call, cookieOf } = await serve();

    const cookie = cookieOf(await call("POST", "/api/account", { body: { password } }));
    const answer = await call("DELETE", "/api/login-session", { cookie });

    assert.equal(answer.status, 200);
    assert.deepEqual(answer.body, { state: "unauthenticated" });

    // Cookie гасится ответом, но верить в это нельзя: запись сессии удалена на сервере.
    assert.match(String(answer.setCookie[0]), /Max-Age=0|Expires=Thu, 01 Jan 1970/i);
    assert.deepEqual((await call("GET", "/api/login-session", { cookie })).body, {
      state: "unauthenticated",
    });
    assert.equal((await call("GET", "/api/plugins", { cookie })).status, 401);
  });

  it("guards a route that is not about logging in", async () => {
    const { call, cookieOf } = await serve();

    assert.equal((await call("GET", "/api/plugins")).status, 401);

    const cookie = cookieOf(await call("POST", "/api/account", { body: { password } }));
    const answer = await call("GET", "/api/plugins", { cookie });

    assert.equal(answer.status, 200);
    assert.equal(typeof (answer.body["session"] as { id?: unknown } | undefined)?.id, "string");
  });

  it("ignores a cookie it did not issue", async () => {
    const { call } = await serve();

    await call("POST", "/api/account", { body: { password } });

    const answer = await call("GET", "/api/plugins", {
      cookie: `${sessionCookieName}=a-token-we-never-issued`,
    });

    assert.equal(answer.status, 401);
  });

  it("stops honouring the cookie when the account is gone", async () => {
    const { call, cookieOf, directory } = await serve();

    const cookie = cookieOf(await call("POST", "/api/account", { body: { password } }));

    // Сброс пароля — это удаление `account.json` (docs/data-directory.md). Украденная cookie не имеет
    // права его пережить: сессия подтверждает учётную запись, которой больше нет.
    rmSync(join(directory, accountFileName));

    assert.equal((await call("GET", "/api/plugins", { cookie })).status, 401);
    assert.deepEqual((await call("GET", "/api/login-session", { cookie })).body, {
      state: "registration-required",
    });
  });

  it("revokes the old sessions when the account is created anew", async () => {
    const { call, cookieOf, directory } = await serve();

    const old = cookieOf(await call("POST", "/api/account", { body: { password } }));

    rmSync(join(directory, accountFileName));

    const fresh = cookieOf(await call("POST", "/api/account", { body: { password: "другой" } }));

    // Новый пароль обязан обнулять старые сессии: иначе «сброс» не сбрасывал бы доступ, а только
    // менял бы то, чем его получают заново.
    assert.equal((await call("GET", "/api/plugins", { cookie: old })).status, 401);
    assert.equal((await call("GET", "/api/plugins", { cookie: fresh })).status, 200);
  });

  it("refuses to guess when the account file cannot be read", async () => {
    const { call, directory } = await serve();

    writeFileSync(join(directory, accountFileName), "{ это не json", "utf8");

    const answer = await call("GET", "/api/login-session");

    // Ни «нужна регистрация», ни «войди»: и то и другое — догадка, а починить файл может человек
    // (docs/data-directory.md).
    assert.equal(answer.status, 409);
    assert.match(String(answer.body["error"]), new RegExp(accountFileName));
  });

  it("writes down a login and a logout", async () => {
    const { call, cookieOf, records } = await serve();

    const cookie = cookieOf(await call("POST", "/api/account", { body: { password } }));

    await call("DELETE", "/api/login-session", { cookie });

    const messages = records.map((record) => record.message);

    assert.equal(
      messages.some((message) => message.includes("logged in")),
      true,
    );
    assert.equal(
      messages.some((message) => message.includes("logged out")),
      true,
    );
    assert.equal(JSON.stringify(records).includes(password), false);
  });
});
