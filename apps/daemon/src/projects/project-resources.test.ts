import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer, request as sendRequest, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { after, describe, it } from "node:test";

import {
  projectAgentsPath,
  projectFileResourcesPath,
  type AgentSummary,
  type FileResourcesSnapshot,
} from "@sovereign/protocol";

import { createDispatcher } from "../http/public.ts";
import { createLogger } from "../platform/public.ts";
import type { StoredProject } from "./project-store.ts";
import { projectResourceRoutes } from "./project-resources.ts";

const servers: Server[] = [];

after(async () => {
  for (const server of servers) {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});

type Answer = { status: number; body: unknown };

const agent = (id: string, source: string): AgentSummary => ({
  id,
  description: `${id} description`,
  ownership: "standalone",
  source,
  scope: source === "project:p1" ? "project" : "user",
  ...(source === "project:p1" ? { projectId: "p1" } : {}),
  skills: { include: [], exclude: [] },
});

const project = (overrides: Partial<StoredProject> = {}): StoredProject => ({
  id: "p1",
  name: "One",
  folder: "/projects/one",
  folderKey: "/projects/one",
  archived: false,
  createdAt: "2026-08-03T00:00:00.000Z",
  ...overrides,
});

async function serve(options: {
  project?: StoredProject;
  availability?: "available" | "missing";
  agents?: AgentSummary[];
  fileResources?: FileResourcesSnapshot;
}) {
  const known = options.project ?? project();
  const logger = createLogger({ source: "core", level: () => "error", write: () => {} });
  const server = createServer(
    createDispatcher({
      routes: projectResourceRoutes({
        projects: { find: (id) => (id === known.id ? known : undefined) },
        availability: () => options.availability ?? "available",
        agents: () => ({ agents: options.agents ?? [] }),
        fileResources: () =>
          options.fileResources ?? { revision: 0, resources: [], diagnostics: [] },
      }),
      logger,
      authenticate: () => ({ kind: "session", id: "the-session" }),
    }),
  );

  servers.push(server);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address() as AddressInfo;

  return (path: string): Promise<Answer> =>
    new Promise((resolve, reject) => {
      const outgoing = sendRequest({ host: "127.0.0.1", port, method: "GET", path }, (incoming) => {
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
      });
      outgoing.on("error", reject);
      outgoing.end();
    });
}

describe("projectResourceRoutes", () => {
  it("returns the final project agent snapshot without shadowed definitions", async () => {
    const active = [agent("base", "data"), agent("override", "project:p1")];
    const call = await serve({ agents: active });

    assert.deepEqual(await call(projectAgentsPath("p1")), {
      status: 200,
      body: { agents: active },
    });
  });

  it("returns all file resource states and diagnostics in one unpaginated snapshot", async () => {
    const snapshot: FileResourcesSnapshot = {
      revision: 7,
      resources: [
        {
          kind: "agent",
          id: "active",
          ownership: "standalone",
          scope: "project",
          source: "project:p1",
          path: "/projects/one/.sovereign/agents/active/AGENT.md",
          state: "active",
        },
        {
          kind: "skill",
          id: "old",
          ownership: "plugin",
          pluginKey: "data:tools",
          scope: "user",
          source: "data",
          path: "/plugins/tools/skills/old/SKILL.md",
          state: "shadowed",
        },
        {
          kind: "skill",
          id: "off",
          ownership: "plugin",
          pluginKey: "data:tools",
          scope: "user",
          source: "data",
          path: "/plugins/tools/skills/off/SKILL.md",
          state: "switched-off",
        },
        {
          kind: "agent",
          ownership: "standalone",
          scope: "project",
          source: "project:p1",
          path: "/projects/one/.sovereign/agents/broken/AGENT.md",
          state: "invalid",
        },
      ],
      diagnostics: [
        {
          severity: "error",
          code: "missing-description",
          message: "the agent description is required",
          path: "/projects/one/.sovereign/agents/broken/AGENT.md",
          kind: "agent",
        },
      ],
    };
    const call = await serve({ fileResources: snapshot });

    assert.deepEqual(await call(projectFileResourcesPath("p1")), {
      status: 200,
      body: snapshot,
    });
  });

  it("answers with empty arrays when the project has no applicable resources", async () => {
    const call = await serve({});

    assert.deepEqual(await call(projectAgentsPath("p1")), {
      status: 200,
      body: { agents: [] },
    });
    assert.deepEqual(await call(projectFileResourcesPath("p1")), {
      status: 200,
      body: { revision: 0, resources: [], diagnostics: [] },
    });
  });

  it("answers 404 for both resources of an unknown project", async () => {
    const call = await serve({});

    assert.deepEqual(await call(projectAgentsPath("missing")), {
      status: 404,
      body: { error: "not found" },
    });
    assert.deepEqual(await call(projectFileResourcesPath("missing")), {
      status: 404,
      body: { error: "not found" },
    });
  });

  for (const [state, options, reason] of [
    ["archived", { project: project({ archived: true }) }, "the project is archived"],
    ["unavailable", { availability: "missing" as const }, "the folder /projects/one is not there"],
  ] as const) {
    it(`answers 409 for both resources of an ${state} project`, async () => {
      const call = await serve(options);

      assert.deepEqual(await call(projectAgentsPath("p1")), {
        status: 409,
        body: { error: reason },
      });
      assert.deepEqual(await call(projectFileResourcesPath("p1")), {
        status: 409,
        body: { error: reason },
      });
    });
  }
});
