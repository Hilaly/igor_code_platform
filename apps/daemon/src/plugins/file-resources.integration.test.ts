import assert from "node:assert/strict";
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
  sessionsPath,
  type BusEvent,
  type ContributionRegistration,
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
import { createProjectStore } from "../projects/project-store.ts";
import { createProjectLifecycle } from "../projects/project-lifecycle.ts";
import { projectResourceRoutes } from "../projects/project-resources.ts";
import { createDispatcher } from "../http/dispatcher.ts";
import { createSessionService } from "../sessions/sessions.ts";
import { coreToolSource } from "../sessions/core-tools.ts";
import { createToolCollector } from "../sessions/tool-collection.ts";
import { createTurnQueue } from "../sessions/turn-queue.ts";

const workspace = mkdtempSync(join(tmpdir(), "sovereign-file-resources-e2e-"));
const logger = createLogger({ source: "core", level: () => "error", write: () => {} });

after(() => rmSync(workspace, { recursive: true, force: true }));

const validSkill = (description = "Review changes"): string =>
  `---\nname: review\ndescription: ${description}\n---\nRead the change carefully.\n`;
const validAgent = `---\nname: project-agent\ndescription: Project agent\ntools:\n  include: ["*"]\n  exclude: []\nskills:\n  include: [review]\n  exclude: []\n---\nWork in this project.\n`;
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

async function repeatUntilSeen(next: () => Promise<boolean>, change: () => void): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    change();
    if (await next()) return;
  }
  throw new Error("the filesystem watcher never reported the change");
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
): Promise<number> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      unsubscribe();
      reject(new Error(`revision did not advance beyond ${afterRevision}`));
    }, 2_000);
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
      if (payload.key !== "builtin:base-agent") return;
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
    const projectStore = createProjectStore({ directory: dataDirectory, logger });
    const projectOutcome = projectStore.create({
      name: "Project",
      folder: projectFolder,
      folderKey: projectFolder,
    });
    assert.equal(projectOutcome.kind, "created");
    assert.equal(projectOutcome.kind, "created");
    const project = projectOutcome.project;
    const projectSkills = join(projectFolder, ".sovereign", "skills");
    const projectAgents = join(projectFolder, ".sovereign", "agents");
    const skillDirectory = join(projectSkills, "review");
    const skillPath = join(skillDirectory, "SKILL.md");
    const agentPath = join(projectAgents, "project-agent", "AGENT.md");
    mkdirSync(skillDirectory, { recursive: true });
    mkdirSync(join(projectAgents, "project-agent"), { recursive: true });

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
        projects: [project],
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
      archivedDirectory: join(dataDirectory, "sessions-archived"),
      turns: [
        { toolCalls: [{ id: "read-skill", name: "read", arguments: { path: skillPath } }] },
        { text: "done" },
      ],
    });
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
        (ids) => ids.includes("base-agent.agent"),
        "built-in base agent",
      );
      assert.deepEqual(
        (await requestJson(port, "GET", projectAgentsPath(project.id))).body.agents instanceof Array
          ? (
              (await requestJson(port, "GET", projectAgentsPath(project.id))).body.agents as Array<{
                id: string;
              }>
            ).map((agent) => agent.id)
          : [],
        ["base-agent.agent"],
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
        ["review"],
      );
      assert.equal(
        (await requestJson(port, "GET", projectFileResourcesPath(project.id))).status,
        200,
      );

      const agentRevision = registry.revision();
      await changeAndWait(bus, agentRevision, () => writeFileSync(agentPath, validAgent));
      assert.deepEqual(
        registry.resolvedForProject(project.id, "agent").map((agent) => agent.id),
        ["base-agent.agent", "project-agent"],
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
      await eventually(
        () => appliedSkills,
        (skills) => skills.some((names) => names.includes("review")),
        "skill catalogue application",
      );

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
      assert.ok(((await sessions.entries(sessionId))?.entries.length ?? 0) > 0);

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
      await changeAndWait(bus, missingRevision, () => rmSync(agentPath));
      const summary = (await sessions.list(project.id)).find((session) => session.id === sessionId);
      assert.equal(summary?.agentAvailable, false);
      const refusedTurn = await requestJson(port, "POST", sessionTurnsPath(sessionId), {
        text: "again",
      });
      assert.equal(refusedTurn.status, 409);

      const restoredRevision = registry.revision();
      await changeAndWait(bus, restoredRevision, () => writeFileSync(agentPath, validAgent));
      assert.equal(
        (await requestJson(port, "POST", sessionTurnsPath(sessionId), { text: "again" })).status,
        200,
      );

      const otherProjectFolder = mkdtempSync(join(workspace, "other-project-"));
      const other = projectStore.create({
        name: "Other",
        folder: otherProjectFolder,
        folderKey: otherProjectFolder,
      });
      assert.equal(other.kind, "created");
      assert.deepEqual(
        registry.resolvedForProject(other.project.id, "agent").map((agent) => agent.id),
        ["base-agent.agent"],
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
    }
  });
});
