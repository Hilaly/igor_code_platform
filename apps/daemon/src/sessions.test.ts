import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { createServer, request as sendRequest, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";

import { scriptedSessionStore, type ScriptedTurn } from "@sovereign/agent-runtime-pi/testing";
import type { AgentSession, AgentSessionStore } from "@sovereign/agent-runtime-pi";
import {
  agentsPath,
  coreEventTypes,
  projectPath,
  sessionEntriesPath,
  sessionPath,
  sessionsPath,
  sessionTurnsPath,
  type AgentContributionRegistration,
  type AgentsSnapshot,
  type BusEvent,
  type ContributionRegistration,
  type SessionEntriesPage,
  type SessionsSnapshot,
} from "@sovereign/protocol";

import { coreToolSource } from "./core-tools.ts";
import { ensureDataDirectory } from "./data-directory.ts";
import { createDispatcher } from "./dispatcher.ts";
import { createEventBus } from "./event-bus.ts";
import { createLogger, type Logger } from "./logger.ts";
import { createProjectStore, type ProjectStore } from "./project-store.ts";
import { createProjectLifecycle } from "./project-lifecycle.ts";
import { projectsRoutes } from "./projects.ts";
import { createSessionService, type SessionDeltaSink } from "./sessions.ts";
import { createToolCollector } from "./tool-collection.ts";
import { createTurnQueue } from "./turn-queue.ts";

const workspace = mkdtempSync(join(tmpdir(), "sovereign-sessions-route-"));
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

const baseAgent: AgentContributionRegistration = {
  kind: "agent",
  id: "base-agent.agent",
  declaredId: "agent",
  pluginKey: "builtin:base-agent",
  pluginId: "base-agent",
  source: "builtin",
  title: "Base agent",
  instructions: "ты двойник",
  tools: { include: ["*"], exclude: [] },
  skills: [],
};

type Answer = { status: number; body: Record<string, unknown> };

function gate() {
  let open = (): void => undefined;
  let entered = (): void => undefined;
  const wait = new Promise<void>((resolve) => {
    open = resolve;
  });
  const entry = new Promise<void>((resolve) => {
    entered = resolve;
  });

  return { wait, entry, open, entered };
}

async function serve(
  options: {
    turns?: ScriptedTurn[];
    contributions?: ContributionRegistration[] | (() => ContributionRegistration[]);
    limit?: number;
    modelChangeGate?: ReturnType<typeof gate>;
    openGate?: ReturnType<typeof gate>;
    createGate?: ReturnType<typeof gate>;
    coldSession?: boolean;
  } = {},
) {
  const directory = ensureDataDirectory(mkdtempSync(join(workspace, "case-")));
  const folder = mkdtempSync(join(workspace, "project-"));
  const logger = quietLogger();
  const projects: ProjectStore = createProjectStore({ directory, logger });
  const created = projects.create({ name: "Demo", folder, folderKey: folder });

  assert.equal(created.kind, "created");

  const projectId = created.kind === "created" ? created.project.id : "";
  const {
    store: sessionStore,
    model,
    removeModel,
    restoreModel,
  } = scriptedSessionStore({
    directory: join(directory, "sessions"),
    turns: options.turns ?? [{ text: "готово" }],
  });
  const coldSession =
    options.coldSession === true
      ? await sessionStore.create({
          projectId,
          agentId: baseAgent.id,
          folder,
          folderKey: folder,
          model,
          thinkingLevel: "off",
          agent: { id: baseAgent.id, instructions: baseAgent.instructions },
        })
      : undefined;
  const coldSessionId =
    coldSession === undefined || "kind" in coldSession ? undefined : coldSession.summary().id;

  if (coldSession !== undefined && !("kind" in coldSession)) {
    await coldSession.close();
  }

  let openCalls = 0;
  const delayModelChange = (session: AgentSession): AgentSession => ({
    ...session,
    setModel: async (reference) => {
      options.modelChangeGate?.entered();
      await options.modelChangeGate?.wait;

      return session.setModel(reference);
    },
  });
  const store: AgentSessionStore =
    options.modelChangeGate === undefined &&
    options.openGate === undefined &&
    options.createGate === undefined
      ? sessionStore
      : {
          ...sessionStore,
          create: async (input) => {
            options.createGate?.entered();
            await options.createGate?.wait;
            const createdSession = await sessionStore.create(input);

            return "kind" in createdSession ? createdSession : delayModelChange(createdSession);
          },
          open: async (id) => {
            openCalls += 1;
            options.openGate?.entered();
            await options.openGate?.wait;
            const openedSession = await sessionStore.open(id);

            if (openedSession === undefined || options.modelChangeGate === undefined) {
              return openedSession;
            }

            return {
              ...openedSession,
              activate: (agent) => {
                const activated = openedSession.activate(agent);

                return "kind" in activated ? activated : delayModelChange(activated);
              },
            };
          },
        };
  const bus = createEventBus({
    onListenerError: (cause) => {
      throw cause;
    },
  });
  const events: BusEvent[] = [];
  const projectLifecycle = createProjectLifecycle();

  bus.subscribe((event) => events.push(event));

  const deltas: Parameters<SessionDeltaSink>[0][] = [];
  const collector = createToolCollector();

  collector.register(coreToolSource());

  const service = createSessionService({
    store,
    projects,
    contributions: () =>
      typeof options.contributions === "function"
        ? options.contributions()
        : (options.contributions ?? [baseAgent]),
    tools: collector,
    queue: createTurnQueue({ limit: () => options.limit ?? 4 }),
    bus,
    emitDelta: (frame) => deltas.push(frame),
    logger,
    availability: () => "available",
    projectLifecycle,
  });

  await service.refresh();

  const server = createServer(
    createDispatcher({
      routes: [
        ...projectsRoutes({
          projects,
          logger,
          availability: () => "available",
          sessionCount: (folderKey) => service.countByFolderKey(folderKey),
          projectLifecycle,
        }),
        ...service.routes(),
      ],
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
              body: text === "" ? {} : (JSON.parse(text) as Record<string, unknown>),
            }),
          );
        },
      );

      outgoing.on("error", reject);
      outgoing.end(body === undefined ? undefined : JSON.stringify(body));
    });

  return {
    call,
    service,
    projects,
    events,
    deltas,
    folder,
    projectId,
    model,
    removeModel,
    restoreModel,
    coldSessionId,
    openCalls: () => openCalls,
    directory,
    start: async (body?: Record<string, unknown>) =>
      call("POST", sessionsPath, { projectId, agentId: baseAgent.id, model, ...body }),
    removeProject: () => call("DELETE", projectPath(projectId)),
  };
}

/** Дождаться, пока сессия вернётся в простой: турн идёт своим порядком, а не по возврату маршрута. */
async function untilIdle(
  call: (method: string, path: string) => Promise<Answer>,
  sessionId: string,
): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const answer = await call("GET", sessionPath(sessionId));

    if (answer.body["phase"] === "idle") {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 5));
  }

  throw new Error("сессия так и не вернулась в простой");
}

describe("GET /api/agents", () => {
  it("answers with the enabled agents", async () => {
    const { call } = await serve();

    const answer = await call("GET", agentsPath);
    const snapshot = answer.body as unknown as AgentsSnapshot;

    assert.equal(answer.status, 200);
    assert.deepEqual(
      snapshot.agents.map((agent) => [agent.id, agent.source, agent.skills]),
      [["base-agent.agent", "builtin", []]],
    );
  });

  it("answers with nothing when every plugin with an agent is off", async () => {
    const { call } = await serve({ contributions: [] });

    // Ноль агентов — законный ответ, а не отказ (docs/sessions-and-projects.md).
    assert.deepEqual((await call("GET", agentsPath)).body, { agents: [] });
  });
});

describe("POST /api/sessions", () => {
  it("creates a session and tells the bus", async () => {
    const { start, events, folder, projectId } = await serve();

    const answer = await start();

    assert.equal(answer.status, 200);
    assert.equal(answer.body["projectId"], projectId);
    assert.equal(answer.body["folder"], folder);
    assert.equal(answer.body["phase"], "idle");
    assert.ok(
      events.some((event) => event.type === coreEventTypes.sessionsChanged),
      "создание сессии обязано быть видно тому, кто её не создавал",
    );
  });

  it("refuses an agent nobody enabled", async () => {
    const { call, projectId, model } = await serve();

    const answer = await call("POST", sessionsPath, {
      projectId,
      agentId: "нет.такого",
      model,
    });

    assert.equal(answer.status, 409);
    assert.match(String(answer.body["error"]), /no agent/);
  });

  it("refuses a project nobody created", async () => {
    const { call, model } = await serve();

    assert.equal(
      (await call("POST", sessionsPath, { projectId: "выдуманный", agentId: baseAgent.id, model }))
        .status,
      404,
    );
  });

  it("asks for a model when the agent names no default", async () => {
    const { call, projectId } = await serve();

    const answer = await call("POST", sessionsPath, { projectId, agentId: baseAgent.id });

    assert.equal(answer.status, 409);
    assert.match(String(answer.body["error"]), /model/);
  });

  it("refuses a model that is not in the catalogue", async () => {
    const { call, projectId } = await serve();

    const answer = await call("POST", sessionsPath, {
      projectId,
      agentId: baseAgent.id,
      model: "выдуманный/провайдер",
    });

    assert.equal(answer.status, 409);
    assert.match(String(answer.body["error"]), /not available/);
  });
});

describe("running a turn over http", () => {
  it("runs the turn, streams it and writes the file the agent asked for", async () => {
    const { call, start, deltas, folder } = await serve({
      turns: [
        {
          // Путь относительный: папку задаёт среда исполнения сессии, и именно это здесь и
          // проверяется — агент работает в папке проекта, а не там, где запущен демон.
          toolCalls: [
            { id: "c1", name: "write", arguments: { path: "hello.txt", content: "привет" } },
          ],
        },
        { text: "готово" },
      ],
    });
    const sessionId = String((await start()).body["id"]);

    const accepted = await call("POST", sessionTurnsPath(sessionId), { text: "создай файл" });

    assert.equal(accepted.status, 200);
    assert.equal(accepted.body["phase"], "turn");
    assert.match(String(accepted.body["turnId"]), /turn-/);

    await untilIdle(call, sessionId);

    assert.deepEqual(
      deltas
        .map((frame) => frame.delta)
        .filter((delta) => delta.kind === "phase")
        .map((delta) => delta.phase),
      ["turn", "idle"],
    );
    assert.ok(
      deltas.every((frame) => frame.turnId !== ""),
      "дельта без идентификатора турна не склеивается с ответом на запуск",
    );

    // Приёмка среза: файл в папке проекта изменён агентом.
    assert.equal(readFileSync(join(folder, "hello.txt"), "utf8"), "привет");
  });

  it("refuses a second turn while the first one runs", async () => {
    const { call, start } = await serve({ turns: [{ text: "первый" }, { text: "второй" }] });
    const sessionId = String((await start()).body["id"]);

    const first = call("POST", sessionTurnsPath(sessionId), { text: "первый" });
    const second = await call("POST", sessionTurnsPath(sessionId), { text: "второй" });

    assert.equal(second.status, 409);
    assert.match(String(second.body["error"]), /busy/);
    await first;
    await untilIdle(call, sessionId);
  });

  it("admits only one concurrent overridden turn", async () => {
    const modelChangeGate = gate();
    const { call, start, model } = await serve({
      turns: [{ text: "первый" }],
      modelChangeGate,
    });
    const sessionId = String((await start()).body["id"]);

    const accepted = call("POST", sessionTurnsPath(sessionId), {
      text: "первый",
      model,
      thinkingLevel: "high",
    });
    await modelChangeGate.entry;
    const refused = await call("POST", sessionTurnsPath(sessionId), {
      text: "второй",
      model,
      thinkingLevel: "low",
    });
    modelChangeGate.open();

    assert.equal((await accepted).status, 200);
    assert.equal(refused.status, 409);
    assert.match(String(refused.body["error"]), /busy/);
    assert.equal((await call("GET", sessionPath(sessionId))).body["thinkingLevel"], "high");

    await untilIdle(call, sessionId);
  });

  it("opens a cold session once for concurrent turns", async () => {
    const openGate = gate();
    const { call, coldSessionId, openCalls } = await serve({
      turns: [{ text: "первый" }],
      coldSession: true,
      openGate,
    });

    assert.ok(coldSessionId);

    const first = call("POST", sessionTurnsPath(coldSessionId), {
      text: "первый",
      thinkingLevel: "high",
    });
    const second = call("POST", sessionTurnsPath(coldSessionId), {
      text: "второй",
      thinkingLevel: "low",
    });

    await openGate.entry;
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(openCalls(), 1);
    openGate.open();

    assert.deepEqual(
      (await Promise.all([first, second])).map((answer) => answer.status),
      [200, 409],
    );
    assert.equal(openCalls(), 1);
    assert.equal((await call("GET", sessionPath(coldSessionId))).body["thinkingLevel"], "high");
    await untilIdle(call, coldSessionId);
  });

  it("refuses a cold session archived while its harness opens", async () => {
    const openGate = gate();
    const { call, coldSessionId, projectId, projects } = await serve({
      turns: [{ text: "не должно исполниться" }],
      coldSession: true,
      openGate,
    });

    assert.ok(coldSessionId);

    const prompt = call("POST", sessionTurnsPath(coldSessionId), { text: "продолжи" });

    await openGate.entry;
    assert.equal(projects.update(projectId, { name: "Demo", archived: true }).kind, "updated");
    openGate.open();

    const refused = await prompt;
    assert.equal(projects.update(projectId, { name: "Demo", archived: false }).kind, "updated");
    const page = (await call("GET", sessionEntriesPath(coldSessionId)))
      .body as unknown as SessionEntriesPage;

    assert.equal(refused.status, 409);
    assert.match(String(refused.body["error"]), /archived/);
    assert.equal(page.entries.filter((entry) => entry.kind === "message").length, 0);
  });

  it("refuses an unavailable model promptly while the global queue is saturated", async () => {
    const { call, start } = await serve({ limit: 0 });
    const sessionId = String((await start()).body["id"]);

    const answer = await call("POST", sessionTurnsPath(sessionId), {
      text: "скажи",
      model: "missing/model",
    });

    assert.equal(answer.status, 409);
    assert.match(String(answer.body["error"]), /not available/);
  });

  it("refuses a live session whose current model disappeared and lets it retry", async () => {
    const { call, start, model, removeModel, restoreModel } = await serve({
      turns: [{ text: "после возврата" }],
    });
    const sessionId = String((await start()).body["id"]);
    const before = (await call("GET", sessionEntriesPath(sessionId)))
      .body as unknown as SessionEntriesPage;

    removeModel();

    const refused = await call("POST", sessionTurnsPath(sessionId), { text: "пока модели нет" });
    const afterRefusal = (await call("GET", sessionEntriesPath(sessionId)))
      .body as unknown as SessionEntriesPage;

    assert.equal(refused.status, 409);
    assert.match(String(refused.body["error"]), new RegExp(model.replace("/", "\\/")));
    assert.deepEqual(afterRefusal.entries, before.entries);

    restoreModel();

    assert.equal(
      (await call("POST", sessionTurnsPath(sessionId), { text: "после возврата" })).status,
      200,
    );
    await untilIdle(call, sessionId);

    const afterRetry = (await call("GET", sessionEntriesPath(sessionId)))
      .body as unknown as SessionEntriesPage;

    assert.equal(afterRetry.entries.filter((entry) => entry.kind === "message").length, 2);
  });

  it("keeps a cancelled validation admitted until it has deterministically refused", async () => {
    const modelChangeGate = gate();
    const { call, start, model, deltas } = await serve({
      turns: [{ text: "после отмены" }],
      modelChangeGate,
    });
    const sessionId = String((await start()).body["id"]);
    const pendingValidation = call("POST", sessionTurnsPath(sessionId), {
      text: "отмени",
      model,
      thinkingLevel: "high",
    });

    await modelChangeGate.entry;
    assert.deepEqual((await call("DELETE", sessionTurnsPath(sessionId))).body, {
      sessionId,
      interrupted: true,
    });

    const retryDuringCancellation = await call("POST", sessionTurnsPath(sessionId), {
      text: "слишком рано",
    });

    assert.equal(retryDuringCancellation.status, 409);
    assert.match(String(retryDuringCancellation.body["error"]), /busy/);

    modelChangeGate.open();
    assert.equal((await pendingValidation).status, 409);
    assert.equal((await call("GET", sessionPath(sessionId))).body["phase"], "idle");
    const entriesAfterCancellation = (await call("GET", sessionEntriesPath(sessionId)))
      .body as unknown as SessionEntriesPage;

    assert.ok(
      entriesAfterCancellation.entries.every(
        (entry) => entry.kind !== "message" && entry.kind !== "tools-change",
      ),
      "cancelled validation must not persist or run a turn",
    );
    assert.ok(
      deltas.filter((frame) => frame.sessionId === sessionId).every((frame) => frame.turnId !== ""),
      "validation deltas must retain their reserved turn id until cancellation unwinds",
    );

    assert.equal(
      (await call("POST", sessionTurnsPath(sessionId), { text: "после отмены" })).status,
      200,
    );
    await untilIdle(call, sessionId);
  });

  it("refuses a turn without text", async () => {
    const { call, start } = await serve();
    const sessionId = String((await start()).body["id"]);

    assert.equal((await call("POST", sessionTurnsPath(sessionId), { text: "  " })).status, 400);
  });

  it("answers 404 on a session identifier that could leave the folder", async () => {
    const { call } = await serve();

    assert.equal((await call("POST", `${sessionsPath}/..%2Fetc/turns`, { text: "и" })).status, 404);
  });

  it("says there was nothing to interrupt in an idle session", async () => {
    const { call, start } = await serve();
    const sessionId = String((await start()).body["id"]);

    const answer = await call("DELETE", sessionTurnsPath(sessionId));

    assert.equal(answer.status, 200);
    assert.deepEqual(answer.body, { sessionId, interrupted: false });
  });

  it("waits in the queue when the limit is spent, and says so", async () => {
    const { call, start } = await serve({
      limit: 1,
      turns: [{ text: "первый" }, { text: "второй" }],
    });
    const first = String((await start()).body["id"]);
    const second = String((await start()).body["id"]);

    const running = call("POST", sessionTurnsPath(first), { text: "первый" });
    const queued = await call("POST", sessionTurnsPath(second), { text: "второй" });

    // Турн принят, но ещё не начат — это отдельное состояние, а не «работает» (docs/architecture.md).
    assert.equal(queued.status, 200);
    assert.equal(queued.body["phase"], "queued");

    await running;
    await untilIdle(call, first);
    await untilIdle(call, second);
  });

  it("takes a queued turn out of the queue on interruption", async () => {
    const { call, start } = await serve({
      limit: 1,
      turns: [{ text: "первый" }, { text: "второй" }],
    });
    const first = String((await start()).body["id"]);
    const second = String((await start()).body["id"]);

    const running = call("POST", sessionTurnsPath(first), { text: "первый" });

    await call("POST", sessionTurnsPath(second), { text: "второй" });

    assert.deepEqual((await call("DELETE", sessionTurnsPath(second))).body, {
      sessionId: second,
      interrupted: true,
    });

    await running;
    await untilIdle(call, first);
    assert.equal((await call("GET", sessionPath(second))).body["phase"], "idle");
  });
});

describe("reading sessions", () => {
  it("shows turn overrides in summaries without waiting for a refresh", async () => {
    const { call, start, model } = await serve({ turns: [{ text: "готово" }] });
    const sessionId = String((await start()).body["id"]);

    const started = await call("POST", sessionTurnsPath(sessionId), {
      text: "скажи",
      model,
      thinkingLevel: "high",
    });

    assert.equal(started.status, 200);
    assert.equal(
      ((await call("GET", sessionsPath)).body as unknown as SessionsSnapshot).sessions[0]
        ?.thinkingLevel,
      "high",
    );
    assert.equal((await call("GET", sessionPath(sessionId))).body["thinkingLevel"], "high");

    await untilIdle(call, sessionId);
  });

  it("lists the sessions and filters them by project", async () => {
    const { call, start, projectId } = await serve();

    await start();

    const listed = (await call("GET", sessionsPath)).body as unknown as SessionsSnapshot;

    assert.equal(listed.sessions.length, 1);
    assert.deepEqual(
      (
        (await call("GET", `${sessionsPath}?projectId=${encodeURIComponent("чужой")}`))
          .body as unknown as SessionsSnapshot
      ).sessions,
      [],
    );
    assert.equal(
      (
        (await call("GET", `${sessionsPath}?projectId=${projectId}`))
          .body as unknown as SessionsSnapshot
      ).sessions.length,
      1,
    );
  });

  it("hides sessions of archived projects and shows them again after restore", async () => {
    const { call, start, projectId, projects } = await serve();
    const sessionId = String((await start()).body["id"]);

    const archived = projects.update(projectId, { name: "Demo", archived: true });
    assert.equal(archived.kind, "updated");

    assert.deepEqual(
      ((await call("GET", sessionsPath)).body as unknown as SessionsSnapshot).sessions,
      [],
    );
    assert.equal((await call("GET", sessionEntriesPath(sessionId))).status, 404);
    assert.equal(
      (await call("POST", sessionTurnsPath(sessionId), { text: "продолжи" })).status,
      404,
    );

    const restored = projects.update(projectId, { name: "Demo", archived: false });
    assert.equal(restored.kind, "updated");

    assert.equal(
      ((await call("GET", sessionsPath)).body as unknown as SessionsSnapshot).sessions.length,
      1,
    );
  });

  it("answers with the entries of the tree behind a cursor", async () => {
    const { call, start } = await serve();
    const sessionId = String((await start()).body["id"]);

    await call("POST", sessionTurnsPath(sessionId), { text: "скажи" });
    await untilIdle(call, sessionId);

    const page = (await call("GET", sessionEntriesPath(sessionId)))
      .body as unknown as SessionEntriesPage;

    assert.deepEqual(
      page.entries.map((entry) => entry.kind),
      ["model-change", "thinking-level-change", "tools-change", "message", "message"],
    );

    const rest = (await call("GET", `${sessionEntriesPath(sessionId)}?after=${String(page.seen)}`))
      .body as unknown as SessionEntriesPage;

    assert.deepEqual(rest.entries, []);
    assert.equal(rest.seen, page.seen);
  });

  it("keeps persisted entries readable when the agent is gone", async () => {
    let contributions: ContributionRegistration[] = [];
    const { call, coldSessionId } = await serve({
      coldSession: true,
      contributions: () => contributions,
    });

    assert.ok(coldSessionId);
    assert.equal((await call("GET", sessionsPath)).status, 200);

    const page = await call("GET", sessionEntriesPath(coldSessionId));

    assert.equal(page.status, 200);
    assert.deepEqual(
      (page.body as unknown as SessionEntriesPage).entries.map((entry) => entry.kind),
      ["model-change", "thinking-level-change"],
    );

    const prompt = await call("POST", sessionTurnsPath(coldSessionId), { text: "продолжи" });

    assert.equal(prompt.status, 409);
    assert.match(String(prompt.body["error"]), new RegExp(baseAgent.id));

    contributions = [baseAgent];
    assert.equal(
      (await call("POST", sessionTurnsPath(coldSessionId), { text: "продолжи" })).status,
      200,
    );
    await untilIdle(call, coldSessionId);
  });

  it("answers 404 for a session nobody created", async () => {
    const { call } = await serve();

    assert.equal((await call("GET", sessionPath("невидимка"))).status, 404);
  });

  it("counts the sessions of a project by the folder", async () => {
    const { start, service, folder } = await serve();

    await start();
    await start();
    await service.refresh();

    assert.equal(service.countByFolderKey(folder), 2);
    assert.equal(service.countByFolderKey("/чужая/папка"), 0);
  });

  it("keeps the records where the data directory says they belong", async () => {
    const { start, directory } = await serve();
    const sessionId = String((await start()).body["id"]);
    const found = findSessionFile(join(directory, "sessions"), sessionId);

    assert.ok(found !== undefined, "запись сессии обязана лежать в директории данных");

    const header = JSON.parse(readFileSync(found, "utf8").split("\n")[0] ?? "{}") as {
      type?: string;
      metadata?: Record<string, unknown>;
    };

    assert.equal(header.type, "session");
    assert.equal(header.metadata?.["agentId"], baseAgent.id);
  });
});

describe("project and session lifecycle", () => {
  it("keeps a project when session creation overlaps its removal", async () => {
    const createGate = gate();
    const { call, start, removeProject, projectId } = await serve({ createGate });

    const creating = start();

    await createGate.entry;
    const removing = removeProject();
    await new Promise((resolve) => setImmediate(resolve));
    createGate.open();

    const [created, refusedRemoval] = await Promise.all([creating, removing]);

    assert.equal(created.status, 200);
    assert.equal(refusedRemoval.status, 409);
    assert.match(String(refusedRemoval.body["error"]), /session/);
    assert.equal((await call("GET", sessionsPath)).status, 200);
    assert.equal(projectsStillContain(await call("GET", "/api/projects"), projectId), true);
  });
});

function projectsStillContain(answer: Answer, projectId: string): boolean {
  const body = answer.body as {
    projects?: { id: string }[];
    archived?: { id: string }[];
  };

  return [...(body.projects ?? []), ...(body.archived ?? [])].some(
    (project) => project.id === projectId,
  );
}

function findSessionFile(root: string, sessionId: string): string | undefined {
  for (const entry of readdirSync(root)) {
    const path = join(root, entry);

    if (statSync(path).isDirectory()) {
      const found = findSessionFile(path, sessionId);

      if (found !== undefined) {
        return found;
      }

      continue;
    }

    if (entry.includes(sessionId)) {
      return path;
    }
  }

  return undefined;
}
