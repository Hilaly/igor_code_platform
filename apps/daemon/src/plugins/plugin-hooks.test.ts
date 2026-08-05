import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { PluginContribution } from "@sovereign/sdk";

import { createContributionRegistry, type ContributingPlugin } from "./contribution-registry.ts";
import { createEventBus } from "../platform/public.ts";
import { createLogger } from "../platform/public.ts";
import { createHookDispatcher } from "../sessions/public.ts";
import { createPluginHooks } from "./plugin-hooks.ts";
import type { PluginCallOutcome } from "./plugin-supervisor.ts";
import type { PluginCall } from "./plugin-wire.ts";

const guard: ContributingPlugin = { key: "data:guard", id: "guard", source: "data" };
const audience = { projectId: "p1" };
const timeout = 5_000;

const watch: PluginContribution = { kind: "hook", id: "watch", event: "before_session_start" };

function world(
  answer: (call: PluginCall) => PluginCallOutcome = () => ({
    kind: "value",
    value: undefined,
  }),
) {
  const asked: { pluginKey: string; call: PluginCall; timeoutMilliseconds: number }[] = [];
  const registry = createContributionRegistry();
  const dispatcher = createHookDispatcher({
    logger: createLogger({ source: "core", level: () => "debug", write: () => {} }),
    bus: createEventBus({
      onListenerError: (cause) => {
        throw cause;
      },
    }),
    timeoutMilliseconds: () => timeout,
  });
  const hooks = createPluginHooks({
    registry,
    plugins: {
      call: async (pluginKey, call, waiting) => {
        asked.push({ pluginKey, call, timeoutMilliseconds: waiting.timeoutMilliseconds });

        return answer(call);
      },
    },
    dispatcher,
    timeoutMilliseconds: () => timeout,
  });

  return { asked, registry, dispatcher, hooks };
}

describe("the subscriptions of plugins in the dispatcher", () => {
  it("registers what the registry says and forgets what it stopped saying", () => {
    const { registry, dispatcher, hooks } = world();

    registry.applyPlugin(guard, [watch], new Set());
    hooks.sync();

    assert.equal(dispatcher.subscribed("before_session_start", audience), true);

    // Выключенный человеком вклад — не подписка: реестр его не отдаёт, и подписчика быть не должно.
    registry.applyPlugin(guard, [watch], new Set(["guard.watch"]));
    hooks.sync();

    assert.equal(dispatcher.subscribed("before_session_start", audience), false);

    registry.applyPlugin(guard, [watch], new Set());
    hooks.sync();
    // Повторная сверка ничего не меняет: она идемпотентна, иначе подписок стало бы две.
    hooks.sync();

    assert.equal(dispatcher.subscribed("before_session_start", audience), true);
  });

  it("moves the subscription when the plugin came back with another event", async () => {
    const { registry, dispatcher, hooks, asked } = world();

    registry.applyPlugin(guard, [watch], new Set());
    hooks.sync();
    registry.applyPlugin(
      guard,
      [{ kind: "hook", id: "watch", event: "turn_finished", criticality: "critical" }],
      new Set(),
    );
    hooks.sync();

    assert.equal(dispatcher.subscribed("before_session_start", audience), false);
    assert.equal(dispatcher.subscribed("turn_finished", audience), true);

    dispatcher.observe("turn_finished", { sessionId: "0199" }, audience);
    await Promise.resolve();
    await Promise.resolve();

    assert.deepEqual(asked, [
      {
        pluginKey: "data:guard",
        // Воркер ключует обработчики объявленным идентификатором: неймспейс ставит ядро.
        call: {
          kind: "hook",
          contributionId: "watch",
          event: "turn_finished",
          payload: { sessionId: "0199" },
        },
        timeoutMilliseconds: timeout,
      },
    ]);
  });

  it("carries a refusal of the plugin to the dispatcher as a refusal", async () => {
    const { registry, dispatcher, hooks } = world(() => ({
      kind: "refused",
      reason: "эта папка закрыта",
    }));

    registry.applyPlugin(guard, [watch], new Set());
    hooks.sync();

    assert.deepEqual(await dispatcher.decide("before_session_start", {}, audience), {
      refusals: [{ contributionId: "guard.watch", reason: "эта папка закрыта" }],
    });
  });

  it("keeps a timeout a timeout, so criticality can be read from it", async () => {
    const { registry, dispatcher, hooks } = world(() => ({
      kind: "timed-out",
      waitedMilliseconds: timeout,
    }));

    registry.applyPlugin(guard, [watch], new Set());
    hooks.sync();

    const decision = await dispatcher.decide("before_session_start", {}, audience);

    // Таймаут доезжает своим видом, а не сбоем: у сбоя и таймаута разные исходы (docs/hooks.md).
    assert.deepEqual(decision.refusals, [
      { contributionId: "guard.watch", reason: `the subscription did not answer in ${timeout} ms` },
    ]);
  });
});
