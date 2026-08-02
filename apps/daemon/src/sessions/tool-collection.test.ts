import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createCoreTools } from "@sovereign/agent-runtime-pi";

import { coreToolSource } from "./core-tools.ts";
import { createToolCollector, type CollectedTool, type ToolSource } from "./tool-collection.ts";

const context = { projectId: "p1", folder: "/tmp/project" };

const source = (id: string, tools: CollectedTool[]): ToolSource => ({ id, collect: () => tools });

const tool = (name: string, group: string, order: number): CollectedTool => ({
  name,
  group,
  order,
  tool: { name },
});

describe("createToolCollector", () => {
  it("sorts by group, then order, then name, whatever the order of registration", async () => {
    const collector = createToolCollector();

    collector.register(source("second", [tool("zeta", "plugin", 10), tool("alpha", "plugin", 10)]));
    collector.register(source("first", [tool("write", "core", 30), tool("bash", "core", 10)]));

    const collected = await collector.collect(context);

    // Порядок детерминирован: появление нового плагина не переставляет уже существующее.
    assert.deepEqual(
      collected.tools.map((entry) => entry.name),
      ["bash", "write", "alpha", "zeta"],
    );
    assert.deepEqual(collected.problems, []);
  });

  it("applies neither tool when two sources claim one name", async () => {
    const collector = createToolCollector();

    collector.register(source("core", [tool("bash", "core", 10)]));
    collector.register(source("plugin", [tool("bash", "shell-plugin", 10)]));

    const collected = await collector.collect(context);

    assert.deepEqual(collected.tools, []);
    assert.equal(collected.problems.length, 1);
    assert.match(collected.problems[0] ?? "", /bash/);
    assert.match(collected.problems[0] ?? "", /shell-plugin/);
  });

  it("keeps collecting when a source fails, and names it", async () => {
    const collector = createToolCollector();

    collector.register({
      id: "broken",
      collect: () => {
        throw new Error("воркер не ответил");
      },
    });
    collector.register(source("core", [tool("bash", "core", 10)]));

    const collected = await collector.collect(context);

    assert.deepEqual(
      collected.tools.map((entry) => entry.name),
      ["bash"],
    );
    assert.match(collected.problems[0] ?? "", /broken/);
  });

  it("forgets a source that was taken away", async () => {
    const collector = createToolCollector();
    const remove = collector.register(source("plugin", [tool("extra", "plugin", 10)]));

    remove();

    assert.deepEqual((await collector.collect(context)).tools, []);
  });

  it("passes the project identity and folder to every source", async () => {
    const collector = createToolCollector();
    const seen: unknown[] = [];

    collector.register({
      id: "context-recorder",
      collect: (received) => (seen.push(received), []),
    });
    await collector.collect(context);

    assert.deepEqual(seen, [{ projectId: "p1", folder: "/tmp/project" }]);
  });
});

describe("coreToolSource", () => {
  it("gives the four tools that come from the runtime", async () => {
    const collector = createToolCollector();

    collector.register(coreToolSource());

    const collected = await collector.collect(context);

    assert.deepEqual(
      collected.tools.map((entry) => entry.name),
      ["bash", "read", "write", "edit"],
    );
    assert.equal(collected.tools.length, createCoreTools().length);
    assert.deepEqual(collected.problems, []);
  });
});
