import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { installTestHost, type PluginTestHost } from "@sovereign/sdk/testing";

let host: PluginTestHost | undefined;

afterEach(() => {
  host?.restore();
  host = undefined;
});

describe("mission worker", () => {
  it("declares the changed event, tool, and protected snapshot route", async () => {
    host = installTestHost({ id: "mission", source: "builtin" });
    const { activate } = await import("./worker.ts");

    await activate();

    assert.deepEqual(
      host.contributions.map((contribution) => [contribution.kind, contribution.id]),
      [
        ["event", "changed"],
        ["tool", "mission-update"],
        ["route", "snapshot"],
        ["component", "panel"],
      ],
    );
  });
});
