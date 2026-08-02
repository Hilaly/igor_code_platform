import assert from "node:assert/strict";
import { join } from "node:path";
import { describe, it } from "node:test";

import { standaloneResourceRoots } from "./file-resource-roots.ts";

describe("standaloneResourceRoots", () => {
  it("orders every approved root and excludes archived or missing projects", () => {
    const dataDirectory = "/data";
    const homeDirectory = "/home/owner";
    const projects = [
      { id: "p1", folder: "/projects/one", archived: false },
      { id: "archived", folder: "/projects/archived", archived: true },
      { id: "missing", folder: "/projects/missing", archived: false },
      { id: "work", folder: "/data/work", archived: false },
    ];

    assert.deepEqual(
      standaloneResourceRoots({
        dataDirectory,
        homeDirectory,
        projects,
        availability: (project) => (project.id === "missing" ? "missing" : "available"),
      }),
      [
        {
          key: "project:p1:agents:sovereign",
          source: "sovereign",
          scope: "project",
          projectId: "p1",
          kind: "agent",
          precedence: 200,
          directory: join("/projects/one", ".sovereign", "agents"),
        },
        {
          key: "project:p1:skills:sovereign",
          source: "sovereign",
          scope: "project",
          projectId: "p1",
          kind: "skill",
          precedence: 400,
          directory: join("/projects/one", ".sovereign", "skills"),
        },
        {
          key: "project:p1:skills:agents",
          source: "agents",
          scope: "project",
          projectId: "p1",
          kind: "skill",
          precedence: 300,
          directory: join("/projects/one", ".agents", "skills"),
        },
        {
          key: "project:work:agents:sovereign",
          source: "sovereign",
          scope: "project",
          projectId: "work",
          kind: "agent",
          precedence: 200,
          directory: join("/data/work", ".sovereign", "agents"),
        },
        {
          key: "project:work:skills:sovereign",
          source: "sovereign",
          scope: "project",
          projectId: "work",
          kind: "skill",
          precedence: 400,
          directory: join("/data/work", ".sovereign", "skills"),
        },
        {
          key: "project:work:skills:agents",
          source: "agents",
          scope: "project",
          projectId: "work",
          kind: "skill",
          precedence: 300,
          directory: join("/data/work", ".agents", "skills"),
        },
        {
          key: "data:agents",
          source: "sovereign",
          scope: "user",
          kind: "agent",
          precedence: 100,
          directory: join(dataDirectory, "agents"),
        },
        {
          key: "data:skills",
          source: "sovereign",
          scope: "user",
          kind: "skill",
          precedence: 200,
          directory: join(dataDirectory, "skills"),
        },
        {
          key: "home:agents:skills",
          source: "agents",
          scope: "user",
          kind: "skill",
          precedence: 100,
          directory: join(homeDirectory, ".agents", "skills"),
        },
      ],
    );
  });
});
