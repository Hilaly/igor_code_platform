import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { installTestHost } from "@sovereign/sdk/testing";

describe("the base agent plugin", () => {
  it("requires the model to read applicable project AGENTS.md files", () => {
    const prompt = readFileSync(new URL("../agents/agent/AGENT.md", import.meta.url), "utf8");

    assert.match(prompt, /read.*AGENTS\.md/isu);
    assert.match(prompt, /project root/iu);
    assert.match(prompt, /closer.*AGENTS\.md/isu);
    assert.match(prompt, /does not exist.*continue/isu);
  });

  it("keeps activation as a lifecycle point without contributing programmatically", async () => {
    const host = installTestHost({ id: "base-agent", source: "builtin" });

    // Порядок обязателен: сначала шов, потом импорт воркера (docs/plugins.md).
    const { activate } = await import("./worker.ts");

    await activate?.();

    assert.deepEqual(host.contributions, []);

    host.restore();
  });
});
