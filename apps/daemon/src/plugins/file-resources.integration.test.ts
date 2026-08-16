import assert from "node:assert/strict";
/* This file is a composition test: it intentionally crosses daemon-area facades to exercise the
 * complete lifecycle in one process. Production modules retain the normal boundary rules. */
/* eslint-disable no-restricted-imports */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, request as sendRequest, type Server } from "node:http";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";

import {
  defaultPreferences,
  coreEventTypes,
  isPluginBusEvent,
  projectAgentsPath,
  projectFileResourcesPath,
  sessionTurnsPath,
  type BusEvent,
  type ContributionsChanged,
  type PluginStatus,
} from "@sovereign/protocol";
import type { AgentSession, AgentSessionStore } from "@sovereign/agent-runtime-pi";
import { scriptedSessionStore } from "@sovereign/agent-runtime-pi/testing";
import { createEventBus } from "../platform/public.ts";
import { createLogger, ensureDataDirectory } from "../platform/public.ts";
import { createContributionRegistry } from "./contribution-registry.ts";
import { createStandaloneFileResourceService } from "./standalone-file-resources.ts";
import { standaloneResourceRoots } from "./file-resource-roots.ts";
import { defaultPluginRoots, discoverPlugins } from "./plugin-sources.ts";
import { createPluginSupervisor } from "./plugin-supervisor.ts";
import {
  createProjectLifecycle,
  createProjectStore,
  projectResourceRoutes,
} from "../projects/public.ts";
import { createDispatcher } from "../http/public.ts";
import {
  coreToolSource,
  createSessionService,
  createToolCollector,
  createTurnQueue,
} from "../sessions/public.ts";

const workspace = mkdtempSync(join(tmpdir(), "sovereign-file-resources-e2e-"));
const logger = createLogger({ source: "core", level: () => "error", write: () => {} });

after(() => rmSync(workspace, { recursive: true, force: true }));

const validSkill = (description = "Review changes", body = "Read the change carefully."): string =>
  `---\nname: review\ndescription: ${description}\n---\n${body}\n`;
const validAgent = (description = "Project agent"): string =>
  `---\nname: project-agent\ndescription: ${description}\ntools:\n  include: ["*"]\n  exclude: []\nskills:\n  include: [review]\n  exclude: []\n---\nWork in this project.\n`;
const malformedSkill = `---\nname: [review\n---\nBroken.\n`;

type HttpAnswer = { status: number; body: Record<string, unknown> };

async function requestJson(
  port: number,
  method: string,
  path: string,
  body?: unknown,
): Promise<HttpAnswer> {
  return new Promise((resolve, reject) => {
    const request = sendRequest(
      { host: "127.0.0.1", port, method, path, headers: { "content-type": "application/json" } },
      (response) => {
        let text = "";
        response.setEncoding("utf8");
        response.on("data", (chunk: string) => {
          text += chunk;
        });
        response.on("end", () =>
          resolve({
            status: response.statusCode ?? 0,
            body: text === "" ? {} : (JSON.parse(text) as Record<string, unknown>),
          }),
        );
      },
    );
    request.on("error", reject);
    request.end(body === undefined ? undefined : JSON.stringify(body));
  });
}

async function eventually<T>(
  read: () => T,
  predicate: (value: T) => boolean,
  hint: string,
): Promise<T> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const value = read();
    if (predicate(value)) return value;
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  throw new Error(`timed out waiting for ${hint}`);
}

async function waitFor<T>(
  read: () => Promise<T>,
  predicate: (value: T) => boolean,
  hint: string,
): Promise<T> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const value = await read();
    if (predicate(value)) return value;
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  throw new Error(`timed out waiting for ${hint}`);
}

async function changeAndWait(
  bus: ReturnType<typeof createEventBus>,
  revision: number,
  change: () => void,
): Promise<number> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const waiting = waitForRevision(bus, revision);
    change();
    try {
      return await waiting;
    } catch {
      // The watcher may have inspected the path before this write. Repeat the write while
      // retaining the revision we are waiting for; this is the same race-safe pattern as the
      // watcher unit tests.
    }
  }
  throw new Error(`revision did not advance beyond ${revision}`);
}

function waitForRevision(
  bus: ReturnType<typeof createEventBus>,
  afterRevision: number,
  timeoutMilliseconds = 2_000,
): Promise<number> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      unsubscribe();
      reject(new Error(`revision did not advance beyond ${afterRevision}`));
    }, timeoutMilliseconds);
    const unsubscribe = bus.subscribe((event: BusEvent) => {
      if (isPluginBusEvent(event) || event.type !== coreEventTypes.contributionsChanged) return;
      const payload = event.payload as ContributionsChanged;
      if (payload.revision <= afterRevision) return;
      clearTimeout(timer);
      unsubscribe();
      resolve(payload.revision);
    });
  });
}

function waitForPluginRunning(bus: ReturnType<typeof createEventBus>): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      unsubscribe();
      reject(new Error("base agent did not activate"));
    }, 2_000);
    const unsubscribe = bus.subscribe((event: BusEvent) => {
      if (isPluginBusEvent(event) || event.type !== coreEventTypes.pluginLifecycle) return;
      const payload = event.payload as PluginStatus;
      if (payload.key !== "builtin:starter") return;
      if (payload.state === "running") {
        clearTimeout(timer);
        unsubscribe();
        resolve();
      } else if (payload.state === "failed") {
        clearTimeout(timer);
        unsubscribe();
        reject(new Error(payload.reason ?? "base agent failed"));
      }
    });
  });
}

function decorateSession(session: AgentSession, appliedSkills: string[][]): AgentSession {
  return {
    ...session,
    setSkills: (skills) => {
      appliedSkills.push(skills.map((skill) => skill.name));
      session.setSkills(skills);
    },
  };
}

describe("file resources end to end", () => {
  it("reloads project skills and agents through sessions without a daemon restart", async () => {
    const dataDirectory = ensureDataDirectory(mkdtempSync(join(workspace, "data-")));
    const projectFolder = mkdtempSync(join(workspace, "project-"));
    const otherProjectFolder = mkdtempSync(join(workspace, "other-project-"));
    const projectStore = createProjectStore({ directory: dataDirectory, logger });
    const projectOutcome = projectStore.create({
      name: "Project",
      folder: projectFolder,
      folderKey: projectFolder,
    });
    assert.equal(projectOutcome.kind, "created");
    const project = projectOutcome.project;
    const otherOutcome = projectStore.create({
      name: "Other",
      folder: otherProjectFolder,
      folderKey: otherProjectFolder,
    });
    assert.equal(otherOutcome.kind, "created");
    const other = otherOutcome.project;
    const projectSkills = join(projectFolder, ".sovereign", "skills");
    const projectAgents = join(projectFolder, ".sovereign", "agents");
    const skillDirectory = join(projectSkills, "review");
    const skillPath = join(skillDirectory, "SKILL.md");
    const agentPath = join(projectAgents, "project-agent", "AGENT.md");
    mkdirSync(skillDirectory, { recursive: true });
    mkdirSync(join(projectAgents, "project-agent"), { recursive: true });
    const otherSkillPath = join(otherProjectFolder, ".sovereign", "skills", "review", "SKILL.md");
    const otherAgentPath = join(
      otherProjectFolder,
      ".sovereign",
      "agents",
      "project-agent",
      "AGENT.md",
    );
    mkdirSync(join(otherProjectFolder, ".sovereign", "skills", "review"), { recursive: true });
    mkdirSync(join(otherProjectFolder, ".sovereign", "agents", "project-agent"), {
      recursive: true,
    });
    writeFileSync(otherSkillPath, validSkill("Other review", "Only the other project content."));
    writeFileSync(otherAgentPath, validAgent("Other project agent"));

    const bus = createEventBus({
      onListenerError: (cause) => {
        throw cause;
      },
    });
    const events: BusEvent[] = [];
    bus.subscribe((event) => events.push(event));
    const registry = createContributionRegistry();
    const plugins = createPluginSupervisor({
      logger,
      registry,
      bus,
      createPluginLogger: (source) =>
        createLogger({ source, level: () => "error", write: () => {} }),
    });
    const standalone = createStandaloneFileResourceService({
      roots: standaloneResourceRoots({
        dataDirectory,
        homeDirectory: workspace,
        projects: [project, other],
        availability: () => "available",
      }),
      registry,
      logger,
      publishContributionChanges: () =>
        bus.publish(coreEventTypes.contributionsChanged, { revision: registry.revision() }),
    });
    const appliedSkills: string[][] = [];
    const scripted = scriptedSessionStore({
      directory: join(dataDirectory, "sessions"),
      sovereignDataDirectory: dataDirectory,
      archivedDirectory: join(dataDirectory, "sessions-archived"),
      turns: [
        { toolCalls: [{ id: "read-skill", name: "read", arguments: { path: skillPath } }] },
        { text: "done" },
      ],
    });
    const modelRequests = scripted.requests;
    const sessionStore: AgentSessionStore = {
      ...scripted.store,
      create: async (input) => {
        const result = await scripted.store.create(input);
        return "kind" in result ? result : decorateSession(result, appliedSkills);
      },
      open: async (id) => {
        const result = await scripted.store.open(id);
        if (result === undefined) return result;
        return {
          ...result,
          activate: (agent) => {
            const activated = result.activate(agent);
            return "kind" in activated ? activated : decorateSession(activated, appliedSkills);
          },
        };
      },
    };
    const tools = createToolCollector();
    tools.register(coreToolSource());
    const sessions = createSessionService({
      store: sessionStore,
      projects: projectStore,
      contributions: {
        base: () => registry.resolvedBase(),
        forProject: (id) => registry.resolvedForProject(id),
      },
      tools,
      queue: createTurnQueue({ limit: () => 1 }),
      bus,
      emitDelta: () => {},
      logger,
      availability: () => "available",
      projectLifecycle: createProjectLifecycle(),
    });
    const server: Server = createServer(
      createDispatcher({
        routes: [
          ...projectResourceRoutes({
            projects: projectStore,
            availability: () => "available",
            agents: (id) => ({ agents: sessions.agentsForProject(id) }),
            fileResources: (id) => registry.fileResourcesForProject(id),
          }),
          ...sessions.routes(),
        ],
        logger,
        authenticate: () => ({ kind: "session", id: "integration" }),
      }),
    );
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const port = (server.address() as AddressInfo).port;

    try {
      const pluginRunning = waitForPluginRunning(bus);
      await plugins.apply(
        { plugins: discoverPlugins([defaultPluginRoots(dataDirectory)[0]!]).plugins, refused: [] },
        defaultPreferences,
      );
      await pluginRunning;
      await standalone.start();
      await sessions.refresh();

      await eventually(
        () => registry.resolvedForProject(project.id, "agent").map((agent) => agent.id),
        (ids) => ids.includes("starter.generic"),
        "built-in starter generic agent",
      );
      const initialAgents = (await requestJson(port, "GET", projectAgentsPath(project.id))).body
        .agents as Array<{ id: string }>;
      assert.deepEqual(
        initialAgents.map((agent) => agent.id),
        ["starter.generic"],
      );
      const initialResources = (
        await requestJson(port, "GET", projectFileResourcesPath(project.id))
      ).body.resources as Array<{ id?: string }>;
      assert.equal(
        initialResources.some((resource) => resource.id === "review"),
        false,
      );

      await changeAndWait(bus, registry.revision(), () => writeFileSync(skillPath, validSkill()));
      assert.deepEqual(
        registry.resolvedForProject(project.id, "skill").map((skill) => skill.id),
        [
          "review",
          "starter.creating-agents",
          "starter.creating-prompt-templates",
          "starter.creating-skills",
          "starter.plugin-backend",
          "starter.plugin-frontend",
          "superpowers.brainstorming",
          "superpowers.dispatching-parallel-agents",
          "superpowers.executing-plans",
          "superpowers.finishing-a-development-branch",
          "superpowers.receiving-code-review",
          "superpowers.requesting-code-review",
          "superpowers.subagent-driven-development",
          "superpowers.systematic-debugging",
          "superpowers.test-driven-development",
          "superpowers.using-git-worktrees",
          "superpowers.using-superpowers",
          "superpowers.verification-before-completion",
          "superpowers.writing-plans",
          "superpowers.writing-skills",
        ],
      );
      assert.equal(
        (await requestJson(port, "GET", projectFileResourcesPath(project.id))).status,
        200,
      );

      const agentRevision = registry.revision();
      await changeAndWait(bus, agentRevision, () => writeFileSync(agentPath, validAgent()));
      assert.deepEqual(
        registry.resolvedForProject(project.id, "agent").map((agent) => agent.id),
        ["project-agent", "starter.generic"],
      );
      const projectAgentsResponse = (await requestJson(port, "GET", projectAgentsPath(project.id)))
        .body.agents as Array<{ id: string; description?: string }>;
      assert.equal(
        projectAgentsResponse.find((agent) => agent.id === "project-agent")?.description,
        "Project agent",
      );
      const otherAgentsResponse = (await requestJson(port, "GET", projectAgentsPath(other.id))).body
        .agents as Array<{ id: string; description?: string }>;
      assert.equal(
        otherAgentsResponse.find((agent) => agent.id === "project-agent")?.description,
        "Other project agent",
      );

      const fileResources = registry.fileResourcesForProject(project.id);
      assert.equal(
        fileResources.resources.find((resource) => resource.id === "review")?.state,
        "active",
      );
      const created = await sessions.create({
        projectId: project.id,
        agentId: "project-agent",
        model: scripted.model,
        thinkingLevel: "off",
      });
      assert.equal(created.kind, "created");
      const sessionId = created.kind === "created" ? created.session.id : "";
      const turn = await sessions.prompt({ sessionId, text: "read review" });
      assert.equal(turn.kind, "accepted");
      await waitFor(
        async () => modelRequests,
        (requests) => requests.length >= 2,
        "model request and read follow-up",
      );
      const firstPrompt = modelRequests[0]?.systemPrompt ?? "";
      const agentDirectory = join(projectAgents, "project-agent");
      assert.match(firstPrompt, /<runtime_context>/);
      assert.match(
        firstPrompt,
        new RegExp(`<cwd>${project.folder.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}<\\/cwd>`),
      );
      assert.match(
        firstPrompt,
        new RegExp(
          `<agent_personal_directory>${agentDirectory.replace(
            /[.*+?^${}()|[\]\\]/gu,
            "\\$&",
          )}<\\/agent_personal_directory>`,
        ),
      );
      assert.match(
        firstPrompt,
        new RegExp(
          `<sovereign_data_directory>${dataDirectory.replace(
            /[.*+?^${}()|[\]\\]/gu,
            "\\$&",
          )}<\\/sovereign_data_directory>`,
        ),
      );
      assert.match(firstPrompt, /Work on the current project in cwd/);
      assert.doesNotMatch(firstPrompt, /<agent_data>/);
      assert.match(firstPrompt, /<available_skills>/);
      assert.match(firstPrompt, /<name>review<\/name>/);
      assert.match(firstPrompt, /<description>Review changes<\/description>/);
      assert.match(
        firstPrompt,
        new RegExp(`<location>${skillPath.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}<\\/location>`),
      );
      const readResult = JSON.stringify(modelRequests.flatMap((request) => request.messages));
      assert.match(readResult, /Read the change carefully/);
      await eventually(
        () => appliedSkills,
        (skills) => skills.some((names) => names.includes("review")),
        "skill catalogue application",
      );

      const sibling = join(skillDirectory, "references", "checklist.md");
      mkdirSync(join(skillDirectory, "references"), { recursive: true });
      const siblingRevision = registry.revision();
      await changeAndWait(bus, siblingRevision, () => writeFileSync(sibling, "first checklist\n"));
      const parsedAfterSibling = registry
        .resolvedForProject(project.id, "skill")
        .find((skill) => skill.id === "review");
      assert.equal(parsedAfterSibling?.description, "Review changes");
      const siblingEditedRevision = registry.revision();
      await changeAndWait(bus, siblingEditedRevision, () =>
        writeFileSync(sibling, "edited checklist\n"),
      );
      assert.equal(
        registry.resolvedForProject(project.id, "skill").find((skill) => skill.id === "review")
          ?.description,
        "Review changes",
      );

      const historyBeforeInvalid = await sessions.entries(sessionId);
      assert.ok(historyBeforeInvalid !== undefined);
      const invalidRevision = registry.revision();
      await changeAndWait(bus, invalidRevision, () => writeFileSync(skillPath, malformedSkill));
      assert.equal(
        registry.resolvedForProject(project.id, "skill").some((skill) => skill.id === "review"),
        false,
      );
      assert.equal(
        registry
          .fileResourcesForProject(project.id)
          .resources.find((resource) => resource.path === skillPath)?.state,
        "invalid",
      );
      const invalidResources = (
        await requestJson(port, "GET", projectFileResourcesPath(project.id))
      ).body.resources as Array<{ path: string; state: string }>;
      assert.equal(
        invalidResources.find((resource) => resource.path === skillPath)?.state,
        "invalid",
      );
      const agentsAfterInvalid = (await requestJson(port, "GET", projectAgentsPath(project.id)))
        .body.agents as Array<{ id: string }>;
      assert.equal(
        agentsAfterInvalid.some((agent) => agent.id === "project-agent"),
        true,
      );
      const sessionAfterInvalid = (await sessions.list(project.id)).find(
        (session) => session.id === sessionId,
      );
      assert.equal(sessionAfterInvalid?.agentAvailable, true);
      assert.deepEqual((await sessions.entries(sessionId))?.entries, historyBeforeInvalid.entries);

      const fixedRevision = registry.revision();
      await changeAndWait(bus, fixedRevision, () =>
        writeFileSync(skillPath, validSkill("Fixed review")),
      );
      assert.equal(
        registry.resolvedForProject(project.id, "skill").find((skill) => skill.id === "review")
          ?.description,
        "Fixed review",
      );

      const missingRevision = registry.revision();
      await changeAndWait(bus, missingRevision, () => {
        // Файл переписывается перед удалением, чтобы повтор внутри changeAndWait рождал событие и
        // на второй попытке: удаление уже удалённого файла не рождает ничего, и потерянное первое
        // событие было бы невосстановимым. Промежуточного состояния никто не увидит — rescan
        // отложен на debounce, а обе операции синхронны.
        writeFileSync(agentPath, validAgent());
        rmSync(agentPath, { force: true });
      });
      const summary = (await sessions.list(project.id)).find((session) => session.id === sessionId);
      assert.equal(summary?.agentAvailable, false);
      const refusedTurn = await requestJson(port, "POST", sessionTurnsPath(sessionId), {
        text: "again",
      });
      assert.equal(refusedTurn.status, 409);

      const restoredRevision = registry.revision();
      await changeAndWait(bus, restoredRevision, () => writeFileSync(agentPath, validAgent()));
      assert.equal(
        (await requestJson(port, "POST", sessionTurnsPath(sessionId), { text: "again" })).status,
        200,
      );

      assert.deepEqual(
        registry.resolvedForProject(other.id, "agent").map((agent) => agent.id),
        ["project-agent", "starter.generic"],
      );
      assert.equal(
        registry.resolvedForProject(other.id, "agent").find((agent) => agent.id === "project-agent")
          ?.description,
        "Other project agent",
      );
      assert.equal(
        registry.resolvedForProject(other.id, "skill").find((skill) => skill.id === "review")
          ?.description,
        "Other review",
      );
      assert.equal(
        registry.resolvedForProject(project.id, "skill").find((skill) => skill.id === "review")
          ?.description,
        "Fixed review",
      );
      const otherAgentsHttp = (await requestJson(port, "GET", projectAgentsPath(other.id))).body
        .agents as Array<{ id: string; description?: string }>;
      assert.equal(
        otherAgentsHttp.find((agent) => agent.id === "project-agent")?.description,
        "Other project agent",
      );
      assert.equal(
        events.some((event) => event.type === coreEventTypes.contributionsChanged),
        true,
      );
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await sessions.close();
      standalone.close();
      await plugins.stopAll();
      assert.equal(
        plugins
          .statuses()
          .some((status) => status.state === "running" || status.state === "starting"),
        false,
      );
      const closedRevision = registry.revision();
      writeFileSync(skillPath, validSkill("after close"));
      await assert.rejects(waitForRevision(bus, closedRevision, 250), /revision did not advance/);
    }
  });
});
