import assert from "node:assert/strict";
import { once } from "node:events";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createServer, request as sendRequest, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";

import { scriptedSessionStore, type ScriptedTurn } from "@sovereign/agent-runtime-pi/testing";
import { createPluginTool } from "@sovereign/agent-runtime-pi";
import type {
  AgentDefinition,
  AgentSession,
  AgentSessionStore,
  AgentSkill,
} from "@sovereign/agent-runtime-pi";
import {
  agentsPath,
  coreEventTypes,
  foldEntryLabels,
  projectPath,
  projectsPath,
  sessionBranchPath,
  sessionCommandsPath,
  sessionCompactPath,
  sessionContextPath,
  sessionEntriesPath,
  sessionEntryLabelPath,
  sessionForkPath,
  sessionMessagesPath,
  sessionNavigatePath,
  sessionPath,
  sessionQueuedMessagePath,
  sessionQueuePath,
  sessionsPath,
  sessionStatsPath,
  sessionTurnsPath,
  type AgentContributionRegistration,
  type AgentsSnapshot,
  type BusEvent,
  type ContributionRegistration,
  type HookRefusal,
  type SessionBranch,
  type SessionContextUsage,
  type SessionEntriesPage,
  type SessionEntry,
  type SessionNavigated,
  type SessionOutbox,
  type SessionsSnapshot,
  type SessionStats,
} from "@sovereign/protocol";

import { coreToolSource } from "./core-tools.ts";
import type { HookAudience, HookDispatcher } from "./hook-dispatch.ts";
import { ensureDataDirectory } from "../platform/public.ts";
import { createDispatcher } from "../http/public.ts";
import { createEventBus } from "../platform/public.ts";
import { createLogger, type Logger } from "../platform/public.ts";
import { createProjectStore, type ProjectStore } from "../projects/public.ts";
import { createProjectLifecycle } from "../projects/public.ts";
import { projectsRoutes } from "../projects/public.ts";
import type { ImageLimits } from "./image-limits.ts";
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
  ownership: "plugin",
  id: "starter.generic",
  declaredId: "generic",
  pluginKey: "builtin:starter",
  pluginId: "starter",
  source: "builtin",
  title: "Generic",
  instructions: "ты двойник",
  tools: { include: ["*"], exclude: [] },
  skills: { include: [], exclude: [] },
};

const skill = (
  id: string,
  overrides: Partial<
    Pick<
      Extract<ContributionRegistration, { kind: "skill" }>,
      | "description"
      | "location"
      | "license"
      | "compatibility"
      | "metadata"
      | "allowedTools"
      | "disableModelInvocation"
    >
  > = {},
): Extract<ContributionRegistration, { kind: "skill" }> => ({
  kind: "skill",
  ownership: "standalone",
  id,
  declaredId: id,
  source: "sovereign",
  scope: "user",
  name: id,
  description: `${id} description`,
  location: `/skills/${id}/SKILL.md`,
  disableModelInvocation: false,
  ...overrides,
});

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
    contributions?: {
      base: () => ContributionRegistration[];
      forProject: (projectId: string) => ContributionRegistration[];
    };
    limit?: number;
    modelChangeGate?: ReturnType<typeof gate>;
    openGate?: ReturnType<typeof gate>;
    createGate?: ReturnType<typeof gate>;
    operationGate?: ReturnType<typeof gate> | (() => ReturnType<typeof gate> | undefined);
    /** Останавливает турн внутри инструмента `hold`, то есть в настоящей фазе `turn`. */
    toolGate?: ReturnType<typeof gate>;
    coldSession?: boolean;
    compactionThreshold?: number;
    imageLimits?: ImageLimits;
    commandsDirectory?: string;
    /** Что двойник модели принимает на вход. По умолчанию только текст. */
    input?: ("text" | "image")[];
    hooks?: Pick<HookDispatcher, "observe" | "decide">;
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
    contextWindow,
    removeModel,
    restoreModel,
  } = scriptedSessionStore({
    directory: join(directory, "sessions"),
    archivedDirectory: join(directory, "sessions-archived"),
    turns: options.turns ?? [{ text: "готово" }],
    ...(options.input === undefined ? {} : { input: options.input }),
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
  const initialAgentDefinitions: AgentDefinition[] = [];
  const appliedInstructions: string[] = [];
  const appliedAgentDirectories: (string | undefined)[] = [];
  const appliedSkills: AgentSkill[][] = [];
  const appliedToolNames: string[][] = [];
  const harnessCalls: string[] = [];
  const toolContexts: unknown[] = [];
  const operationGate = (): ReturnType<typeof gate> | undefined =>
    typeof options.operationGate === "function" ? options.operationGate() : options.operationGate;
  const waitForOperation = async (): Promise<void> => {
    const current = operationGate();

    current?.entered();
    await current?.wait;
  };
  const observeSession = (session: AgentSession): AgentSession => ({
    ...session,
    setInstructions: (instructions) => {
      harnessCalls.push("set-instructions");
      appliedInstructions.push(instructions);
      session.setInstructions(instructions);
    },
    setAgentDirectory: (directory) => {
      harnessCalls.push("set-agent-directory");
      appliedAgentDirectories.push(directory);
      session.setAgentDirectory(directory);
    },
    setSkills: (skills) => {
      harnessCalls.push("set-skills");
      appliedSkills.push(skills);
      session.setSkills(skills);
    },
    setTools: async (tools, activeToolNames) => {
      harnessCalls.push("set-tools");
      appliedToolNames.push(activeToolNames);
      await session.setTools(tools, activeToolNames);
    },
    message: async (text, mode, images) => {
      harnessCalls.push(`message:${mode}`);

      return session.message(text, mode, images);
    },
    ...(options.operationGate === undefined
      ? {}
      : {
          prompt: async (...given: Parameters<AgentSession["prompt"]>) => {
            harnessCalls.push("prompt");
            await waitForOperation();

            return session.prompt(...given);
          },
          compact: async (instructions?: string) => {
            harnessCalls.push("compact");
            await waitForOperation();

            return session.compact(instructions);
          },
          navigate: async (request: Parameters<AgentSession["navigate"]>[0]) => {
            harnessCalls.push("navigate");
            await waitForOperation();

            return session.navigate(request);
          },
        }),
  });
  const delayModelChange = (session: AgentSession): AgentSession => ({
    ...observeSession(session),
    setModel: async (reference) => {
      options.modelChangeGate?.entered();
      await options.modelChangeGate?.wait;

      return session.setModel(reference);
    },
  });
  const decorate = (session: AgentSession): AgentSession =>
    options.modelChangeGate === undefined ? observeSession(session) : delayModelChange(session);
  const store: AgentSessionStore = {
    ...sessionStore,
    create: async (input) => {
      initialAgentDefinitions.push({ ...input.agent });
      options.createGate?.entered();
      await options.createGate?.wait;
      const createdSession = await sessionStore.create(input);

      return "kind" in createdSession ? createdSession : decorate(createdSession);
    },
    open: async (id) => {
      openCalls += 1;
      options.openGate?.entered();
      await options.openGate?.wait;
      const openedSession = await sessionStore.open(id);

      if (openedSession === undefined) {
        return openedSession;
      }

      return {
        ...openedSession,
        activate: (agent) => {
          initialAgentDefinitions.push({ ...agent });
          const activated = openedSession.activate(agent);

          return "kind" in activated ? activated : decorate(activated);
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
  collector.register({
    id: "context-recorder",
    collect: (context) => {
      toolContexts.push(context);
      return [];
    },
  });

  // Инструмент, останавливающий турн внутри себя. Единственный способ подержать сессию именно в
  // фазе `turn`: `operationGate` держит вызывающего до того, как рантайм начал турн, а стиринг
  // требует турна идущего.
  if (options.toolGate !== undefined) {
    const toolGate = options.toolGate;

    collector.register({
      id: "holding-tool",
      collect: () => [
        {
          name: "hold",
          group: "plugin",
          order: 10,
          tool: createPluginTool({
            name: "hold",
            description: "Ждать, пока тест не отпустит",
            parameters: { type: "object", properties: {} },
            invoke: async () => {
              toolGate.entered();
              await toolGate.wait;

              return { content: "отпущено", isError: false };
            },
          }).tool,
        },
      ],
    });
  }

  const defaultContributions = {
    base: () => [baseAgent],
    forProject: () => [baseAgent],
  };

  const service = createSessionService({
    store,
    projects,
    contributions: options.contributions ?? defaultContributions,
    tools: collector,
    queue: createTurnQueue({ limit: () => options.limit ?? 4 }),
    ...(options.imageLimits === undefined
      ? {}
      : { imageLimits: () => options.imageLimits as ImageLimits }),
    ...(options.commandsDirectory === undefined
      ? {}
      : { commandsDirectory: options.commandsDirectory }),
    bus,
    emitDelta: (frame) => deltas.push(frame),
    logger,
    availability: () => "available",
    projectLifecycle,
    compactionThreshold: () => options.compactionThreshold ?? 0,
    ...(options.hooks === undefined ? {} : { hooks: options.hooks }),
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
    contextWindow,
    removeModel,
    restoreModel,
    coldSessionId,
    openCalls: () => openCalls,
    directory,
    initialAgentDefinitions,
    appliedInstructions,
    appliedAgentDirectories,
    appliedSkills,
    appliedToolNames,
    harnessCalls,
    toolContexts,
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

async function untilQueued(
  call: (method: string, path: string) => Promise<Answer>,
  sessionId: string,
): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const answer = await call("GET", sessionPath(sessionId));

    if (answer.body["phase"] === "queued") {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 5));
  }

  throw new Error("сессия так и не встала в очередь");
}

/**
 * Дождаться, пока названный текст доедет до дерева. Именно по дереву, а не по опустевшей очереди:
 * из очереди сообщение уходит раньше, чем начинается его турн.
 */
async function untilSaid(
  call: (method: string, path: string) => Promise<Answer>,
  sessionId: string,
  said: string,
): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const page = (await call("GET", sessionEntriesPath(sessionId)))
      .body as unknown as SessionEntriesPage;

    if (JSON.stringify(page.entries).includes(said)) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 5));
  }

  throw new Error(`сообщение «${said}» так и не доехало до дерева`);
}

/** Дождаться остановки очереди: она случается в `finally` турна, то есть после его конца. */
async function untilStopped(
  call: (method: string, path: string) => Promise<Answer>,
  sessionId: string,
): Promise<SessionOutbox> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const waiting = (await call("GET", sessionQueuePath(sessionId)))
      .body as unknown as SessionOutbox;

    if (waiting.stopped !== undefined) {
      return waiting;
    }

    await new Promise((resolve) => setTimeout(resolve, 5));
  }

  throw new Error("очередь так и не остановилась");
}

function saidByUser(page: SessionEntriesPage): string[] {
  return page.entries
    .filter((entry) => entry.kind === "message" && entry.role === "user")
    .map((entry) => JSON.stringify(entry.kind === "message" ? entry.content : []));
}

describe("GET /api/agents", () => {
  it("answers with the enabled agents", async () => {
    const { call } = await serve();

    const answer = await call("GET", agentsPath);
    const snapshot = answer.body as unknown as AgentsSnapshot;

    assert.equal(answer.status, 200);
    assert.deepEqual(
      snapshot.agents.map((agent) => [agent.id, agent.ownership, agent.source, agent.skills]),
      [["starter.generic", "plugin", "builtin", { include: [], exclude: [] }]],
    );
  });

  it("answers with nothing when every plugin with an agent is off", async () => {
    const { call } = await serve({
      contributions: { base: () => [], forProject: () => [] },
    });

    // Ноль агентов — законный ответ, а не отказ (docs/sessions-and-projects.md).
    assert.deepEqual((await call("GET", agentsPath)).body, { agents: [] });
  });

  it("keeps project agents out of the global list and resolves them for their project", async () => {
    const p1Agent = { ...baseAgent, instructions: "p1", source: "project:p1" as const };
    const p2Agent = { ...baseAgent, instructions: "p2", source: "project:p2" as const };
    const { call, service, projectId } = await serve({
      contributions: {
        base: () => [baseAgent],
        forProject: (wanted) => [wanted === projectId ? p1Agent : p2Agent],
      },
    });

    assert.deepEqual(
      ((await call("GET", agentsPath)).body as unknown as AgentsSnapshot).agents.map(
        ({ source }) => source,
      ),
      ["builtin"],
    );
    assert.deepEqual(
      service.agentsForProject(projectId).map(({ source }) => source),
      ["project:p1"],
    );
    assert.deepEqual(
      service.agentsForProject("p2").map(({ source }) => source),
      ["project:p2"],
    );
  });
});

describe("POST /api/sessions", () => {
  it("creates a session and tells the bus", async () => {
    const agent = {
      ...baseAgent,
      location: "/plugins/starter/agents/generic/AGENT.md",
    };
    const { start, events, folder, projectId, initialAgentDefinitions } = await serve({
      contributions: { base: () => [agent], forProject: () => [agent] },
    });

    const answer = await start();

    assert.equal(answer.status, 200);
    assert.equal(answer.body["projectId"], projectId);
    assert.equal(answer.body["folder"], folder);
    assert.equal(answer.body["phase"], "idle");
    assert.ok(
      events.some((event) => event.type === coreEventTypes.sessionsChanged),
      "создание сессии обязано быть видно тому, кто её не создавал",
    );
    assert.deepEqual(initialAgentDefinitions, [
      {
        id: baseAgent.id,
        instructions: baseAgent.instructions,
        directory: "/plugins/starter/agents/generic",
      },
    ]);
  });

  it("refuses an agent nobody enabled", async () => {
    const { call, projectId, model } = await serve();

    const answer = await call("POST", sessionsPath, {
      projectId,
      agentId: "нет.такого",
      model,
    });

    assert.equal(answer.status, 409);
    assert.match(String(answer.body["error"]), /agent .* is not available/);
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

  it("revalidates a project agent after it was listed", async () => {
    let current: ContributionRegistration[] = [baseAgent];
    const { service, call, projectId, model } = await serve({
      contributions: { base: () => [baseAgent], forProject: () => current },
    });

    assert.deepEqual(
      service.agentsForProject(projectId).map(({ id }) => id),
      [baseAgent.id],
    );
    current = [];

    const answer = await call("POST", sessionsPath, { projectId, agentId: baseAgent.id, model });

    assert.equal(answer.status, 409);
    assert.match(String(answer.body["error"]), new RegExp(baseAgent.id));
  });

  it("uses safe empty selectors for a programmatic agent that omits them", async () => {
    const programmatic = {
      ...baseAgent,
      tools: undefined,
      skills: undefined,
    } as unknown as AgentContributionRegistration;
    const { call, start, appliedToolNames, appliedSkills } = await serve({
      contributions: { base: () => [programmatic], forProject: () => [programmatic] },
    });
    const sessionId = String((await start()).body["id"]);

    await call("POST", sessionTurnsPath(sessionId), { text: "hello" });
    await untilIdle(call, sessionId);

    assert.deepEqual(appliedToolNames.at(-1), []);
    assert.deepEqual(appliedSkills.at(-1), []);
  });

  it("re-resolves instructions, tool selectors and skill selectors before every turn", async () => {
    const review = skill("review");
    const unsafe = skill("review-unsafe");
    const hidden = skill("hidden", { disableModelInvocation: true });
    let agent: AgentContributionRegistration = {
      ...baseAgent,
      instructions: "first instructions",
      location: "/agents/first/AGENT.md",
      tools: { include: ["read"], exclude: [] },
      skills: { include: ["review*", "hidden"], exclude: ["*-unsafe"] },
    };
    let contributions: ContributionRegistration[] = [agent, review, unsafe, hidden];
    const {
      call,
      start,
      appliedInstructions,
      appliedAgentDirectories,
      appliedSkills,
      appliedToolNames,
      toolContexts,
      projectId,
      folder,
    } = await serve({
      turns: [{ text: "first" }, { text: "second" }],
      contributions: { base: () => [baseAgent], forProject: () => contributions },
    });
    const sessionId = String((await start()).body["id"]);

    await call("POST", sessionTurnsPath(sessionId), { text: "first" });
    await untilIdle(call, sessionId);

    assert.equal(appliedInstructions.at(-1), "first instructions");
    assert.equal(appliedAgentDirectories.at(-1), "/agents/first");
    assert.deepEqual(appliedToolNames.at(-1), ["read"]);
    // Скрытый скил доезжает до рантайма вместе с остальными: скрыт он от модели, а не от человека,
    // и отсеивает его рендерер каталога системного prompt, а не отбор здесь.
    assert.deepEqual(
      appliedSkills.at(-1)?.map(({ name }) => name),
      ["review", "hidden"],
    );
    assert.deepEqual(
      appliedSkills.at(-1)?.map(({ disableModelInvocation }) => disableModelInvocation),
      [undefined, true],
    );
    assert.deepEqual(toolContexts.at(-1), { projectId, folder });

    agent = {
      ...agent,
      instructions: "second instructions",
      location: undefined,
      tools: { include: ["bash", "write"], exclude: ["write"] },
      skills: { include: ["deploy"], exclude: [] },
    };
    contributions = [agent, skill("deploy")];

    await call("POST", sessionTurnsPath(sessionId), { text: "second" });
    await untilIdle(call, sessionId);

    assert.equal(appliedInstructions.at(-1), "second instructions");
    assert.deepEqual(appliedAgentDirectories, ["/agents/first", undefined]);
    assert.deepEqual(appliedToolNames.at(-1), ["bash"]);
    assert.deepEqual(
      appliedSkills.at(-1)?.map(({ name }) => name),
      ["deploy"],
    );
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

  it("opens a cold session with the current agent directory", async () => {
    const agent = {
      ...baseAgent,
      instructions: "current instructions",
      location: "/plugins/current-agent/agents/current/AGENT.md",
    };
    const { call, coldSessionId, initialAgentDefinitions } = await serve({
      coldSession: true,
      contributions: { base: () => [agent], forProject: () => [agent] },
    });

    assert.ok(coldSessionId);

    await call("POST", sessionTurnsPath(coldSessionId), { text: "продолжи" });
    await untilIdle(call, coldSessionId);

    assert.deepEqual(initialAgentDefinitions, [
      {
        id: baseAgent.id,
        instructions: "current instructions",
        directory: "/plugins/current-agent/agents/current",
      },
    ]);
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

    // Отказанный турн не пишет в дерево реплику человека — писать её было бы враньём: модель её
    // не видела. След об исчезнувшей модели при этом остаётся, и это другая запись.
    assert.deepEqual(
      afterRefusal.entries.filter((entry) => entry.kind === "message"),
      before.entries.filter((entry) => entry.kind === "message"),
    );
    assert.equal(afterRefusal.entries.length, before.entries.length + 1);

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
    const blocker = gate();
    const { call, start } = await serve({
      limit: 1,
      turns: [{ text: "первый" }, { text: "второй" }],
      operationGate: blocker,
    });
    const first = String((await start()).body["id"]);
    const second = String((await start()).body["id"]);

    const running = call("POST", sessionTurnsPath(first), { text: "первый" });

    await blocker.entry;

    const queued = await call("POST", sessionTurnsPath(second), { text: "второй" });

    // Турн принят, но ещё не начат — это отдельное состояние, а не «работает» (docs/architecture.md).
    assert.equal(queued.status, 200);
    assert.equal(queued.body["phase"], "queued");

    blocker.open();
    await running;
    await untilIdle(call, first);
    await untilIdle(call, second);
  });

  it("re-resolves definitions when a queued turn actually starts", async () => {
    const blocker = gate();
    let currentOperationGate: ReturnType<typeof gate> | undefined = blocker;
    let contributions: ContributionRegistration[] = [
      {
        ...baseAgent,
        instructions: "admission instructions",
        location: "/agents/admission/AGENT.md",
        tools: { include: ["read"], exclude: [] },
        skills: { include: ["admission-skill"], exclude: [] },
      },
      skill("admission-skill"),
    ];
    const {
      call,
      start,
      initialAgentDefinitions,
      appliedInstructions,
      appliedAgentDirectories,
      appliedSkills,
      appliedToolNames,
      harnessCalls,
    } = await serve({
      limit: 1,
      turns: [{ text: "занял" }, { text: "исполнил" }],
      contributions: { base: () => [baseAgent], forProject: () => contributions },
      operationGate: () => currentOperationGate,
    });
    const occupyingSessionId = String((await start()).body["id"]);
    const queuedSessionId = String((await start()).body["id"]);
    const occupying = call("POST", sessionTurnsPath(occupyingSessionId), { text: "займи слот" });

    await blocker.entry;

    const accepted = await call("POST", sessionTurnsPath(queuedSessionId), { text: "в очередь" });

    assert.equal(accepted.status, 200);
    assert.equal(accepted.body["phase"], "queued");

    contributions = [
      {
        ...baseAgent,
        instructions: "execution instructions",
        location: undefined,
        tools: { include: ["bash", "write"], exclude: ["write"] },
        skills: { include: ["execution-skill"], exclude: [] },
      },
      skill("execution-skill"),
    ];
    currentOperationGate = undefined;
    blocker.open();

    await occupying;
    await untilIdle(call, queuedSessionId);

    assert.deepEqual(initialAgentDefinitions, [
      {
        id: baseAgent.id,
        instructions: "admission instructions",
        directory: "/agents/admission",
      },
      {
        id: baseAgent.id,
        instructions: "admission instructions",
        directory: "/agents/admission",
      },
    ]);
    assert.deepEqual(harnessCalls.slice(-5), [
      "set-tools",
      "set-instructions",
      "set-agent-directory",
      "set-skills",
      "prompt",
    ]);
    assert.equal(appliedInstructions.at(-1), "execution instructions");
    assert.deepEqual(appliedAgentDirectories.slice(-2), ["/agents/admission", undefined]);
    assert.deepEqual(appliedToolNames.at(-1), ["bash"]);
    assert.deepEqual(
      appliedSkills.at(-1)?.map(({ name }) => name),
      ["execution-skill"],
    );
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
      contributions: { base: () => contributions, forProject: () => contributions },
    });

    assert.ok(coldSessionId);
    const snapshot = (await call("GET", sessionsPath)).body as unknown as SessionsSnapshot;

    assert.equal(snapshot.sessions[0]?.agentAvailable, false);
    assert.equal((await call("GET", sessionPath(coldSessionId))).body["agentAvailable"], false);

    const page = await call("GET", sessionEntriesPath(coldSessionId));

    assert.equal(page.status, 200);
    assert.deepEqual(
      (page.body as unknown as SessionEntriesPage).entries.map((entry) => entry.kind),
      ["model-change", "thinking-level-change"],
    );
    assert.equal((await call("GET", sessionBranchPath(coldSessionId))).status, 200);
    assert.equal((await call("GET", sessionContextPath(coldSessionId))).status, 200);
    assert.equal((await call("GET", sessionStatsPath(coldSessionId))).status, 200);

    const prompt = await call("POST", sessionTurnsPath(coldSessionId), { text: "продолжи" });

    assert.equal(prompt.status, 409);
    assert.match(String(prompt.body["error"]), new RegExp(baseAgent.id));

    contributions = [baseAgent];
    assert.equal((await call("GET", sessionPath(coldSessionId))).body["agentAvailable"], true);
    assert.equal(
      (await call("POST", sessionTurnsPath(coldSessionId), { text: "продолжи" })).status,
      200,
    );
    await untilIdle(call, coldSessionId);
  });

  it("refuses harness operations after a live session loses its agent", async () => {
    let contributions: ContributionRegistration[] = [baseAgent];
    const { call, start } = await serve({
      contributions: { base: () => contributions, forProject: () => contributions },
    });
    const sessionId = String((await start()).body["id"]);

    contributions = [];

    const answer = await call("POST", sessionMessagesPath(sessionId), {
      text: "remember this",
      mode: "append",
    });

    assert.equal(answer.status, 409);
    assert.match(String(answer.body["error"]), /agent .* is not available/);
  });

  it("applies current agent definitions before every live message mode", async () => {
    let contributions: ContributionRegistration[] = [baseAgent];
    const { call, start, appliedInstructions, appliedSkills, appliedToolNames, harnessCalls } =
      await serve({
        contributions: { base: () => contributions, forProject: () => contributions },
      });
    const sessionId = String((await start()).body["id"]);

    contributions = [
      {
        ...baseAgent,
        instructions: "current instructions",
        tools: { include: ["read", "write"], exclude: ["write"] },
        skills: { include: ["review"], exclude: [] },
      },
      skill("review"),
    ];

    for (const [mode, status] of [
      ["steer", 409],
      ["follow-up", 409],
      ["append", 200],
    ] as const) {
      const answer = await call("POST", sessionMessagesPath(sessionId), {
        text: "remember this",
        mode,
      });

      assert.equal(answer.status, status);
      assert.deepEqual(harnessCalls.slice(-5), [
        "set-tools",
        "set-instructions",
        "set-agent-directory",
        "set-skills",
        `message:${mode}`,
      ]);
    }

    assert.equal(appliedInstructions.at(-1), "current instructions");
    assert.deepEqual(appliedToolNames.at(-1), ["read"]);
    assert.deepEqual(
      appliedSkills.at(-1)?.map(({ name }) => name),
      ["review"],
    );
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

/** Счётчик сессий проекта. Отдельного маршрута на один проект нет — счёт живёт в списке. */
async function sessionCountOf(
  call: (method: string, path: string) => Promise<Answer>,
  projectId: string,
): Promise<number | undefined> {
  const body = (await call("GET", projectsPath)).body as unknown as {
    projects?: { id: string; sessionCount: number }[];
  };

  return body.projects?.find((project) => project.id === projectId)?.sessionCount;
}

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

describe("the session lifecycle over http", () => {
  it("names a session and shows the name in the list", async () => {
    const { call, start } = await serve();
    const sessionId = String((await start()).body["id"]);

    const written = await call("PUT", sessionPath(sessionId), {
      title: "разбор бага",
      archived: false,
    });

    assert.equal(written.status, 200);
    assert.equal(written.body["title"], "разбор бага");
    assert.equal(
      ((await call("GET", sessionsPath)).body as unknown as SessionsSnapshot).sessions[0]?.title,
      "разбор бага",
    );
  });

  it("clears the session name when the replacement body omits it", async () => {
    const { call, start } = await serve();
    const sessionId = String((await start()).body["id"]);

    assert.equal(
      (
        await call("PUT", sessionPath(sessionId), {
          title: "разбор бага",
          archived: false,
        })
      ).status,
      200,
    );

    const cleared = await call("PUT", sessionPath(sessionId), { archived: false });

    assert.equal(cleared.status, 200);
    assert.equal(cleared.body["title"], undefined);
    assert.equal(
      ((await call("GET", sessionsPath)).body as unknown as SessionsSnapshot).sessions[0]?.title,
      undefined,
    );
  });

  it("archives a session out of the list and reads it by its own address", async () => {
    const { call, start, directory } = await serve();
    const sessionId = String((await start()).body["id"]);

    assert.equal((await call("PUT", sessionPath(sessionId), { archived: true })).status, 200);

    // Из списка сессия пропала, но по прямому адресу читается — она убрана с глаз, а не потеряна.
    assert.deepEqual(
      ((await call("GET", sessionsPath)).body as unknown as SessionsSnapshot).sessions,
      [],
    );
    assert.equal((await call("GET", sessionPath(sessionId))).body["archived"], true);
    assert.equal((await call("GET", sessionEntriesPath(sessionId))).status, 200);
    assert.equal(
      ((await call("GET", `${sessionsPath}?archived=true`)).body as unknown as SessionsSnapshot)
        .sessions[0]?.id,
      sessionId,
    );

    // Файл переехал в соседний корень, а не получил запись внутри себя.
    assert.equal(findSessionFile(join(directory, "sessions"), sessionId), undefined);
    assert.ok(findSessionFile(join(directory, "sessions-archived"), sessionId));

    assert.equal((await call("PUT", sessionPath(sessionId), { archived: false })).status, 200);
    assert.equal(
      ((await call("GET", sessionsPath)).body as unknown as SessionsSnapshot).sessions[0]?.id,
      sessionId,
    );
  });

  it("refuses a turn in an archived session", async () => {
    const { call, start } = await serve();
    const sessionId = String((await start()).body["id"]);

    await call("PUT", sessionPath(sessionId), { archived: true });

    const started = await call("POST", sessionTurnsPath(sessionId), { text: "скажи" });

    assert.equal(started.status, 409);
    assert.match(String(started.body["error"]), /archived/);
  });

  it("refuses to archive or delete a busy session, and lets it through once it idles", async () => {
    // Предел в ноль держит турн в очереди сколько угодно: занятость здесь наблюдаемая и без гонки.
    const { call, start } = await serve({ limit: 0 });
    const sessionId = String((await start()).body["id"]);

    assert.equal((await call("POST", sessionTurnsPath(sessionId), { text: "скажи" })).status, 200);
    assert.equal((await call("GET", sessionPath(sessionId))).body["phase"], "queued");

    // Двигать и стирать файл, в который вот-вот пойдёт дозапись, — гонка, и отказ здесь один и тот
    // же по обеим операциям.
    assert.equal((await call("PUT", sessionPath(sessionId), { archived: true })).status, 409);
    assert.equal((await call("DELETE", sessionPath(sessionId))).status, 409);

    // Переименование простоя не требует: это обычная запись в дерево, а не перенос файла.
    assert.equal(
      (await call("PUT", sessionPath(sessionId), { title: "имя на ходу", archived: false })).status,
      200,
    );

    assert.equal((await call("DELETE", sessionTurnsPath(sessionId))).body["interrupted"], true);
    await untilIdle(call, sessionId);

    assert.equal((await call("DELETE", sessionPath(sessionId))).status, 200);
  });

  it("deletes a session and stops counting it for the project", async () => {
    const { call, start, projectId, directory } = await serve();
    const sessionId = String((await start()).body["id"]);

    assert.equal(await sessionCountOf(call, projectId), 1);

    const deleted = await call("DELETE", sessionPath(sessionId));

    assert.equal(deleted.status, 200);
    assert.equal(deleted.body["id"], sessionId);
    assert.equal(findSessionFile(join(directory, "sessions"), sessionId), undefined);
    assert.equal((await call("GET", sessionPath(sessionId))).status, 404);
    assert.equal(await sessionCountOf(call, projectId), 0);
    assert.equal((await call("DELETE", sessionPath(sessionId))).status, 404);
  });

  it("forks a session from an entry into a second one in the same project", async () => {
    const { call, start, projectId } = await serve({ turns: [{ text: "готово" }] });
    const sessionId = String((await start()).body["id"]);

    assert.equal((await call("POST", sessionTurnsPath(sessionId), { text: "скажи" })).status, 200);
    await untilIdle(call, sessionId);

    const page = (await call("GET", sessionEntriesPath(sessionId)))
      .body as unknown as SessionEntriesPage;
    const question = page.entries.find(
      (entry) => entry.kind === "message" && entry.role === "user",
    );

    assert.ok(question);

    const forked = await call("POST", sessionForkPath(sessionId), { entryId: question.id });

    assert.equal(forked.status, 200);
    assert.equal(forked.body["projectId"], projectId);
    assert.notEqual(forked.body["id"], sessionId);
    assert.equal(
      ((await call("GET", sessionsPath)).body as unknown as SessionsSnapshot).sessions.length,
      2,
    );

    // Форк отрезал вопрос вместе с ответом: у него осталась только преамбула сессии.
    const forkedPage = (await call("GET", sessionEntriesPath(String(forked.body["id"]))))
      .body as unknown as SessionEntriesPage;

    assert.deepEqual(
      forkedPage.entries.map((entry) => entry.kind),
      ["model-change", "thinking-level-change", "tools-change"],
    );
  });

  it("refuses a fork that cuts before an answer instead of a question", async () => {
    const { call, start } = await serve({ turns: [{ text: "готово" }] });
    const sessionId = String((await start()).body["id"]);

    await call("POST", sessionTurnsPath(sessionId), { text: "скажи" });
    await untilIdle(call, sessionId);

    const page = (await call("GET", sessionEntriesPath(sessionId)))
      .body as unknown as SessionEntriesPage;
    const answer = page.entries.at(-1);

    assert.ok(answer);
    assert.equal(
      (await call("POST", sessionForkPath(sessionId), { entryId: answer.id })).status,
      409,
    );
    assert.equal((await call("POST", sessionForkPath("00000000"), {})).status, 404);
  });

  it("refuses steering when nothing is running", async () => {
    const { call, start } = await serve({ turns: [{ text: "готово" }] });
    const sessionId = String((await start()).body["id"]);

    const steered = await call("POST", sessionMessagesPath(sessionId), {
      text: "левее",
      mode: "steer",
    });

    assert.equal(steered.status, 409);
    assert.match(String(steered.body["error"]), /idle/);

    // Отказ ничего не запустил: сессия осталась в простое.
    assert.equal((await call("GET", sessionPath(sessionId))).body["phase"], "idle");
  });

  it("counts what the session cost", async () => {
    const { call, start } = await serve({ turns: [{ text: "готово" }] });
    const sessionId = String((await start()).body["id"]);

    await call("POST", sessionTurnsPath(sessionId), { text: "скажи" });
    await untilIdle(call, sessionId);

    const counted = await call("GET", sessionStatsPath(sessionId));
    const stats = counted.body as unknown as SessionStats;

    assert.equal(counted.status, 200);
    assert.equal(stats.sessionId, sessionId);
    assert.equal(stats.messageCount, 2);
    assert.equal((await call("GET", sessionStatsPath("00000000"))).status, 404);
  });

  it("refuses a body the contract does not know", async () => {
    const { call, start } = await serve();
    const sessionId = String((await start()).body["id"]);

    assert.equal((await call("PUT", sessionPath(sessionId), { title: "имя" })).status, 400);
    assert.equal((await call("POST", sessionMessagesPath(sessionId), { text: "и" })).status, 400);
    assert.equal(
      (await call("POST", sessionForkPath(sessionId), { position: "before" })).status,
      400,
    );
  });
});

/** Дождаться записи компакции: автопорог срабатывает после турна, а не в ответе на его запуск. */
async function untilCompacted(
  call: (method: string, path: string) => Promise<Answer>,
  sessionId: string,
): Promise<SessionEntry[]> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const page = (await call("GET", sessionEntriesPath(sessionId)))
      .body as unknown as SessionEntriesPage;

    if (page.entries.some((entry) => entry.kind === "compaction")) {
      return page.entries;
    }

    await new Promise((resolve) => setTimeout(resolve, 5));
  }

  throw new Error("компакция так и не записалась");
}

describe("reading the branch and the context over http", () => {
  it("answers with the branch from the leaf and from a named entry", async () => {
    const { call, start } = await serve({ turns: [{ text: "готово" }] });
    const sessionId = String((await start()).body["id"]);

    await call("POST", sessionTurnsPath(sessionId), { text: "скажи" });
    await untilIdle(call, sessionId);

    const answer = await call("GET", sessionBranchPath(sessionId));
    const whole = answer.body as unknown as SessionBranch;

    assert.equal(answer.status, 200);
    assert.equal(whole.sessionId, sessionId);
    assert.deepEqual(
      whole.entries.map((entry) => entry.kind),
      ["model-change", "thinking-level-change", "tools-change", "message", "message"],
    );
    assert.equal(whole.leafId, whole.entries.at(-1)?.id);

    const question = whole.entries.find(
      (entry) => entry.kind === "message" && entry.role === "user",
    );

    assert.ok(question);

    const partial = (await call("GET", sessionBranchPath(sessionId, question.id)))
      .body as unknown as SessionBranch;

    assert.equal(partial.entries.at(-1)?.id, question.id);
    // Лист остаётся листом сессии: по нему клиент отличает рабочую ветку от осмотренной чужой.
    assert.equal(partial.leafId, whole.leafId);

    assert.equal((await call("GET", sessionBranchPath(sessionId, "никакой"))).status, 404);
    assert.equal((await call("GET", sessionBranchPath("00000000"))).status, 404);
  });

  it("counts the context and names the live threshold", async () => {
    const { call, start, contextWindow } = await serve({
      turns: [{ text: "готово" }],
      compactionThreshold: 0.9,
    });
    const sessionId = String((await start()).body["id"]);

    await call("POST", sessionTurnsPath(sessionId), { text: "скажи" });
    await untilIdle(call, sessionId);

    const answer = await call("GET", sessionContextPath(sessionId));
    const usage = answer.body as unknown as SessionContextUsage;

    assert.equal(answer.status, 200);
    assert.equal(usage.sessionId, sessionId);
    assert.ok(usage.tokens > 0);
    assert.equal(usage.contextWindow, contextWindow);
    assert.equal(usage.threshold, 0.9);
    assert.equal((await call("GET", sessionContextPath("00000000"))).status, 404);
  });

  it("keeps reading an archived session and refuses to work in it", async () => {
    const { call, start } = await serve({ turns: [{ text: "готово" }] });
    const sessionId = String((await start()).body["id"]);

    await call("POST", sessionTurnsPath(sessionId), { text: "скажи" });
    await untilIdle(call, sessionId);

    const branch = (await call("GET", sessionBranchPath(sessionId)))
      .body as unknown as SessionBranch;
    const answerEntry = branch.entries.at(-1);

    assert.ok(answerEntry);
    assert.equal((await call("PUT", sessionPath(sessionId), { archived: true })).status, 200);

    // Читается: архивная сессия убрана с глаз, а не из системы (docs/sessions-and-projects.md).
    assert.equal((await call("GET", sessionBranchPath(sessionId))).status, 200);
    assert.equal((await call("GET", sessionContextPath(sessionId))).status, 200);

    // И не работает: три записи ниже стоят денег или меняют дерево.
    for (const refused of [
      await call("POST", sessionCompactPath(sessionId), {}),
      await call("POST", sessionNavigatePath(sessionId), { entryId: answerEntry.id }),
      await call("PUT", sessionEntryLabelPath(sessionId, answerEntry.id), { label: "важное" }),
    ]) {
      assert.equal(refused.status, 409);
      assert.match(String(refused.body["error"]), /archived/);
    }
  });
});

describe("the session message queue", () => {
  it("starts a message queued during compaction after compaction finishes", async () => {
    const compactionGate = gate();
    let currentOperationGate: ReturnType<typeof gate> | undefined;
    const { call, start } = await serve({
      turns: [{ text: "первый ответ" }, { text: "пересказ" }, { text: "ответ на очередь" }],
      operationGate: () => currentOperationGate,
    });
    const sessionId = String((await start()).body["id"]);

    await call("POST", sessionTurnsPath(sessionId), { text: "первый вопрос" });
    await untilIdle(call, sessionId);

    currentOperationGate = compactionGate;
    const compacting = call("POST", sessionCompactPath(sessionId), {});
    await compactionGate.entry;

    const queued = await call("POST", sessionQueuePath(sessionId), { text: "после компакции" });

    assert.equal(queued.status, 200);
    assert.deepEqual(
      (queued.body as unknown as SessionOutbox).messages.map((message) => message.text),
      ["после компакции"],
    );

    currentOperationGate = undefined;
    compactionGate.open();

    await compacting;
    await untilSaid(call, sessionId, "после компакции");
    await untilIdle(call, sessionId);

    const said = saidByUser(
      (await call("GET", sessionEntriesPath(sessionId))).body as unknown as SessionEntriesPage,
    );

    assert.equal(said.length, 2);
    assert.match(said[0] ?? "", /первый вопрос/);
    assert.match(said[1] ?? "", /после компакции/);
  });

  it("starts a queued message as a turn of its own once the session is free", async () => {
    const hold = gate();
    const { call, start } = await serve({
      turns: [{ text: "первый" }, { text: "второй" }],
      operationGate: hold,
    });
    const sessionId = String((await start()).body["id"]);

    await call("POST", sessionTurnsPath(sessionId), { text: "скажи" });
    await hold.entry;

    const placed = await call("POST", sessionQueuePath(sessionId), { text: "и ещё" });
    const waiting = placed.body as unknown as SessionOutbox;

    assert.equal(placed.status, 200);
    assert.deepEqual(
      waiting.messages.map((message) => message.text),
      ["и ещё"],
    );

    hold.open();
    await untilSaid(call, sessionId, "и ещё");
    await untilIdle(call, sessionId);

    // Уехало — значит ушло из очереди: показывать ждущим то, что уже в дереве, значило бы повторить
    // ровно тот двойной показ, из-за которого очередь и заводилась.
    assert.deepEqual((await call("GET", sessionQueuePath(sessionId))).body, { messages: [] });
  });

  it("keeps the order in which the messages were written", async () => {
    const hold = gate();
    const { call, start } = await serve({
      turns: [{ text: "первый" }, { text: "второй" }, { text: "третий" }],
      operationGate: hold,
    });
    const sessionId = String((await start()).body["id"]);

    await call("POST", sessionTurnsPath(sessionId), { text: "скажи" });
    await hold.entry;
    await call("POST", sessionQueuePath(sessionId), { text: "сначала это" });
    await call("POST", sessionQueuePath(sessionId), { text: "потом это" });

    hold.open();
    await untilSaid(call, sessionId, "потом это");
    await untilIdle(call, sessionId);

    const said = saidByUser(
      (await call("GET", sessionEntriesPath(sessionId))).body as unknown as SessionEntriesPage,
    );

    assert.equal(said.length, 3);
    assert.match(said[1] ?? "", /сначала это/);
    assert.match(said[2] ?? "", /потом это/);
  });

  it("stops the queue when a turn fails and runs the rest after the stop is lifted", async () => {
    const hold = gate();
    // Сценарий двойника кончается на первом ответе: следующий турн упадёт, и упадёт по-настоящему.
    const { call, start } = await serve({ turns: [{ text: "первый" }], operationGate: hold });
    const sessionId = String((await start()).body["id"]);

    await call("POST", sessionTurnsPath(sessionId), { text: "скажи" });
    await hold.entry;
    await call("POST", sessionQueuePath(sessionId), { text: "упадёт" });
    await call("POST", sessionQueuePath(sessionId), { text: "не должно уехать" });

    hold.open();

    const stopped = await untilStopped(call, sessionId);

    // Остаток цел: очередь остановлена, а не выброшена — гнать её в тот же тупик было бы тратой
    // денег владельца, а терять написанное нельзя вовсе.
    assert.deepEqual(
      stopped.messages.map((message) => message.text),
      ["не должно уехать"],
    );
    assert.match(stopped.stopped?.reason ?? "", /сценарий двойника кончился/);

    const resumed = await call("PUT", sessionQueuePath(sessionId), { stopped: false });

    assert.equal(resumed.status, 200);
    assert.equal((resumed.body as unknown as SessionOutbox).stopped, undefined);
  });

  it("runs the next queued message after a queued turn is cancelled", async () => {
    const hold = gate();
    // Предел в один поход: турн второй сессии встаёт в очередь и до старта не доходит.
    const { call, start, projectId } = await serve({
      turns: [{ text: "первый" }, { text: "второй" }],
      operationGate: hold,
      limit: 1,
    });
    const first = String((await start()).body["id"]);
    const second = String((await start()).body["id"]);

    assert.notEqual(projectId, "");
    await call("POST", sessionTurnsPath(first), { text: "занимаю слот" });
    await hold.entry;
    await call("POST", sessionTurnsPath(second), { text: "жду слота" });
    await untilQueued(call, second);
    await call("POST", sessionQueuePath(second), { text: "а это следующим" });

    // Снятый с очереди турн не выполняется вовсе, поэтому его `finally` очередь не сливает — это
    // делает сам `abort`.
    assert.equal((await call("DELETE", sessionTurnsPath(second))).status, 200);

    hold.open();
    await untilSaid(call, second, "а это следующим");
    await untilIdle(call, second);
  });

  it("steers a waiting message into the running turn and takes it off the queue", async () => {
    const holdInTool = gate();
    const { call, start } = await serve({
      turns: [{ toolCalls: [{ id: "c1", name: "hold", arguments: {} }] }, { text: "готово" }],
      toolGate: holdInTool,
    });
    const sessionId = String((await start()).body["id"]);

    await call("POST", sessionTurnsPath(sessionId), { text: "скажи" });
    await holdInTool.entry;

    const placed = (await call("POST", sessionQueuePath(sessionId), { text: "левее" }))
      .body as unknown as SessionOutbox;
    const messageId = placed.messages[0]?.id ?? "";
    const steered = await call("PUT", sessionQueuedMessagePath(sessionId, messageId), {
      mode: "steer",
    });

    assert.equal(steered.status, 200);
    // Снялось только после того, как стиринг принят: показанным дважды сообщение не бывает.
    assert.deepEqual(steered.body, { messages: [] });

    holdInTool.open();
    await untilSaid(call, sessionId, "левее");
    await untilIdle(call, sessionId);
  });

  it("puts the steering an interruption cleared back at the head of the queue", async () => {
    const holdInTool = gate();
    const { call, start } = await serve({
      turns: [{ toolCalls: [{ id: "c1", name: "hold", arguments: {} }] }, { text: "готово" }],
      toolGate: holdInTool,
    });
    const sessionId = String((await start()).body["id"]);

    await call("POST", sessionTurnsPath(sessionId), { text: "скажи" });
    await holdInTool.entry;
    assert.equal(
      (await call("POST", sessionMessagesPath(sessionId), { text: "левее", mode: "steer" })).status,
      200,
    );
    await call("POST", sessionQueuePath(sessionId), { text: "и потом это" });

    // Прерывание чистит очереди рантайма. Вклиненное модель не видела — оно возвращается в голову
    // очереди, а не пропадает, и уезжает первым, потому что написано раньше ждущего.
    holdInTool.open();
    assert.equal((await call("DELETE", sessionTurnsPath(sessionId))).status, 200);
    await untilSaid(call, sessionId, "левее");
    await untilIdle(call, sessionId);

    const said = saidByUser(
      (await call("GET", sessionEntriesPath(sessionId))).body as unknown as SessionEntriesPage,
    );

    assert.match(said[1] ?? "", /левее/);
  });

  it("keeps a waiting message on the queue when there is no turn to steer", async () => {
    const hold = gate();
    // Сценарий двойника кончается на первом ответе: следующий турн упадёт и остановит очередь,
    // оставив в ней сообщение при простаивающей сессии — то самое состояние, в котором вклиниваться
    // некуда, а показать кнопку «вклинить» было бы обманом.
    const { call, start } = await serve({ turns: [{ text: "первый" }], operationGate: hold });
    const sessionId = String((await start()).body["id"]);

    await call("POST", sessionTurnsPath(sessionId), { text: "скажи" });
    await hold.entry;
    await call("POST", sessionQueuePath(sessionId), { text: "упадёт" });
    await call("POST", sessionQueuePath(sessionId), { text: "левее" });

    hold.open();

    const stopped = await untilStopped(call, sessionId);
    const messageId = stopped.messages[0]?.id ?? "";
    const refused = await call("PUT", sessionQueuedMessagePath(sessionId, messageId), {
      mode: "steer",
    });

    assert.equal(refused.status, 409);
    assert.match(String(refused.body["error"]), /idle/);

    // Отказ ничего не стоил: сообщение по-прежнему ждёт своей очереди.
    const kept = (await call("GET", sessionQueuePath(sessionId))).body as unknown as SessionOutbox;

    assert.deepEqual(
      kept.messages.map((message) => message.text),
      ["левее"],
    );
  });

  it("drops a waiting message and answers 404 for one that is not there", async () => {
    const hold = gate();
    const { call, start } = await serve({
      turns: [{ text: "первый" }, { text: "второй" }],
      operationGate: hold,
    });
    const sessionId = String((await start()).body["id"]);

    await call("POST", sessionTurnsPath(sessionId), { text: "скажи" });
    await hold.entry;

    const placed = (await call("POST", sessionQueuePath(sessionId), { text: "передумал" }))
      .body as unknown as SessionOutbox;
    const messageId = placed.messages[0]?.id ?? "";
    const dropped = await call("DELETE", sessionQueuedMessagePath(sessionId, messageId));

    assert.equal(dropped.status, 200);
    assert.deepEqual(dropped.body, { messages: [] });
    assert.equal(
      (await call("DELETE", sessionQueuedMessagePath(sessionId, messageId))).status,
      404,
    );

    hold.open();
    await untilIdle(call, sessionId);
  });

  it("answers with an empty queue for a session that never queued anything", async () => {
    const { call, start } = await serve();
    const sessionId = String((await start()).body["id"]);

    // Снимок есть всегда: без него переподключившийся клиент про очередь не узнал бы ничего.
    assert.deepEqual((await call("GET", sessionQueuePath(sessionId))).body, { messages: [] });
    assert.equal((await call("GET", sessionQueuePath("нет-такой"))).status, 404);
  });

  it("refuses to queue anything for an archived session", async () => {
    const { call, start } = await serve();
    const sessionId = String((await start()).body["id"]);

    await untilIdle(call, sessionId);
    assert.equal((await call("PUT", sessionPath(sessionId), { archived: true })).status, 200);

    const refused = await call("POST", sessionQueuePath(sessionId), { text: "потом" });

    assert.equal(refused.status, 409);
    assert.match(String(refused.body["error"]), /archived/);
  });
});

describe("compacting a session over http", () => {
  it("re-resolves definitions when a queued compaction actually starts", async () => {
    const blocker = gate();
    let currentOperationGate: ReturnType<typeof gate> | undefined;
    let contributions: ContributionRegistration[] = [
      {
        ...baseAgent,
        instructions: "admission instructions",
        tools: { include: ["read"], exclude: [] },
        skills: { include: ["admission-skill"], exclude: [] },
      },
      skill("admission-skill"),
    ];
    const { call, start, appliedInstructions, appliedSkills, appliedToolNames, harnessCalls } =
      await serve({
        limit: 1,
        turns: [{ text: "target" }, { text: "occupying" }, { text: "summary" }],
        contributions: { base: () => [baseAgent], forProject: () => contributions },
        operationGate: () => currentOperationGate,
      });
    const occupyingSessionId = String((await start()).body["id"]);
    const compactingSessionId = String((await start()).body["id"]);

    await call("POST", sessionTurnsPath(compactingSessionId), { text: "prepare compact" });
    await untilIdle(call, compactingSessionId);

    currentOperationGate = blocker;
    const occupying = call("POST", sessionTurnsPath(occupyingSessionId), { text: "occupy slot" });
    await blocker.entry;

    const accepted = await call("POST", sessionCompactPath(compactingSessionId), {});
    assert.equal(accepted.status, 202);
    assert.equal(accepted.body["phase"], "queued");

    contributions = [
      {
        ...baseAgent,
        instructions: "execution instructions",
        tools: { include: ["bash", "write"], exclude: ["write"] },
        skills: { include: ["execution-skill"], exclude: [] },
      },
      skill("execution-skill"),
    ];
    currentOperationGate = undefined;
    blocker.open();

    await occupying;
    await untilIdle(call, compactingSessionId);

    assert.deepEqual(harnessCalls.slice(-5), [
      "set-tools",
      "set-instructions",
      "set-agent-directory",
      "set-skills",
      "compact",
    ]);
    assert.equal(appliedInstructions.at(-1), "execution instructions");
    assert.deepEqual(appliedToolNames.at(-1), ["bash"]);
    assert.deepEqual(
      appliedSkills.at(-1)?.map(({ name }) => name),
      ["execution-skill"],
    );
  });

  it("takes the compaction like a turn and writes it into the tree", async () => {
    const { call, start, events } = await serve({
      turns: [{ text: "готово" }, { text: "вот пересказ" }],
    });
    const sessionId = String((await start()).body["id"]);

    await call("POST", sessionTurnsPath(sessionId), { text: "скажи" });
    await untilIdle(call, sessionId);

    const seenBefore = events.length;
    const accepted = await call("POST", sessionCompactPath(sessionId), { instructions: "короче" });

    assert.equal(accepted.status, 202);
    assert.equal(accepted.body["sessionId"], sessionId);
    // Как у турна: возврат значит «принята», и фаза говорит, начата ли она уже.
    assert.ok(["compaction", "queued"].includes(String(accepted.body["phase"])));

    const entries = await untilCompacted(call, sessionId);
    const written = entries.find((entry) => entry.kind === "compaction");

    assert.ok(written?.kind === "compaction");
    assert.match(written.summary, /вот пересказ/);
    // Компакцию собрала платформа, а не рантайм: только так применяются наши настройки.
    assert.equal(written.fromHook, true);
    assert.ok(
      events.slice(seenBefore).some((event) => event.type === coreEventTypes.sessionsChanged),
      "компакция обязана быть видна тому, кто её не запускал",
    );

    await untilIdle(call, sessionId);
  });

  it("refuses a busy session, an unknown one and a body the contract does not know", async () => {
    const { call, start } = await serve({ limit: 0 });
    const sessionId = String((await start()).body["id"]);

    assert.equal(
      (await call("POST", sessionCompactPath(sessionId), { instructions: "   " })).status,
      400,
    );
    assert.equal((await call("POST", sessionCompactPath("00000000"), {})).status, 404);
    assert.equal((await call("POST", sessionTurnsPath(sessionId), { text: "скажи" })).status, 200);

    const refused = await call("POST", sessionCompactPath(sessionId), {});

    assert.equal(refused.status, 409);
    assert.match(String(refused.body["error"]), /busy/);
    assert.equal((await call("DELETE", sessionTurnsPath(sessionId))).body["interrupted"], true);
  });
});

describe("navigating the tree over http", () => {
  it("re-resolves definitions when a queued branch summary actually starts", async () => {
    const blocker = gate();
    let currentOperationGate: ReturnType<typeof gate> | undefined;
    let contributions: ContributionRegistration[] = [
      {
        ...baseAgent,
        instructions: "admission instructions",
        tools: { include: ["read"], exclude: [] },
        skills: { include: ["admission-skill"], exclude: [] },
      },
      skill("admission-skill"),
    ];
    const { call, start, appliedInstructions, appliedSkills, appliedToolNames, harnessCalls } =
      await serve({
        limit: 1,
        turns: [{ text: "first" }, { text: "second" }, { text: "occupying" }, { text: "summary" }],
        contributions: { base: () => [baseAgent], forProject: () => contributions },
        operationGate: () => currentOperationGate,
      });
    const occupyingSessionId = String((await start()).body["id"]);
    const navigatingSessionId = String((await start()).body["id"]);

    await call("POST", sessionTurnsPath(navigatingSessionId), { text: "first question" });
    await untilIdle(call, navigatingSessionId);
    await call("POST", sessionTurnsPath(navigatingSessionId), { text: "second question" });
    await untilIdle(call, navigatingSessionId);
    const branch = (await call("GET", sessionBranchPath(navigatingSessionId)))
      .body as unknown as SessionBranch;
    const target = branch.entries.filter(
      (entry) => entry.kind === "message" && entry.role === "user",
    )[1];
    assert.ok(target);

    currentOperationGate = blocker;
    const occupying = call("POST", sessionTurnsPath(occupyingSessionId), { text: "occupy slot" });
    await blocker.entry;
    const moving = call("POST", sessionNavigatePath(navigatingSessionId), {
      entryId: target.id,
      summarize: true,
    });
    await untilQueued(call, navigatingSessionId);

    contributions = [
      {
        ...baseAgent,
        instructions: "execution instructions",
        tools: { include: ["bash", "write"], exclude: ["write"] },
        skills: { include: ["execution-skill"], exclude: [] },
      },
      skill("execution-skill"),
    ];
    currentOperationGate = undefined;
    blocker.open();

    await occupying;
    assert.equal((await moving).status, 200);

    assert.deepEqual(harnessCalls.slice(-5), [
      "set-tools",
      "set-instructions",
      "set-agent-directory",
      "set-skills",
      "navigate",
    ]);
    assert.equal(appliedInstructions.at(-1), "execution instructions");
    assert.deepEqual(appliedToolNames.at(-1), ["bash"]);
    assert.deepEqual(
      appliedSkills.at(-1)?.map(({ name }) => name),
      ["execution-skill"],
    );
  });

  it("answers with the new leaf and the text to ask again", async () => {
    const { call, start } = await serve({ turns: [{ text: "первый" }, { text: "второй" }] });
    const sessionId = String((await start()).body["id"]);

    await call("POST", sessionTurnsPath(sessionId), { text: "первый вопрос" });
    await untilIdle(call, sessionId);
    await call("POST", sessionTurnsPath(sessionId), { text: "второй вопрос" });
    await untilIdle(call, sessionId);

    const branch = (await call("GET", sessionBranchPath(sessionId)))
      .body as unknown as SessionBranch;
    const second = branch.entries.filter(
      (entry) => entry.kind === "message" && entry.role === "user",
    )[1];

    assert.ok(second);

    const moved = await call("POST", sessionNavigatePath(sessionId), { entryId: second.id });
    const navigated = moved.body as unknown as SessionNavigated;

    assert.equal(moved.status, 200);
    // Переход синхронный именно ради этого поля: доставить его вне ответа нечем.
    assert.equal(navigated.editorText, "второй вопрос");
    assert.equal(navigated.leafId, second.parentId);
    assert.equal(navigated.summarized, false);

    // Лист переставлен, и ветка теперь кончается там, куда перешли.
    const after = (await call("GET", sessionBranchPath(sessionId)))
      .body as unknown as SessionBranch;

    assert.equal(after.leafId, second.parentId);
  });

  it("summarizes the branch it leaves when asked, and refuses a body without a target", async () => {
    const { call, start } = await serve({
      turns: [{ text: "первый" }, { text: "второй" }, { text: "пересказ ветки" }],
    });
    const sessionId = String((await start()).body["id"]);

    await call("POST", sessionTurnsPath(sessionId), { text: "первый вопрос" });
    await untilIdle(call, sessionId);
    await call("POST", sessionTurnsPath(sessionId), { text: "второй вопрос" });
    await untilIdle(call, sessionId);

    const branch = (await call("GET", sessionBranchPath(sessionId)))
      .body as unknown as SessionBranch;
    const second = branch.entries.filter(
      (entry) => entry.kind === "message" && entry.role === "user",
    )[1];

    assert.ok(second);

    const moved = await call("POST", sessionNavigatePath(sessionId), {
      entryId: second.id,
      summarize: true,
    });

    assert.equal(moved.status, 200);
    assert.equal((moved.body as unknown as SessionNavigated).summarized, true);

    const page = (await call("GET", sessionEntriesPath(sessionId)))
      .body as unknown as SessionEntriesPage;
    const summary = page.entries.at(-1);

    assert.equal(summary?.kind, "branch-summary");
    assert.match(summary?.kind === "branch-summary" ? summary.summary : "", /пересказ ветки/);

    assert.equal((await call("POST", sessionNavigatePath(sessionId), {})).status, 400);
    assert.equal(
      (await call("POST", sessionNavigatePath(sessionId), { entryId: "никакой" })).status,
      404,
    );
    assert.equal(
      (await call("POST", sessionNavigatePath("00000000"), { entryId: "e-1" })).status,
      404,
    );
  });
});

describe("labelling an entry over http", () => {
  it("sets a label, clears it and folds the records into the live value", async () => {
    const { call, start } = await serve({ turns: [{ text: "готово" }] });
    const sessionId = String((await start()).body["id"]);

    await call("POST", sessionTurnsPath(sessionId), { text: "скажи" });
    await untilIdle(call, sessionId);

    const branch = (await call("GET", sessionBranchPath(sessionId)))
      .body as unknown as SessionBranch;
    const answerEntry = branch.entries.at(-1);

    assert.ok(answerEntry);

    const written = await call("PUT", sessionEntryLabelPath(sessionId, answerEntry.id), {
      label: "  важное  ",
    });

    assert.equal(written.status, 200);
    assert.deepEqual(written.body, {
      sessionId,
      entryId: answerEntry.id,
      label: "важное",
    });

    const page = (await call("GET", sessionEntriesPath(sessionId)))
      .body as unknown as SessionEntriesPage;

    assert.deepEqual(foldEntryLabels(page.entries), new Map([[answerEntry.id, "важное"]]));

    const cleared = await call("PUT", sessionEntryLabelPath(sessionId, answerEntry.id), {
      label: null,
    });

    assert.equal(cleared.status, 200);
    assert.equal(cleared.body["label"], undefined);
    assert.deepEqual(
      foldEntryLabels(
        ((await call("GET", sessionEntriesPath(sessionId))).body as unknown as SessionEntriesPage)
          .entries,
      ),
      new Map(),
    );

    // Тело без ключа — не «не трогать»: запись заменяет запись целиком, и снятие пишется явно.
    assert.equal(
      (await call("PUT", sessionEntryLabelPath(sessionId, answerEntry.id), {})).status,
      400,
    );
    assert.equal(
      (await call("PUT", sessionEntryLabelPath(sessionId, "никакой"), { label: "и" })).status,
      404,
    );
    assert.equal(
      (await call("PUT", sessionEntryLabelPath("00000000", "e-1"), { label: "и" })).status,
      404,
    );
  });
});

describe("session commands over http", () => {
  /** Скил на диске: явный запуск читает сам файл, а не метаданные реестра. */
  const writtenSkill = (
    id: string,
    content: string,
    overrides: Parameters<typeof skill>[1] = {},
  ): Extract<ContributionRegistration, { kind: "skill" }> => {
    const directory = mkdtempSync(join(workspace, `skill-${id}-`));
    const location = join(directory, "SKILL.md");

    writeFileSync(location, content, "utf8");

    return skill(id, { location, ...overrides });
  };

  it("lists the skills of the session, hidden ones included", async () => {
    const review = skill("review");
    const secret = skill("secret", { disableModelInvocation: true });
    const other = skill("other");
    const agent: AgentContributionRegistration = {
      ...baseAgent,
      skills: { include: ["review", "secret"], exclude: [] },
    };
    const { call, start } = await serve({
      contributions: {
        base: () => [agent],
        forProject: () => [agent, review, secret, other],
      },
    });
    const sessionId = String((await start()).body["id"]);
    const answer = await call("GET", sessionCommandsPath(sessionId));

    assert.equal(answer.status, 200);
    assert.deepEqual(answer.body["skills"], [
      { name: "review", description: "review description", hidden: false },
      { name: "secret", description: "secret description", hidden: true },
    ]);
  });

  it("says there is no catalogue for a session it does not have", async () => {
    const { call } = await serve();

    assert.equal((await call("GET", sessionCommandsPath("0199missing"))).status, 404);
  });

  it("refuses the catalogue of an archived session", async () => {
    const { call, start } = await serve();
    const sessionId = String((await start()).body["id"]);

    assert.equal((await call("PUT", sessionPath(sessionId), { archived: true })).status, 200);

    const answer = await call("GET", sessionCommandsPath(sessionId));

    assert.equal(answer.status, 409);
    assert.match(String(answer.body["error"]), /archived/);
  });

  it("runs a turn from a skill the model cannot pick itself", async () => {
    const secret = writtenSkill("secret", "почини сборку и ничего больше", {
      disableModelInvocation: true,
    });
    const agent: AgentContributionRegistration = {
      ...baseAgent,
      skills: { include: ["secret"], exclude: [] },
    };
    const { call, start, appliedSkills } = await serve({
      turns: [{ text: "починил" }],
      contributions: { base: () => [agent], forProject: () => [agent, secret] },
    });
    const sessionId = String((await start()).body["id"]);
    const answer = await call("POST", sessionTurnsPath(sessionId), {
      skill: "secret",
      instructions: "начни с тестов",
    });

    assert.equal(answer.status, 200);
    await untilIdle(call, sessionId);

    const page = (await call("GET", sessionEntriesPath(sessionId)))
      .body as unknown as SessionEntriesPage;
    const said = JSON.stringify(
      page.entries.filter((entry) => entry.kind === "message" && entry.role === "user"),
    );

    // Модель получила инструкции скила целиком, а каталог системного prompt его по-прежнему не
    // видит: скрытый скил остаётся скрытым, запустил его человек.
    assert.match(said, /почини сборку и ничего больше/);
    assert.match(said, /начни с тестов/);
    assert.deepEqual(
      appliedSkills.at(-1)?.map(({ name }) => name),
      ["secret"],
    );
    assert.equal(appliedSkills.at(-1)?.[0]?.disableModelInvocation, true);
  });

  it("refuses a skill outside the selection of the agent without taking a queue slot", async () => {
    const allowed = writtenSkill("allowed", "можно");
    const denied = writtenSkill("denied", "нельзя");
    const agent: AgentContributionRegistration = {
      ...baseAgent,
      skills: { include: ["allowed"], exclude: [] },
    };
    const { call, start } = await serve({
      turns: [{ text: "готово" }],
      contributions: { base: () => [agent], forProject: () => [agent, allowed, denied] },
    });
    const sessionId = String((await start()).body["id"]);
    const refused = await call("POST", sessionTurnsPath(sessionId), { skill: "denied" });

    assert.equal(refused.status, 409);
    assert.match(String(refused.body["error"]), /denied/);

    // Слот очереди отказ не занял: следующий турн уходит сразу, а не ждёт освобождения.
    assert.equal(
      (await call("POST", sessionTurnsPath(sessionId), { text: "обычный турн" })).status,
      200,
    );
    await untilIdle(call, sessionId);
  });

  it("reads prompt templates of both roots and lets the project one win", async () => {
    const commandsDirectory = mkdtempSync(join(workspace, "commands-"));

    writeFileSync(
      join(commandsDirectory, "review.md"),
      "---\ndescription: Пользовательский разбор\n---\n\nРазбери $ARGUMENTS\n",
      "utf8",
    );
    // Имя команды ядра занять нельзя: `/compact` обязан значить одно и то же везде.
    writeFileSync(join(commandsDirectory, "compact.md"), "---\n---\n\nне я\n", "utf8");

    const { call, start, folder } = await serve({ commandsDirectory });

    mkdirSync(join(folder, ".sovereign", "commands"), { recursive: true });
    writeFileSync(
      join(folder, ".sovereign", "commands", "review.md"),
      "---\ndescription: Проектный разбор\n---\n\nРазбери ветку $1\n",
      "utf8",
    );

    const sessionId = String((await start()).body["id"]);
    const answer = await call("GET", sessionCommandsPath(sessionId));

    assert.deepEqual(answer.body["templates"], [
      { name: "review", description: "Проектный разбор", scope: "project" },
    ]);
  });

  it("runs a turn from a prompt template with the arguments substituted", async () => {
    const commandsDirectory = mkdtempSync(join(workspace, "commands-"));

    writeFileSync(
      join(commandsDirectory, "review.md"),
      "---\ndescription: Разбор\n---\n\nРазбери $1 и посмотри на $2\n",
      "utf8",
    );

    const { call, start } = await serve({ commandsDirectory, turns: [{ text: "разобрал" }] });
    const sessionId = String((await start()).body["id"]);
    const answer = await call("POST", sessionTurnsPath(sessionId), {
      template: "review",
      arguments: 'срез "пятнадцать b"',
    });

    assert.equal(answer.status, 200);
    await untilIdle(call, sessionId);

    const page = (await call("GET", sessionEntriesPath(sessionId)))
      .body as unknown as SessionEntriesPage;
    const said = JSON.stringify(
      page.entries.filter((entry) => entry.kind === "message" && entry.role === "user"),
    );

    assert.match(said, /Разбери срез/);
    assert.match(said, /пятнадцать b/);
  });

  it("refuses an unknown prompt template without taking a queue slot", async () => {
    const { call, start } = await serve({ turns: [{ text: "готово" }] });
    const sessionId = String((await start()).body["id"]);
    const refused = await call("POST", sessionTurnsPath(sessionId), { template: "нет-такого" });

    assert.equal(refused.status, 409);
    assert.match(String(refused.body["error"]), /нет-такого/);
    assert.equal(
      (await call("POST", sessionTurnsPath(sessionId), { text: "обычный турн" })).status,
      200,
    );
    await untilIdle(call, sessionId);
  });

  it("refuses a body that names both a message and a skill", async () => {
    const { call, start } = await serve();
    const sessionId = String((await start()).body["id"]);
    const answer = await call("POST", sessionTurnsPath(sessionId), {
      text: "сделай",
      skill: "review",
    });

    assert.equal(answer.status, 400);
    assert.match(String(answer.body["error"]), /skill/);
  });
});

describe("images over http", () => {
  /** Картинка ровно на столько декодированных байт, сколько просят. */
  const sized = (bytes: number): { mimeType: string; data: string } => {
    const payload = Buffer.alloc(bytes);

    payload.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

    return { mimeType: "image/png", data: payload.toString("base64") };
  };
  const seeing = { input: ["text", "image"] as ("text" | "image")[] };

  it("keeps the image in the tree and gives it back with the entries", async () => {
    const { call, start } = await serve(seeing);
    const sessionId = String((await start()).body["id"]);
    const image = sized(64);

    const accepted = await call("POST", sessionTurnsPath(sessionId), {
      text: "что тут",
      images: [image],
    });

    assert.equal(accepted.status, 200);
    await untilIdle(call, sessionId);

    const page = (await call("GET", sessionEntriesPath(sessionId)))
      .body as unknown as SessionEntriesPage;
    const said = page.entries.find((entry) => entry.kind === "message" && entry.role === "user");

    assert.deepEqual(said?.kind === "message" ? said.content : undefined, [
      { kind: "text", text: "что тут" },
      { kind: "image", mimeType: "image/png", data: image.data },
    ]);
  });

  it("answers 400 to a payload that is not an image of a type we take", async () => {
    const { call, start } = await serve(seeing);
    const sessionId = String((await start()).body["id"]);

    for (const images of [
      [{ mimeType: "image/svg+xml", data: sized(16).data }],
      [{ mimeType: "image/png", data: "не base64" }],
      // Объявленный тип не совпадает с байтами: провайдер ответил бы на это своей невнятной ошибкой.
      [{ mimeType: "image/jpeg", data: sized(16).data }],
    ]) {
      const refused = await call("POST", sessionTurnsPath(sessionId), { text: "смотри", images });

      assert.equal(refused.status, 400, JSON.stringify(images[0]?.mimeType));
    }
  });

  it("answers 413 when the payload itself is over a limit", async () => {
    const { call, start } = await serve({
      ...seeing,
      imageLimits: {
        maxImageBytes: 64,
        maxImagesPerMessage: 1,
        maxMessageImageBytes: 64,
        maxSessionImageBytes: 1024,
      },
    });
    const sessionId = String((await start()).body["id"]);

    const tooBig = await call("POST", sessionTurnsPath(sessionId), {
      text: "смотри",
      images: [sized(128)],
    });

    assert.equal(tooBig.status, 413);
    assert.match(String(tooBig.body["error"]), /maxImageBytes/);

    const tooMany = await call("POST", sessionTurnsPath(sessionId), {
      text: "смотри",
      images: [sized(16), sized(16)],
    });

    assert.equal(tooMany.status, 413);
  });

  it("answers 409 when the session has no room left, and writes nothing", async () => {
    const { call, start } = await serve({
      ...seeing,
      imageLimits: {
        maxImageBytes: 128,
        maxImagesPerMessage: 4,
        maxMessageImageBytes: 128,
        // Места ровно под одну картинку: вторая обязана упереться в бюджет сессии, а не в свой размер.
        maxSessionImageBytes: 100,
      },
    });
    const sessionId = String((await start()).body["id"]);

    assert.equal(
      (await call("POST", sessionTurnsPath(sessionId), { text: "первая", images: [sized(64)] }))
        .status,
      200,
    );
    await untilIdle(call, sessionId);

    const refused = await call("POST", sessionTurnsPath(sessionId), {
      text: "вторая",
      images: [sized(64)],
    });

    assert.equal(refused.status, 409);
    assert.match(String(refused.body["error"]), /maxSessionImageBytes/);

    // Отказ не записал ничего: в дереве осталась только первая реплика человека.
    const page = (await call("GET", sessionEntriesPath(sessionId)))
      .body as unknown as SessionEntriesPage;

    assert.equal(
      page.entries.filter((entry) => entry.kind === "message" && entry.role === "user").length,
      1,
    );
  });

  it("carries images into a message that does not start a turn", async () => {
    const { call, start } = await serve(seeing);
    const sessionId = String((await start()).body["id"]);
    const image = sized(48);

    const accepted = await call("POST", sessionMessagesPath(sessionId), {
      text: "посмотри потом",
      images: [image],
      mode: "append",
    });

    assert.equal(accepted.status, 200);

    const page = (await call("GET", sessionEntriesPath(sessionId)))
      .body as unknown as SessionEntriesPage;
    const said = page.entries.find((entry) => entry.kind === "message" && entry.role === "user");

    assert.deepEqual(said?.kind === "message" ? said.content : undefined, [
      { kind: "text", text: "посмотри потом" },
      { kind: "image", mimeType: "image/png", data: image.data },
    ]);
  });

  it("refuses a model that only reads text and says which model that is", async () => {
    const { call, start, model } = await serve();
    const sessionId = String((await start()).body["id"]);

    const refused = await call("POST", sessionMessagesPath(sessionId), {
      text: "смотри",
      images: [sized(16)],
      mode: "append",
    });

    assert.equal(refused.status, 409);
    assert.match(String(refused.body["error"]), new RegExp(model.replace("/", "\\/")));
    assert.match(String(refused.body["error"]), /does not read images/);
  });
});

describe("the automatic compaction threshold", () => {
  it("stays out of the way when the threshold is zero", async () => {
    const { call, start } = await serve({ turns: [{ text: "готово" }] });
    const sessionId = String((await start()).body["id"]);

    await call("POST", sessionTurnsPath(sessionId), { text: "скажи" });
    await untilIdle(call, sessionId);

    // Порог `0` — выключено, и это умолчание: компакция стоит денег и необратимо меняет разговор.
    await new Promise((resolve) => setTimeout(resolve, 50));

    const page = (await call("GET", sessionEntriesPath(sessionId)))
      .body as unknown as SessionEntriesPage;

    assert.equal(page.entries.filter((entry) => entry.kind === "compaction").length, 0);
  });

  it("compacts by itself once past the threshold, and does not loop on it", async () => {
    const { call, start } = await serve({
      // Три ответа: турн, пересказ автокомпакции и запас на тот случай, если она пойдёт по кругу.
      turns: [{ text: "готово" }, { text: "вот пересказ" }, { text: "лишний" }],
      // Доля, которую перерастает любой непустой разговор: порог здесь проверяется, а не подбирается.
      compactionThreshold: 0.000_01,
    });
    const sessionId = String((await start()).body["id"]);

    await call("POST", sessionTurnsPath(sessionId), { text: "скажи" });

    const entries = await untilCompacted(call, sessionId);
    const written = entries.find((entry) => entry.kind === "compaction");

    assert.ok(written?.kind === "compaction");
    assert.equal(written.fromHook, true);

    await untilIdle(call, sessionId);

    // Контекст свёрнутой сессии всё ещё выше порога, но второй раз подряд компакция не идёт:
    // иначе сессия ходила бы к модели по кругу за деньги владельца.
    await new Promise((resolve) => setTimeout(resolve, 100));

    const after = (await call("GET", sessionEntriesPath(sessionId)))
      .body as unknown as SessionEntriesPage;

    assert.equal(after.entries.filter((entry) => entry.kind === "compaction").length, 1);
  });
});

describe("a session that lost a tool or a model", () => {
  it("leaves a trace in the tree and an event on the bus, once per loss", async () => {
    let contributions: ContributionRegistration[] = [baseAgent];
    const { call, start, events } = await serve({
      turns: [{ text: "первый" }, { text: "второй" }, { text: "третий" }],
      contributions: { base: () => contributions, forProject: () => contributions },
    });
    const sessionId = String((await start()).body["id"]);

    await call("POST", sessionTurnsPath(sessionId), { text: "первый" });
    await untilIdle(call, sessionId);

    // Агенту оставили один инструмент из четырёх: остальные для сессии исчезли на ходу.
    contributions = [{ ...baseAgent, tools: { include: ["read"], exclude: [] } }];

    await call("POST", sessionTurnsPath(sessionId), { text: "второй" });
    await untilIdle(call, sessionId);

    const lost = events
      .filter((event) => event.type === coreEventTypes.sessionDegraded)
      .map((event) => (event.payload as { kind: string; name: string }).name)
      .sort();

    assert.deepEqual(lost, ["bash", "edit", "write"]);

    const page = (await call("GET", sessionEntriesPath(sessionId)))
      .body as unknown as SessionEntriesPage;

    // След об утрате — запись вида `custom` со своим типом, а не безымянное «что-то ещё»: разбор
    // записей рантайма полный, и `other` остался только под то, чего Pi пока не умеет.
    assert.deepEqual(
      page.entries
        .filter((entry) => entry.kind === "custom")
        .map((entry) => (entry.kind === "custom" ? entry.type : "")),
      ["sovereign.degraded", "sovereign.degraded", "sovereign.degraded"],
    );

    // Повторный турн на том же наборе ничего не теряет — и ничего не повторяет.
    await call("POST", sessionTurnsPath(sessionId), { text: "третий" });
    await untilIdle(call, sessionId);

    assert.equal(events.filter((event) => event.type === coreEventTypes.sessionDegraded).length, 3);
  });

  it("says the model went away instead of only refusing the turn", async () => {
    const { call, start, model, removeModel, events } = await serve();
    const sessionId = String((await start()).body["id"]);

    await call("POST", sessionTurnsPath(sessionId), { text: "первый" });
    await untilIdle(call, sessionId);

    removeModel();

    assert.equal((await call("POST", sessionTurnsPath(sessionId), { text: "второй" })).status, 409);

    const degraded = events.filter((event) => event.type === coreEventTypes.sessionDegraded);

    assert.deepEqual(
      degraded.map((event) => event.payload),
      [{ sessionId, kind: "model", name: model }],
    );

    const page = (await call("GET", sessionEntriesPath(sessionId)))
      .body as unknown as SessionEntriesPage;

    const last = page.entries.at(-1);

    assert.equal(last?.kind, "custom");
    assert.deepEqual(last?.kind === "custom" ? last.data : undefined, {
      kind: "model",
      name: model,
    });
  });
});

/**
 * Двойник сведения ответов: диспетчер проверен своими тестами, а здесь проверяются точки вызова —
 * что платформа спрашивает и рассказывает там, где обещала (docs/hooks.md).
 */
function hookRecorder(refusals: HookRefusal[] = []) {
  const observed: { event: string; payload: unknown; audience: HookAudience }[] = [];
  const decided: { event: string; payload: unknown; audience: HookAudience }[] = [];

  return {
    observed,
    decided,
    hooks: {
      observe: (event, payload, audience) => {
        observed.push({ event, payload, audience });
      },
      decide: async (event, payload, audience) => {
        decided.push({ event, payload, audience });

        return { refusals };
      },
    } satisfies Pick<HookDispatcher, "observe" | "decide">,
  };
}

function observedPayload(
  recorder: ReturnType<typeof hookRecorder>,
  event: string,
): Record<string, unknown> | undefined {
  return recorder.observed.find((entry) => entry.event === event)?.payload as
    Record<string, unknown> | undefined;
}

describe("the platform hooks of a session", () => {
  it("asks before the session starts and tells about it once it did", async () => {
    const recorder = hookRecorder();
    const { start, projectId, folder } = await serve({ hooks: recorder.hooks });

    const started = await start();

    assert.equal(started.status, 200);

    // Спрашивается до первой траты и до появления файла, и спрашивается о проекте сессии: подписка
    // плагина проекта чужого проекта не касается.
    assert.deepEqual(recorder.decided, [
      {
        event: "before_session_start",
        payload: { projectId, folder, agentId: baseAgent.id },
        audience: { projectId },
      },
    ]);
    assert.deepEqual(observedPayload(recorder, "session_created"), {
      sessionId: started.body["id"],
      projectId,
      agentId: baseAgent.id,
    });
  });

  it("refuses the session with 409 and every author named, creating nothing", async () => {
    const recorder = hookRecorder([
      { contributionId: "budget.guard", reason: "бюджет исчерпан" },
      { contributionId: "hours.guard", reason: "не рабочее время" },
    ]);
    const { call, start } = await serve({ hooks: recorder.hooks });

    const refused = await start();

    assert.equal(refused.status, 409);
    assert.deepEqual(refused.body["refusals"], [
      { contributionId: "budget.guard", reason: "бюджет исчерпан" },
      { contributionId: "hours.guard", reason: "не рабочее время" },
    ]);

    // Отказов столько, сколько отказавших: конфликт двух политик не сворачивается в первую причину.
    assert.match(String(refused.body["error"]), /budget\.guard: бюджет исчерпан/);
    assert.match(String(refused.body["error"]), /hours\.guard: не рабочее время/);

    // Отказ до первой траты означает, что сессии нет вовсе, а не есть неудавшаяся.
    assert.deepEqual(
      ((await call("GET", sessionsPath)).body as unknown as SessionsSnapshot).sessions,
      [],
    );
    assert.equal(
      recorder.observed.some((entry) => entry.event === "session_created"),
      false,
    );
  });

  it("tells what the turn spent and that the session closed", async () => {
    const recorder = hookRecorder();
    const { call, start, projectId } = await serve({
      turns: [{ text: "готово", tokens: 5 }],
      hooks: recorder.hooks,
    });
    const sessionId = String((await start()).body["id"]);

    await call("POST", sessionTurnsPath(sessionId), { text: "сделай" });
    await untilIdle(call, sessionId);

    const finished = observedPayload(recorder, "turn_finished");

    assert.equal(finished?.["sessionId"], sessionId);
    assert.equal(finished?.["projectId"], projectId);

    // Трата уезжает типом рантайма и непрозрачной: своего отчёта мы не заводим (docs/hooks.md).
    assert.equal((finished?.["usage"] as { totalTokens?: number } | undefined)?.totalTokens, 5);

    assert.equal((await call("DELETE", sessionPath(sessionId))).status, 200);
    assert.deepEqual(observedPayload(recorder, "session_closed"), { sessionId, projectId });
  });
});
