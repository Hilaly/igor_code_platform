import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";

import type { BusEvent } from "@sovereign/protocol";

import { createEventBus } from "../platform/public.ts";
import { createLogger } from "../platform/public.ts";
import { createContributionRegistry } from "./contribution-registry.ts";
import type { StandaloneResourceRoot } from "./file-resource-roots.ts";
import { createStandaloneFileResourceService } from "./standalone-file-resources.ts";

const workspace = mkdtempSync(join(tmpdir(), "sovereign-standalone-resources-"));

after(() => rmSync(workspace, { recursive: true, force: true }));

const validSkill = `---
name: review
description: Reviews a change
---
Read the change carefully.
`;
const malformedYaml = `---
name: [review
---
Broken.
`;
const logger = createLogger({ source: "core", level: () => "error", write: () => {} });

function skillRoot(directory: string, key = "project:p1:skills:sovereign"): StandaloneResourceRoot {
  return {
    key,
    source: "sovereign",
    scope: "project",
    projectId: "p1",
    kind: "skill",
    precedence: 400,
    directory,
  };
}

describe("createStandaloneFileResourceService", () => {
  it("atomically replaces a root snapshot across valid, invalid, and fixed states", async () => {
    const root = join(workspace, "snapshot", "skills");
    const definition = join(root, "review");
    const skillPath = join(definition, "SKILL.md");
    mkdirSync(definition, { recursive: true });
    writeFileSync(skillPath, validSkill);
    const registry = createContributionRegistry();
    const service = createStandaloneFileResourceService({
      roots: [skillRoot(root)],
      registry,
      logger,
    });

    await service.rescan();
    assert.deepEqual(
      registry.resolvedForProject("p1", "skill").map((item) => item.id),
      ["review"],
    );

    writeFileSync(skillPath, malformedYaml);
    await service.rescan();
    assert.deepEqual(registry.resolvedForProject("p1", "skill"), []);
    assert.equal(registry.fileResourcesForProject("p1").resources[0]?.state, "invalid");

    writeFileSync(skillPath, validSkill);
    await service.rescan();
    assert.deepEqual(
      registry.resolvedForProject("p1", "skill").map((item) => item.id),
      ["review"],
    );
    service.close();
  });

  it("publishes only complete root snapshots and advances an ordinary scan only on change", async () => {
    const root = join(workspace, "atomic", "skills");
    for (const name of ["alpha", "beta"]) {
      mkdirSync(join(root, name), { recursive: true });
      writeFileSync(
        join(root, name, "SKILL.md"),
        `---\nname: ${name}\ndescription: ${name} skill\n---\nUse ${name}.\n`,
      );
    }
    const registry = createContributionRegistry();
    const events: BusEvent[] = [];
    const bus = createEventBus({ onListenerError: (cause) => void Promise.reject(cause) });
    bus.subscribe((event) => events.push(event));
    const seen: string[][] = [];
    const originalApply = registry.applyStandalone;
    registry.applyStandalone = (snapshot, options) => {
      originalApply(snapshot, options);
      seen.push(registry.resolvedForProject("p1", "skill").map((item) => item.id));
    };
    const service = createStandaloneFileResourceService({
      roots: [skillRoot(root)],
      registry,
      logger,
      publishContributionChanges: () =>
        bus.publish("core.contributions.changed", { revision: registry.revision() }),
    });

    await service.rescan();
    const revision = registry.revision();
    await service.rescan();

    assert.deepEqual(seen, [
      ["alpha", "beta"],
      ["alpha", "beta"],
    ]);
    assert.equal(registry.revision(), revision);
    assert.deepEqual(events, [{ type: "core.contributions.changed", payload: { revision } }]);
    assert.equal(
      events.some((event) => event.type === "core.plugin.contributions"),
      false,
    );
    service.close();
  });

  it("publishes every changed root revision from one scan", async () => {
    const roots = ["alpha", "beta"].map((name) => {
      const root = join(workspace, "revision-per-root", name);
      const definition = join(root, name);
      mkdirSync(definition, { recursive: true });
      writeFileSync(
        join(definition, "SKILL.md"),
        `---\nname: ${name}\ndescription: ${name} skill\n---\nUse ${name}.\n`,
      );

      return skillRoot(root, `project:p1:skills:${name}`);
    });
    const registry = createContributionRegistry();
    const revisions: number[] = [];
    const service = createStandaloneFileResourceService({
      roots,
      registry,
      logger,
      publishContributionChanges: () => revisions.push(registry.revision()),
    });

    await service.rescan();

    assert.deepEqual(revisions, [1, 2]);
    service.close();
  });

  it("bumps revision once for one watcher event even when parsed entries stay unchanged", async () => {
    const root = join(workspace, "event", "skills");
    const definition = join(root, "review");
    mkdirSync(definition, { recursive: true });
    writeFileSync(join(definition, "SKILL.md"), validSkill);
    const registry = createContributionRegistry();
    const service = createStandaloneFileResourceService({
      roots: [skillRoot(root)],
      registry,
      logger,
    });
    await service.rescan();
    const revision = registry.revision();

    await service.rescan({ resourceChanged: true });

    assert.equal(registry.revision(), revision + 1);
    service.close();
  });

  it("removes roots that disappear during rearm", async () => {
    const root = join(workspace, "removed", "skills");
    const definition = join(root, "review");
    mkdirSync(definition, { recursive: true });
    writeFileSync(join(definition, "SKILL.md"), validSkill);
    const registry = createContributionRegistry();
    const service = createStandaloneFileResourceService({
      roots: [skillRoot(root)],
      registry,
      logger,
    });
    await service.rescan();

    await service.rearm([]);

    assert.deepEqual(registry.resolvedForProject("p1", "skill"), []);
    service.close();
  });

  it("does not discover definitions through a symbolic-link root", async () => {
    const external = join(workspace, "external-root");
    const definition = join(external, "review");
    const linkedRoot = join(workspace, "linked-root");
    mkdirSync(definition, { recursive: true });
    writeFileSync(join(definition, "SKILL.md"), validSkill);
    symlinkSync(external, linkedRoot);
    const registry = createContributionRegistry();
    const service = createStandaloneFileResourceService({
      roots: [skillRoot(linkedRoot)],
      registry,
      logger,
    });

    await service.rescan();

    assert.deepEqual(registry.resolvedForProject("p1", "skill"), []);
    service.close();
  });
});
