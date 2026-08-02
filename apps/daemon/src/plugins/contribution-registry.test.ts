import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { ContributionRegistration, FileResourceDiagnostic } from "@sovereign/protocol";
import type { PluginContribution } from "@sovereign/sdk";

import {
  createContributionRegistry,
  type ContributingPlugin,
  type FileContributionInput,
  type StandaloneContributionSnapshot,
} from "./contribution-registry.ts";

const builtinHello: ContributingPlugin = { key: "builtin:hello", id: "hello", source: "builtin" };
const dataHello: ContributingPlugin = { key: "data:hello", id: "hello", source: "data" };
const projectHello: ContributingPlugin = {
  key: "project:p1:hello",
  id: "hello",
  source: "project:p1",
};
const projectOtherHello: ContributingPlugin = {
  key: "project:p2:hello",
  id: "hello",
  source: "project:p2",
};
const nothingDisabled = new Set<string>();

const agent = (instructions: string): PluginContribution => ({
  kind: "agent",
  id: "agent",
  instructions,
  tools: { include: ["*"] },
});

const ids = (registrations: ContributionRegistration[]): string[] =>
  registrations.map((registration) => registration.id);

type FileRegistration = Extract<ContributionRegistration, { kind: "agent" | "skill" }>;

const standaloneAgent = (
  id: string,
  source: string,
  scope: "user" | "project",
  projectId?: string,
): Extract<ContributionRegistration, { kind: "agent" }> => ({
  ownership: "standalone",
  kind: "agent",
  id,
  declaredId: id,
  source,
  scope,
  ...(projectId === undefined ? {} : { projectId }),
  instructions: `${source} instructions`,
  tools: { include: [], exclude: [] },
  skills: { include: [], exclude: [] },
});

const standaloneSkill = (
  id: string,
  source: string,
  scope: "user" | "project",
  projectId?: string,
): Extract<ContributionRegistration, { kind: "skill" }> => ({
  ownership: "standalone",
  kind: "skill",
  id,
  declaredId: id,
  source,
  scope,
  ...(projectId === undefined ? {} : { projectId }),
  name: id,
  description: `${source} skill`,
  location: `/roots/${source}/${id}/SKILL.md`,
  disableModelInvocation: false,
});

const file = (
  registration: FileRegistration,
  path = `/definitions/${registration.id}`,
  diagnostics: FileResourceDiagnostic[] = [],
): FileContributionInput => ({ registration, path, diagnostics, kind: registration.kind });

const acceptStandaloneSnapshot = (_snapshot: StandaloneContributionSnapshot): void => {};
const acceptFileInput = (_input: FileContributionInput): void => {};

// @ts-expect-error Project ownership is incomplete without the project identifier.
acceptStandaloneSnapshot({
  rootKey: "project:missing:skills",
  source: "sovereign",
  scope: "project",
  precedence: 400,
  contributions: [],
});

// @ts-expect-error Discovery must preserve the requested kind even when parsing failed.
acceptFileInput({ path: "/broken/ENTRY.md", diagnostics: [] });

function standalone(
  rootKey: string,
  precedence: number,
  contributions: FileContributionInput[],
  overrides: { scope: "project"; projectId: string; source?: string },
): StandaloneContributionSnapshot;
function standalone(
  rootKey: string,
  precedence: number,
  contributions: FileContributionInput[],
  overrides?: { scope?: "user"; projectId?: never; source?: string },
): StandaloneContributionSnapshot;
function standalone(
  rootKey: string,
  precedence: number,
  contributions: FileContributionInput[],
  overrides:
    | { scope: "project"; projectId: string; source?: string }
    | { scope?: "user"; projectId?: never; source?: string } = {},
): StandaloneContributionSnapshot {
  return {
    rootKey,
    source: "sovereign",
    scope: "user",
    precedence,
    contributions,
    ...overrides,
  } as StandaloneContributionSnapshot;
}

describe("createContributionRegistry", () => {
  it("keeps a malformed project snapshot out of base resolution defensively", () => {
    const registry = createContributionRegistry();
    const malformed = {
      rootKey: "project:missing:skills",
      source: "sovereign",
      scope: "project",
      precedence: 400,
      contributions: [file(standaloneSkill("review", "sovereign", "project"))],
    } as unknown as StandaloneContributionSnapshot;

    registry.applyStandalone(malformed);

    assert.deepEqual(registry.resolvedBase(), []);
  });

  it("filters project declarations before precedence and conflict resolution", () => {
    const registry = createContributionRegistry();

    registry.applyPlugin(builtinHello, [agent("built-in")], nothingDisabled);
    registry.applyPlugin(dataHello, [agent("data")], nothingDisabled);
    registry.applyPlugin(projectHello, [agent("project one")], nothingDisabled);
    registry.applyPlugin(projectOtherHello, [agent("project two")], nothingDisabled);

    assert.deepEqual(ids(registry.resolvedBase("agent")), ["hello.agent"]);
    assert.deepEqual(ids(registry.resolvedForProject("p1", "agent")), ["hello.agent"]);
    assert.equal(registry.resolvedBase("agent")[0]?.source, "data");
    assert.equal(registry.resolvedForProject("p1", "agent")[0]?.source, "project:p1");
    assert.equal(registry.resolvedForProject("p2", "agent")[0]?.source, "project:p2");
    assert.deepEqual(registry.conflictsForProject("p1"), []);
  });

  it("uses the same project applicability for custom and event declarations", () => {
    const registry = createContributionRegistry();

    registry.applyPlugin(
      projectHello,
      [
        { kind: "custom", id: "panel" },
        { kind: "event", id: "task.created", payloadSchema: {} },
      ],
      nothingDisabled,
    );

    assert.deepEqual(ids(registry.resolvedBase()), []);
    assert.deepEqual(
      registry.resolvedForProject("p1").map((registration) => [registration.kind, registration.id]),
      [
        ["custom", "hello.panel"],
        ["event", "hello.task.created"],
      ],
    );
    assert.deepEqual(ids(registry.resolvedForProject("p2")), []);
  });

  it("keeps standalone short identifiers distinct from plugin-qualified identifiers", () => {
    const registry = createContributionRegistry();
    const review = standaloneSkill("review", "sovereign", "user");

    registry.applyStandalone(standalone("data:skills", 100, [file(review)]));
    registry.applyPlugin(
      { key: "data:github", id: "github", source: "data" },
      [{ kind: "custom", id: "review" }],
      nothingDisabled,
    );

    assert.deepEqual(ids(registry.resolvedBase()), ["github.review", "review"]);
  });

  it("lets the higher numeric precedence standalone root win", () => {
    const registry = createContributionRegistry();

    registry.applyStandalone(
      standalone("home:agents:skills", 100, [
        file(standaloneSkill("review", "agents", "user"), "/home/review/SKILL.md"),
      ]),
    );
    registry.applyStandalone(
      standalone("data:skills", 200, [
        file(standaloneSkill("review", "sovereign", "user"), "/data/review/SKILL.md"),
      ]),
    );

    assert.equal(registry.resolvedBase("skill")[0]?.source, "sovereign");
  });

  it("reports equal-rank standalone roots and marks both files invalid", () => {
    const registry = createContributionRegistry();
    const firstPath = "/project/.first/skills/review/SKILL.md";
    const secondPath = "/project/.second/skills/review/SKILL.md";

    registry.applyStandalone({
      rootKey: "project:p1:skills:first",
      source: "first",
      scope: "project",
      projectId: "p1",
      precedence: 300,
      contributions: [file(standaloneSkill("review", "first", "project", "p1"), firstPath)],
    });
    registry.applyStandalone({
      rootKey: "project:p1:skills:second",
      source: "second",
      scope: "project",
      projectId: "p1",
      precedence: 300,
      contributions: [file(standaloneSkill("review", "second", "project", "p1"), secondPath)],
    });

    assert.deepEqual(registry.resolvedForProject("p1", "skill"), []);
    assert.deepEqual(registry.conflictsForProject("p1"), [
      {
        id: "review",
        source: "first",
        plugins: [],
        standaloneRoots: ["project:p1:skills:first", "project:p1:skills:second"],
      },
    ]);
    assert.deepEqual(registry.conflictsForProject("p2"), []);

    const resources = registry.fileResourcesForProject("p1");
    assert.deepEqual(
      resources.resources.map((resource) => [resource.path, resource.state]),
      [
        [firstPath, "invalid"],
        [secondPath, "invalid"],
      ],
    );
    assert.deepEqual(
      resources.diagnostics.map((diagnostic) => [diagnostic.path, diagnostic.code]),
      [
        [firstPath, "duplicate-contribution"],
        [secondPath, "duplicate-contribution"],
      ],
    );
  });

  it("resolves plugin project over data over built-in", () => {
    const registry = createContributionRegistry();

    registry.applyPlugin(builtinHello, [agent("built-in")], nothingDisabled);
    assert.equal(registry.resolvedForProject("p1", "agent")[0]?.source, "builtin");
    registry.applyPlugin(dataHello, [agent("data")], nothingDisabled);
    assert.equal(registry.resolvedForProject("p1", "agent")[0]?.source, "data");
    registry.applyPlugin(projectHello, [agent("project")], nothingDisabled);
    assert.equal(registry.resolvedForProject("p1", "agent")[0]?.source, "project:p1");
  });

  it("does not conflict equal identifiers of different kinds", () => {
    const registry = createContributionRegistry();

    registry.applyPlugin(
      dataHello,
      [
        { kind: "custom", id: "same" },
        { kind: "event", id: "same", payloadSchema: {} },
      ],
      nothingDisabled,
    );

    assert.deepEqual(
      registry.resolvedBase().map((registration) => registration.kind),
      ["custom", "event"],
    );
    assert.deepEqual(registry.conflictsForProject("p1"), []);
  });

  it("excludes only a plugin identity duplicated by file and programmatic declarations", () => {
    const registry = createContributionRegistry();
    const fileAgent: Extract<ContributionRegistration, { kind: "agent" }> = {
      ownership: "plugin",
      kind: "agent",
      id: "hello.agent",
      declaredId: "agent",
      pluginKey: dataHello.key,
      pluginId: dataHello.id,
      source: dataHello.source,
      instructions: "from file",
      tools: { include: [], exclude: [] },
      skills: { include: [], exclude: [] },
    };
    const fileSkill: Extract<ContributionRegistration, { kind: "skill" }> = {
      ownership: "plugin",
      kind: "skill",
      id: "hello.review",
      declaredId: "review",
      pluginKey: dataHello.key,
      pluginId: dataHello.id,
      source: dataHello.source,
      name: "review",
      description: "Review changes",
      location: "/plugins/hello/skills/review/SKILL.md",
      disableModelInvocation: false,
    };

    const outcome = registry.applyPlugin({
      plugin: dataHello,
      contributions: [agent("programmatic")],
      fileContributions: [file(fileAgent), file(fileSkill)],
      disabledContributions: nothingDisabled,
    });

    assert.deepEqual(ids(outcome.registered), ["hello.review"]);
    assert.match(outcome.problems[0] ?? "", /declared 2 times/);
    assert.deepEqual(ids(registry.resolvedBase()), ["hello.review"]);
    assert.equal(
      registry
        .fileResourcesForProject("p1")
        .resources.find((resource) => resource.id === "hello.agent")?.state,
      "invalid",
    );
  });

  it("shows switched-off plugin files without resolving them", () => {
    const registry = createContributionRegistry();
    const registration: Extract<ContributionRegistration, { kind: "skill" }> = {
      ownership: "plugin",
      kind: "skill",
      id: "hello.review",
      declaredId: "review",
      pluginKey: dataHello.key,
      pluginId: dataHello.id,
      source: dataHello.source,
      name: "review",
      description: "Review changes",
      location: "/plugins/hello/skills/review/SKILL.md",
      disableModelInvocation: false,
    };

    registry.applyPlugin({
      plugin: dataHello,
      contributions: [],
      fileContributions: [file(registration, registration.location)],
      disabledContributions: new Set([registration.id]),
    });

    assert.deepEqual(registry.resolvedBase("skill"), []);
    assert.deepEqual(ids(registry.switchedOff()), ["hello.review"]);
    assert.equal(registry.fileResourcesForProject("p1").resources[0]?.state, "switched-off");
  });

  it("keeps invalid and shadowed files visible in the project snapshot", () => {
    const registry = createContributionRegistry();
    const lower = standaloneSkill("review", "agents", "project", "p1");
    const higher = standaloneSkill("review", "sovereign", "project", "p1");
    const invalidDiagnostic: FileResourceDiagnostic = {
      severity: "error",
      code: "invalid-frontmatter",
      message: "frontmatter is malformed",
      path: "/project/.sovereign/skills/broken/SKILL.md",
      kind: "skill",
      id: "broken",
    };

    registry.applyStandalone(
      standalone(
        "project:p1:skills:agents",
        300,
        [file(lower, "/project/.agents/skills/review/SKILL.md")],
        { scope: "project", projectId: "p1", source: "agents" },
      ),
    );
    registry.applyStandalone(
      standalone(
        "project:p1:skills:sovereign",
        400,
        [
          file(higher, "/project/.sovereign/skills/review/SKILL.md"),
          {
            path: invalidDiagnostic.path,
            diagnostics: [invalidDiagnostic],
            kind: "skill",
            id: "broken",
          },
        ],
        { scope: "project", projectId: "p1", source: "sovereign" },
      ),
    );

    const snapshot = registry.fileResourcesForProject("p1");

    assert.deepEqual(
      snapshot.resources.map((resource) => [resource.path, resource.state]),
      [
        ["/project/.agents/skills/review/SKILL.md", "shadowed"],
        ["/project/.sovereign/skills/broken/SKILL.md", "invalid"],
        ["/project/.sovereign/skills/review/SKILL.md", "active"],
      ],
    );
    assert.deepEqual(snapshot.diagnostics, [invalidDiagnostic]);
  });

  it("moves revision for observable snapshot changes and explicit file events only", () => {
    const registry = createContributionRegistry();
    const registration = standaloneAgent("code", "sovereign", "user");
    const snapshot = standalone("data:agents", 100, [file(registration, "/data/code/AGENT.md")]);

    registry.applyStandalone(snapshot);
    const first = registry.revision();
    registry.applyStandalone(snapshot);
    assert.equal(registry.revision(), first);

    registry.applyStandalone(snapshot, { resourceChanged: true });
    assert.equal(registry.revision(), first + 1);

    const diagnostic: FileResourceDiagnostic = {
      severity: "warning",
      code: "changed-warning",
      message: "warning changed",
      path: "/data/code/AGENT.md",
      kind: "agent",
      id: "code",
    };
    registry.applyStandalone(
      standalone("data:agents", 100, [file(registration, "/data/code/AGENT.md", [diagnostic])]),
    );
    assert.equal(registry.revision(), first + 2);

    registry.removeStandalone("data:agents");
    assert.equal(registry.revision(), first + 3);
  });

  it("moves revision once for an explicit plugin file event with unchanged declarations", () => {
    const registry = createContributionRegistry();
    const snapshot = {
      plugin: dataHello,
      contributions: [agent("programmatic")],
      fileContributions: [],
      disabledContributions: nothingDisabled,
    };

    registry.applyPlugin(snapshot);
    const beforeEvent = registry.revision();
    registry.applyPlugin(snapshot, { resourceChanged: true });

    assert.equal(registry.revision(), beforeEvent + 1);
  });

  it("validates malformed programmatic declarations without losing valid siblings", () => {
    const registry = createContributionRegistry();

    const outcome = registry.applyPlugin(
      dataHello,
      [
        { kind: "custom", id: "valid" },
        { kind: "agent", id: "broken", instructions: "   " },
      ],
      nothingDisabled,
    );

    assert.deepEqual(ids(outcome.registered), ["hello.valid"]);
    assert.equal(outcome.problems.length, 1);
  });

  it("removes plugin and standalone ownership snapshots atomically", () => {
    const registry = createContributionRegistry();

    registry.applyPlugin(dataHello, [{ kind: "custom", id: "panel" }], nothingDisabled);
    registry.applyStandalone(
      standalone("data:agents", 100, [file(standaloneAgent("code", "sovereign", "user"))]),
    );
    registry.removePlugin(dataHello.key);
    registry.removeStandalone("data:agents");

    assert.deepEqual(registry.resolvedBase(), []);
  });
});
