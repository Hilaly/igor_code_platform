import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { installTestHost } from "@sovereign/sdk/testing";

describe("the starter plugin", () => {
  it("keeps activation as a lifecycle point without contributing programmatically", async () => {
    const host = installTestHost({ id: "starter", source: "builtin" });

    // Порядок обязателен: сначала шов, потом импорт воркера (docs/plugins.md).
    const { activate } = await import("./worker.ts");

    await activate?.();

    assert.deepEqual(host.contributions, []);

    host.restore();
  });
});
