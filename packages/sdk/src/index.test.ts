import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { clearEventHandlers } from "./events.ts";
import { removePluginHost } from "./host.ts";
import { contribute, defineEvent, events, identity, log, z } from "./index.ts";
import { installTestHost } from "./testing.ts";

afterEach(() => {
  clearEventHandlers();
  removePluginHost();
});

describe("the zod re-exported by the sdk", () => {
  it("describes a schema as data, which is the only form that reaches the core", () => {
    const description = z.toJSONSchema(z.object({ id: z.string() }));

    // Схема сама по себе не клонируется — в ней функции. Уезжает описание, и оно обязано пережить
    // структурное клонирование, иначе объявление вклада не дойдёт до демона (ADR-0072).
    assert.deepEqual(structuredClone(description), description);
  });
});

describe("the sdk without a host", () => {
  it("explains itself instead of failing on undefined", async () => {
    const taskCreated = defineEvent("task.created", z.object({ id: z.string() }));

    await assert.rejects(() => log.info("hello"), /sdk is not initialised/);
    await assert.rejects(() => contribute.custom({ id: "board" }), /sdk is not initialised/);
    await assert.rejects(() => contribute.event(taskCreated), /sdk is not initialised/);
    await assert.rejects(() => taskCreated.publish({ id: "42" }), /sdk is not initialised/);
    await assert.rejects(
      () => events.subscribe("tracker.task.created", () => {}),
      /sdk is not initialised/,
    );
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
      { kind: "custom", id: "board", title: "Board", payload: { columns: 3 } },
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
    assert.deepEqual(host.contributions, [{ kind: "custom", id: "board", title: "Board" }]);
  });
});

describe("a declared event", () => {
  const taskCreated = defineEvent(
    "task.created",
    z.object({ id: z.string(), title: z.string().optional() }),
  );

  it("is declared as a contribution with its schema as data", async () => {
    const host = installTestHost({ id: "tracker" });

    await contribute.event(taskCreated);

    assert.deepEqual(host.contributions, [
      {
        kind: "event",
        id: "task.created",
        payloadSchema: z.toJSONSchema(taskCreated.schema),
      },
    ]);
  });

  it("keeps the schema at hand, so a subscriber importing the descriptor can check the payload", () => {
    installTestHost({ id: "tracker" });

    assert.equal(taskCreated.schema.safeParse({ id: "42" }).success, true);
    assert.equal(taskCreated.schema.safeParse({ id: 42 }).success, false);
  });

  it("publishes a payload that matches the schema", async () => {
    const host = installTestHost({ id: "tracker" });

    await taskCreated.publish({ id: "42" });

    assert.deepEqual(host.published, [{ declaredId: "task.created", payload: { id: "42" } }]);
  });

  it("refuses a payload that does not match, and sends nothing", async () => {
    const host = installTestHost({ id: "tracker" });

    await assert.rejects(
      // @ts-expect-error — автор ошибся в типе; проверка обязана поймать это и в рантайме.
      () => taskCreated.publish({ id: 42 }),
      /the payload of the event task\.created does not match its schema/,
    );

    assert.deepEqual(host.published, []);
  });
});

describe("a subscription", () => {
  it("tells the core the full name once and delivers to every handler", async () => {
    const host = installTestHost({ id: "automation" });
    const seen: unknown[] = [];

    await events.subscribe("tracker.task.created", (payload) => {
      seen.push(payload);
    });
    await events.subscribe("tracker.task.created", (payload, origin) => {
      seen.push(origin?.id ?? payload);
    });

    await host.deliver(
      "tracker.task.created",
      { id: "42" },
      { key: "data:tracker", id: "tracker", source: "data" },
    );

    assert.deepEqual(host.subscriptions, ["tracker.task.created"]);
    assert.deepEqual(seen, [{ id: "42" }, "tracker"]);
  });

  it("stops delivering after the unsubscribe it returned", async () => {
    const host = installTestHost({ id: "automation" });
    const seen: unknown[] = [];

    const unsubscribe = await events.subscribe("tracker.task.created", (payload) => {
      seen.push(payload);
    });

    await unsubscribe();
    await host.deliver("tracker.task.created", { id: "42" });

    assert.deepEqual(seen, []);
    assert.deepEqual(host.subscriptions, []);
  });

  it("keeps the name subscribed while another handler still wants it", async () => {
    const host = installTestHost({ id: "automation" });
    const seen: unknown[] = [];

    const unsubscribe = await events.subscribe("tracker.task.created", () => {
      seen.push("first");
    });
    await events.subscribe("tracker.task.created", () => {
      seen.push("second");
    });

    await unsubscribe();
    await host.deliver("tracker.task.created", { id: "42" });

    assert.deepEqual(host.subscriptions, ["tracker.task.created"]);
    assert.deepEqual(seen, ["second"]);
  });

  it("reports a handler that threw instead of losing it, and delivers to the rest", async () => {
    const host = installTestHost({ id: "automation" });
    const seen: unknown[] = [];

    await events.subscribe("tracker.task.created", () => {
      throw new Error("the handler is broken");
    });
    await events.subscribe("tracker.task.created", () => {
      seen.push("second");
    });

    await host.deliver("tracker.task.created", { id: "42" });

    assert.deepEqual(seen, ["second"]);
    assert.equal(host.logs.at(-1)?.level, "error");
    assert.match(String(host.logs.at(-1)?.fields?.["reason"]), /the handler is broken/);
  });
});
