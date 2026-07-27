import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { removePluginHost } from "./host.ts";
import { contribute, identity, log } from "./index.ts";
import { installTestHost } from "./testing.ts";

afterEach(() => removePluginHost());

describe("the sdk without a host", () => {
  it("explains itself instead of failing on undefined", async () => {
    await assert.rejects(() => log.info("hello"), /sdk is not initialised/);
    await assert.rejects(() => contribute.custom({ id: "board" }), /sdk is not initialised/);
    assert.throws(() => identity(), /sdk is not initialised/);
  });
});

describe("the testing seam", () => {
  it("records log calls with their level and fields", async () => {
    const host = installTestHost({ id: "hello" });

    await log.warn("something is off", { attempt: 2 });
    await log.debug("details");

    assert.deepEqual(host.logs, [
      { level: "warn", message: "something is off", fields: { attempt: 2 } },
      { level: "debug", message: "details" },
    ]);
  });

  it("records contributions as the plugin declared them", async () => {
    const host = installTestHost();

    await contribute.custom({ id: "board", title: "Board", payload: { columns: 3 } });

    assert.deepEqual(host.contributions, [
      { id: "board", title: "Board", payload: { columns: 3 } },
    ]);
  });

  it("tells the plugin who it is", () => {
    installTestHost({ id: "hello", source: "builtin" });

    assert.deepEqual(identity(), { id: "hello", source: "builtin" });
  });

  it("is removed by restore, so the next test starts without a host", async () => {
    const host = installTestHost();
    host.restore();

    await assert.rejects(() => log.info("hello"), /sdk is not initialised/);
  });

  it("serves a plugin imported after the seam is installed", async () => {
    const host = installTestHost({ id: "hello" });
    const plugin = await import("./testing-fixture.ts");

    await plugin.activate();

    assert.deepEqual(host.logs, [{ level: "info", message: "hello is up" }]);
    assert.deepEqual(host.contributions, [{ id: "board", title: "Board" }]);
  });
});
