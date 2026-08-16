import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, request as sendRequest, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";

import { createProviderCatalogue } from "@sovereign/agent-runtime-pi";
import { emptyEnvironment, scriptedProvider } from "@sovereign/agent-runtime-pi/testing";
import {
  coreEventTypes,
  providerLoginAnswerPath,
  providerLoginPath,
  providerLoginsPath,
  type LoginAttemptState,
  type LoginAttemptsSnapshot,
  type BusEvent,
  type LoginStepFrame,
} from "@sovereign/protocol";

import { createCredentialStore, credentialsFileName } from "./credential-store.ts";
import { createEventBus } from "../platform/public.ts";
import { ensureDataDirectory } from "../platform/public.ts";
import { createDispatcher } from "../http/public.ts";
import { createLogger, type Logger } from "../platform/public.ts";
import {
  carryLoginSteps,
  providerLoginRoutes,
  publishLoginOutcomes,
} from "./provider-login-routes.ts";
import { createProviderLogins } from "./provider-logins.ts";

const workspace = mkdtempSync(join(tmpdir(), "sovereign-provider-login-routes-"));
const servers: Server[] = [];

after(async () => {
  for (const server of servers) {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }

  rmSync(workspace, { recursive: true, force: true });
});

const quietLogger = (): Logger =>
  createLogger({ source: "core", level: () => "debug", write: () => {} });

type Answer = { status: number; body: unknown };

/** Кадры, которые уехали бы в SSE. Сам поток здесь не поднимается: проверяется отбор, а не запись. */
type Emitted = Omit<LoginStepFrame, "index" | "time" | "frame">;

async function serve(options: { contents?: string; questions?: number } = {}) {
  const directory = ensureDataDirectory(mkdtempSync(join(workspace, "case-")));

  if (options.contents !== undefined) {
    writeFileSync(join(directory, credentialsFileName), options.contents);
  }

  const logger = quietLogger();
  const credentials = createCredentialStore({ directory, logger });
  const scripted = scriptedProvider({
    key: "sk-написанный-сценарием",
    script: [
      { say: { type: "auth_url", url: "https://provider/login" } },
      ...Array.from({ length: options.questions ?? 1 }, () => ({
        ask: { type: "secret" as const, message: "ключ" },
      })),
    ],
  });
  const catalogue = createProviderCatalogue({
    // Хранилище то же, что у маршрутов: иначе не видно, куда лёг кред удавшегося входа.
    credentials,
    environment: emptyEnvironment(),
    additionalProviders: [scripted.provider],
  });
  const logins = createProviderLogins({ runner: catalogue, logger });
  const emitted: Emitted[] = [];
  const bus = createEventBus({
    onListenerError: (cause) => {
      throw cause;
    },
  });
  const published: BusEvent[] = [];

  bus.subscribe((event) => published.push(event));
  carryLoginSteps({ logins, events: { emit: (frame) => emitted.push(frame) } });
  publishLoginOutcomes({ logins, bus });

  const server = createServer(
    createDispatcher({
      routes: providerLoginRoutes({ logins, credentials }),
      logger,
      authenticate: () => ({ kind: "session" as const, id: "the-session" }),
    }),
  );

  servers.push(server);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  const { port } = server.address() as AddressInfo;

  const call = (method: string, path: string, body?: unknown): Promise<Answer> =>
    new Promise((resolve, reject) => {
      const outgoing = sendRequest(
        { host: "127.0.0.1", port, method, path, headers: { "content-type": "application/json" } },
        (incoming) => {
          let text = "";

          incoming.setEncoding("utf8");
          incoming.on("data", (chunk: string) => {
            text += chunk;
          });
          incoming.on("end", () =>
            resolve({
              status: incoming.statusCode ?? 0,
              body: text === "" ? undefined : JSON.parse(text),
            }),
          );
        },
      );

      outgoing.on("error", reject);
      outgoing.end(body === undefined ? undefined : JSON.stringify(body));
    });

  /** Ждёт, пока диалог дойдёт до вопроса: рантайм отвечает через микрозадачи. */
  const untilAsked = async (): Promise<LoginAttemptState> => {
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const pending = logins.list()[0];

      if (pending?.pending !== undefined) {
        return pending;
      }

      await new Promise((resolve) => setImmediate(resolve));
    }

    throw new Error("вход не дошёл до вопроса");
  };

  return {
    emitted,
    published,
    logins,
    credentials,
    untilAsked,
    list: () => call("GET", providerLoginsPath),
    start: (body: unknown) => call("POST", providerLoginsPath, body),
    answer: (attemptId: string, body: unknown) =>
      call("POST", providerLoginAnswerPath(attemptId), body),
    cancel: (attemptId: string) => call("DELETE", providerLoginPath(attemptId)),
  };
}

const startBody = { providerId: "scripted", method: "api_key" };

describe("POST /api/provider-logins", () => {
  it("starts a login and carries its steps out as frames", async () => {
    const { start, untilAsked, emitted } = await serve();
    const answer = await start(startBody);

    assert.equal(answer.status, 200);

    const attempt = await untilAsked();

    assert.deepEqual(
      emitted.map((frame) => frame.step.kind),
      ["notice", "prompt"],
    );
    assert.ok(emitted.every((frame) => frame.providerId === "scripted"));
    assert.equal(attempt.pending?.kind, "secret");
  });

  it("refuses a second login into the same provider, naming the one running", async () => {
    const { start, untilAsked } = await serve();

    await start(startBody);

    const running = await untilAsked();
    const second = await start(startBody);

    assert.equal(second.status, 409);
    assert.deepEqual(second.body, {
      error: "a login into scripted is already running",
      conflict: running,
    });
  });

  it("refuses to start at all when the credentials file cannot be written", async () => {
    // Вход кончается записью креда: начинать диалог, который заведомо не сохранит результат,
    // значит тратить время человека.
    const { start } = await serve({ contents: "{ это не json" });
    const answer = await start(startBody);

    assert.equal(answer.status, 409);
  });

  it("refuses a body it cannot read", async () => {
    const { start } = await serve();

    assert.equal((await start({ providerId: "scripted", method: "магия" })).status, 400);
    assert.equal((await start({ method: "api_key" })).status, 400);
    assert.equal((await start({ ...startBody, target: { kind: "магия" } })).status, 400);
  });

  it("refuses a target naming a key the provider does not have", async () => {
    const { start, logins, credentials } = await serve();
    const answer = await start({ ...startBody, target: { kind: "existing", keyId: "key-9" } });

    assert.equal(answer.status, 404);
    // Диалог не начат и на диске ничего не появилось: цель, в которую нечем писать, — не вход.
    assert.deepEqual(logins.list(), []);
    assert.deepEqual(credentials.keys("scripted"), []);
    assert.equal(credentials.problem(), undefined);
  });

  it("puts the credential into the key the body named", async () => {
    const { start, answer, untilAsked, credentials } = await serve();

    await credentials.withKeyTarget("scripted", { kind: "new", label: "личный" }, () =>
      credentials.modify("scripted", async () => ({ type: "api_key", key: "первый" })),
    );

    await start({ ...startBody, target: { kind: "new", label: "рабочий" } });

    const attempt = await untilAsked();

    await answer(attempt.attemptId, {
      stepId: attempt.pending?.stepId,
      value: "sk-от-человека",
    });
    await untilSettled(credentials, "scripted", 2);

    assert.deepEqual(credentials.keys("scripted"), [
      { id: "key-1", label: "личный" },
      { id: "key-2", label: "рабочий" },
    ]);
    // Рабочий ключ не тронут: вход добавил второй, а не переписал первый.
    assert.deepEqual(await credentials.readKey("scripted", "key-1"), {
      type: "api_key",
      key: "первый",
    });
    assert.deepEqual(await credentials.readKey("scripted", "key-2"), {
      type: "api_key",
      key: "sk-написанный-сценарием",
    });
  });
});

/** Ждёт, пока вход допишет кред: маршрут отвечает раньше, чем рантайм доходит до записи. */
async function untilSettled(
  credentials: { keys: (providerId: string) => unknown[] },
  providerId: string,
  count: number,
): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (credentials.keys(providerId).length >= count) {
      return;
    }

    await new Promise((resolve) => setImmediate(resolve));
  }

  throw new Error("вход не дошёл до записи креда");
}

describe("POST /api/provider-logins/:attemptId/answer", () => {
  it("carries the answer to the step that is waiting", async () => {
    const { start, answer, untilAsked, emitted, published } = await serve();

    await start(startBody);

    const attempt = await untilAsked();
    const answered = await answer(attempt.attemptId, {
      stepId: attempt.pending?.stepId,
      value: "sk-от-человека",
    });

    assert.equal(answered.status, 200);

    for (let tick = 0; tick < 50 && emitted.at(-1)?.step.kind !== "conclusion"; tick += 1) {
      await new Promise((resolve) => setImmediate(resolve));
    }

    assert.deepEqual(emitted.at(-1)?.step, {
      kind: "conclusion",
      conclusion: { kind: "succeeded" },
    });
    // Войти может любой включённый плагин, и без события вход, сделанный одним, для остальных
    // выглядит внезапной переменой. core.providers.changed при этом не публикуется: вью,
    // слушающее оба, перезапрашивало бы список дважды на одно действие.
    assert.deepEqual(published, [
      {
        type: coreEventTypes.providerLogin,
        payload: { providerId: "scripted", method: "api_key" },
      },
    ]);
  });

  it("refuses an answer to a step that is no longer waiting", async () => {
    // Два вопроса: после ответа на первый попытка жива, и повторная отправка формы обязана
    // отличаться от ответа на нынешний вопрос.
    const { start, answer, untilAsked } = await serve({ questions: 2 });

    await start(startBody);

    const attempt = await untilAsked();
    const body = { stepId: attempt.pending?.stepId, value: "sk" };

    assert.equal((await answer(attempt.attemptId, body)).status, 200);
    assert.equal((await answer(attempt.attemptId, body)).status, 409);
  });

  it("answers 404 for an attempt nobody started", async () => {
    const { answer } = await serve();

    assert.equal((await answer("выдуманный", { stepId: "s1", value: "x" })).status, 404);
  });
});

describe("GET and DELETE of a login attempt", () => {
  it("shows what is running and takes it back", async () => {
    const { start, list, cancel, untilAsked, emitted, published } = await serve();

    await start(startBody);

    const attempt = await untilAsked();
    const snapshot = (await list()).body as LoginAttemptsSnapshot;

    // Снимок восстанавливает диалог после переподключения: кадр мог уехать в разрыв.
    assert.equal(snapshot.attempts.length, 1);
    assert.deepEqual(snapshot.attempts[0]?.notices, [
      { kind: "auth-url", url: "https://provider/login" },
    ]);
    assert.equal(snapshot.attempts[0]?.answerable, true);

    assert.equal((await cancel(attempt.attemptId)).status, 200);

    for (let tick = 0; tick < 50 && emitted.at(-1)?.step.kind !== "conclusion"; tick += 1) {
      await new Promise((resolve) => setImmediate(resolve));
    }

    assert.deepEqual(emitted.at(-1)?.step, {
      kind: "conclusion",
      conclusion: { kind: "cancelled" },
    });
    assert.deepEqual(((await list()).body as LoginAttemptsSnapshot).attempts, []);
    // Отменённый вход на шину не идёт: там факт о случившемся, а не о несостоявшемся.
    assert.deepEqual(published, []);
  });

  it("answers 404 when there is nothing to cancel", async () => {
    const { cancel } = await serve();

    assert.equal((await cancel("выдуманный")).status, 404);
  });
});

describe("a login a plugin started", () => {
  it("is visible but sends no frame into the stream", async () => {
    const { logins, list, emitted } = await serve();

    logins.start({
      providerId: "scripted",
      method: "api_key",
      origin: "plugin",
      owner: "data:assistant",
    });

    for (let tick = 0; tick < 50 && logins.list()[0]?.pending === undefined; tick += 1) {
      await new Promise((resolve) => setImmediate(resolve));
    }

    const snapshot = (await list()).body as LoginAttemptsSnapshot;

    // Человек видит, что провайдер занят входом плагина, но отвечает на его вопросы плагин:
    // окажись шаги ещё и в потоке, у одного вопроса стало бы два отвечающих.
    assert.equal(snapshot.attempts[0]?.origin, "plugin");
    assert.equal(snapshot.attempts[0]?.answerable, false);
    assert.deepEqual(emitted, []);
  });

  it("cannot be answered or cancelled from a session", async () => {
    const { logins, answer, cancel } = await serve();
    const started = logins.start({
      providerId: "scripted",
      method: "api_key",
      origin: "plugin",
      owner: "data:assistant",
    });

    assert.ok(started.kind === "started");

    for (let tick = 0; tick < 50 && logins.list()[0]?.pending === undefined; tick += 1) {
      await new Promise((resolve) => setImmediate(resolve));
    }

    const attemptId = started.attempt.attemptId;
    const stepId = logins.list()[0]?.pending?.stepId;

    assert.equal((await answer(attemptId, { stepId, value: "чужой" })).status, 409);
    assert.equal((await cancel(attemptId)).status, 404);
  });
});
