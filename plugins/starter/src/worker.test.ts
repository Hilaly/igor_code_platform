import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { installTestHost } from "@sovereign/sdk/testing";

describe("the starter plugin", () => {
  it("requires the model to read applicable project AGENTS.md files", () => {
    const prompt = readFileSync(new URL("../agents/generic/AGENT.md", import.meta.url), "utf8");

    assert.match(prompt, /read.*AGENTS\.md/isu);
    assert.match(prompt, /project.*root/isu);
    assert.match(prompt, /closer.*AGENTS\.md/isu);
    assert.match(prompt, /absent.*continue/isu);
  });

  it("keeps activation as a lifecycle point without contributing programmatically", async () => {
    const host = installTestHost({ id: "starter", source: "builtin" });

    // Порядок обязателен: сначала шов, потом импорт воркера (docs/plugins.md).
    const { activate } = await import("./worker.ts");

    await activate?.();

    assert.deepEqual(host.contributions, []);

    host.restore();
  });
});
