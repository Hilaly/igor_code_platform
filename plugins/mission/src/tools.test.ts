import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { installTestHost, type PluginTestHost } from "@sovereign/sdk/testing";

import { contributeTools } from "./tools.ts";

let host: PluginTestHost | undefined;

afterEach(() => {
  host?.restore();
  host = undefined;
});

describe("mission-update", () => {
  it("uses the invocation session and publishes after writing", async () => {
    host = installTestHost({ id: "mission" });
    await contributeTools();

    const outcome = await host.callTool(
      "mission-update",
      { mission: "Ship", plan: [{ step: "Test", status: "completed" }] },
      { sessionId: "session-42" },
    );

    assert.equal(outcome.isError, false);
    assert.match(outcome.content, /revision 1/u);
    assert.deepEqual(host.published, [
      { declaredId: "changed", payload: { sessionId: "session-42", revision: 1 } },
    ]);
    assert.equal((host.stored.get("mission.session-42") as { mission: string }).mission, "Ship");
  });

  it("rejects invalid input before writing or publishing", async () => {
    host = installTestHost({ id: "mission" });
    await contributeTools();

    await assert.rejects(() =>
      host!.callTool("mission-update", { mission: "", plan: [] }, { sessionId: "s" }),
    );
    assert.equal(host.stored.size, 0);
    assert.deepEqual(host.published, []);
  });
});
