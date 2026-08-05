import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  isPluginBusEvent,
  type BusEvent,
  type LogRecord,
  type PluginSource,
} from "@sovereign/protocol";

import { createEventBus } from "../platform/public.ts";
import { createLogger } from "../platform/public.ts";
import { createHookDispatcher, type HookAnswer, type HookSubscription } from "./hook-dispatch.ts";

const timeout = 5_000;
const audience = { projectId: "p1" };

function world() {
  const records: LogRecord[] = [];
  const events: BusEvent[] = [];
  const bus = createEventBus({
    onListenerError: (cause) => {
      throw cause;
    },
  });

  bus.subscribe((event) => events.push(event));

  return {
    records,
    events,
    /** Только события ядра: подписок плагинов в этих тестах нет вовсе. */
    timeouts: () =>
      events.flatMap((event) =>
        !isPluginBusEvent(event) && event.type === "core.hook.timed-out" ? [event.payload] : [],
      ),
    dispatcher: createHookDispatcher({
      logger: createLogger({
        source: "core",
        level: () => "debug",
        write: (record) => records.push(record),
      }),
      bus,
      timeoutMilliseconds: () => timeout,
    }),
  };
}

type Answered = {
  contributionId: string;
  event?: string;
  criticality?: HookSubscription["criticality"];
  source?: PluginSource;
  answer: (payload: unknown) => HookAnswer | Promise<HookAnswer>;
};

const subscription = (answered: Answered): HookSubscription => ({
  contributionId: answered.contributionId,
  event: answered.event ?? "before_session_start",
  criticality: answered.criticality ?? "advisory",
  source: answered.source ?? "data",
  invoke: async (payload) => answered.answer(payload),
});

const value = (result: unknown) => (): HookAnswer => ({ kind: "value", value: result });
const nothing = value(undefined);
const refusing = (reason: string) => (): HookAnswer => ({ kind: "refused", reason });
const timingOut = (): HookAnswer => ({ kind: "timed-out" });

describe("createHookDispatcher", () => {
  it("knows whether anybody is subscribed, and forgets the subscription that was taken back", () => {
    const { dispatcher } = world();

    const remove = dispatcher.register(subscription({ contributionId: "one", answer: nothing }));

    assert.equal(dispatcher.subscribed("before_session_start", audience), true);
    assert.equal(dispatcher.subscribed("turn_finished", audience), false);

    remove();

    assert.equal(dispatcher.subscribed("before_session_start", audience), false);
  });

  it("asks every subscriber of a deciding hook and keeps every refusal", async () => {
    const { dispatcher } = world();

    dispatcher.register(subscription({ contributionId: "budget", answer: refusing("нет денег") }));
    dispatcher.register(
      subscription({ contributionId: "hours", answer: refusing("нерабочее время") }),
    );
    dispatcher.register(subscription({ contributionId: "quiet", answer: nothing }));

    // Конфликт двух честных политик обязан быть виден целиком: первый попавшийся отказ выглядел бы
    // как единственная причина (docs/hooks.md).
    assert.deepEqual(
      await dispatcher.decide("before_session_start", { projectId: "p1" }, audience),
      {
        refusals: [
          { contributionId: "budget", reason: "нет денег" },
          { contributionId: "hours", reason: "нерабочее время" },
        ],
      },
    );
  });

  it("calls a deciding hook without refusals allowed", async () => {
    const { dispatcher } = world();

    dispatcher.register(subscription({ contributionId: "quiet", answer: nothing }));

    // Разрешение — это отсутствие отказа, а не чей-то голос «за».
    assert.deepEqual(await dispatcher.decide("before_session_start", {}, audience), {
      refusals: [],
    });
  });

  it("turns a timeout of a deciding hook into a refusal, whatever the mark", async () => {
    const { dispatcher, timeouts, records } = world();

    dispatcher.register(
      subscription({ contributionId: "slow", criticality: "advisory", answer: timingOut }),
    );

    const decision = await dispatcher.decide("before_session_start", {}, audience);

    assert.deepEqual(decision.refusals, [
      { contributionId: "slow", reason: `the subscription did not answer in ${timeout} ms` },
    ]);

    // Таймаут не бывает молчаливым: он и в шине, и в журнале, и в обоих назван автор.
    assert.deepEqual(timeouts(), [
      {
        contributionId: "slow",
        event: "before_session_start",
        criticality: "advisory",
        outcome: "refused",
        waitedMilliseconds: timeout,
      },
    ]);
    assert.equal(records.at(-1)?.message, "the hook subscription did not answer in time");
  });

  it("reports a subscriber that failed and lets the rest decide", async () => {
    const { dispatcher, records } = world();

    dispatcher.register(
      subscription({
        contributionId: "broken",
        answer: () => {
          throw new Error("the handler is broken");
        },
      }),
    );
    dispatcher.register(subscription({ contributionId: "budget", answer: refusing("нет денег") }));

    const decision = await dispatcher.decide("before_session_start", {}, audience);

    // Сбой — не отказ: он не запрещает, а означает, что спросить не удалось.
    assert.deepEqual(decision.refusals, [{ contributionId: "budget", reason: "нет денег" }]);
    assert.equal(
      records.some(
        (record) =>
          record.message === "the hook subscription failed" && record["contribution"] === "broken",
      ),
      true,
    );
  });

  it("does not wait for an observer and reports the one that failed", async () => {
    const { dispatcher, records } = world();
    const seen: unknown[] = [];
    let released: (() => void) | undefined;

    dispatcher.register(
      subscription({
        contributionId: "hangs",
        event: "turn_finished",
        answer: () =>
          new Promise<HookAnswer>((resolve) => {
            released = () => resolve({ kind: "value", value: undefined });
          }),
      }),
    );
    dispatcher.register(
      subscription({
        contributionId: "watches",
        event: "turn_finished",
        answer: (payload) => {
          seen.push(payload);

          throw new Error("the observer is broken");
        },
      }),
    );

    // Возврата ждать не надо: наблюдателя не ждут вовсе, поэтому вызов синхронный (docs/hooks.md).
    dispatcher.observe("turn_finished", { sessionId: "0199" }, audience);

    await Promise.resolve();
    await Promise.resolve();

    assert.deepEqual(seen, [{ sessionId: "0199" }]);
    assert.equal(
      records.some(
        (record) =>
          record.message === "the hook subscription failed" && record["contribution"] === "watches",
      ),
      true,
    );

    released?.();
  });

  it("feeds the output of one rewriting subscriber to the next, in the order of source and identifier", async () => {
    const { dispatcher } = world();
    const seen: string[] = [];

    dispatcher.register(
      subscription({
        contributionId: "second",
        event: "context",
        source: "data",
        answer: (payload) => {
          seen.push(String((payload as { messages: string[] }).messages.join("|")));

          return { kind: "value", value: { messages: ["собрано вторым"] } };
        },
      }),
    );
    dispatcher.register(
      subscription({
        contributionId: "first",
        event: "context",
        source: "builtin",
        answer: (payload) => {
          seen.push(String((payload as { messages: string[] }).messages.join("|")));

          return { kind: "value", value: { messages: ["собрано первым"] } };
        },
      }),
    );

    const rewritten = await dispatcher.rewrite(
      "context",
      {
        type: "context",
        messages: ["исходное"],
      },
      audience,
    );

    // Порядок — ранг источника, затем идентификатор: встроенный говорит первым, последнее слово за
    // более частным источником (docs/hooks.md).
    assert.deepEqual(seen, ["исходное", "собрано первым"]);
    assert.deepEqual(rewritten.payload, { type: "context", messages: ["собрано вторым"] });
    assert.deepEqual(rewritten.patch, { messages: ["собрано вторым"] });
  });

  it("leaves the payload alone when nobody changed anything", async () => {
    const { dispatcher } = world();
    const payload = { type: "context", messages: ["исходное"] };

    dispatcher.register(
      subscription({ contributionId: "quiet", event: "context", answer: nothing }),
    );

    const rewritten = await dispatcher.rewrite("context", payload, audience);

    // Отказ от изменения — это вернуть ничего; отдельного способа сказать «я ничего не меняю» нет.
    assert.equal(rewritten.payload, payload);
    assert.equal(rewritten.patch, undefined);
  });

  it("keeps a field the payload does not have out of the next subscriber", async () => {
    const { dispatcher } = world();
    const seen: unknown[] = [];

    dispatcher.register(
      subscription({
        contributionId: "canceller",
        event: "session_before_compact",
        source: "builtin",
        answer: value({ cancel: true }),
      }),
    );
    dispatcher.register(
      subscription({
        contributionId: "watcher",
        event: "session_before_compact",
        source: "data",
        answer: (payload) => {
          seen.push(payload);

          return { kind: "value", value: undefined };
        },
      }),
    );

    const rewritten = await dispatcher.rewrite(
      "session_before_compact",
      {
        type: "session_before_compact",
        customInstructions: "коротко",
      },
      audience,
    );

    // Ответ рантайма — поправка, а не та же форма: `cancel` у события не бывает, и дописывать его в
    // нагрузку значило бы отдать следующему подписчику событие, которого у Pi нет.
    assert.deepEqual(seen, [{ type: "session_before_compact", customInstructions: "коротко" }]);
    assert.deepEqual(rewritten.patch, { cancel: true });
  });

  it("skips the change of a non-critical subscriber that timed out and goes on with the chain", async () => {
    const { dispatcher, timeouts } = world();

    dispatcher.register(
      subscription({
        contributionId: "slow",
        event: "context",
        source: "builtin",
        criticality: "advisory",
        answer: timingOut,
      }),
    );
    dispatcher.register(
      subscription({
        contributionId: "quick",
        event: "context",
        source: "data",
        answer: value({ messages: ["дописано"] }),
      }),
    );

    const rewritten = await dispatcher.rewrite(
      "context",
      { type: "context", messages: ["было"] },
      audience,
    );

    assert.deepEqual(rewritten.patch, { messages: ["дописано"] });
    assert.deepEqual(rewritten.aborted, undefined);
    assert.deepEqual(
      timeouts().map((timedOut) => [timedOut.contributionId, timedOut.outcome]),
      [["slow", "skipped"]],
    );
  });

  it("stops the chain when a critical subscriber times out, and names it", async () => {
    const { dispatcher, timeouts } = world();
    const seen: unknown[] = [];

    dispatcher.register(
      subscription({
        contributionId: "slow",
        event: "context",
        source: "builtin",
        criticality: "critical",
        answer: timingOut,
      }),
    );
    dispatcher.register(
      subscription({
        contributionId: "never-asked",
        event: "context",
        source: "data",
        answer: (payload) => {
          seen.push(payload);

          return { kind: "value", value: undefined };
        },
      }),
    );

    const rewritten = await dispatcher.rewrite(
      "context",
      { type: "context", messages: ["было"] },
      audience,
    );

    // Турн обрывает тот, кто звал: способ оборвать зависит от рантайма, диспетчер о нём не знает.
    assert.deepEqual(rewritten.aborted, {
      contributionId: "slow",
      reason: `the critical subscription did not answer in ${timeout} ms`,
    });
    assert.deepEqual(seen, []);
    assert.deepEqual(
      timeouts().map((timedOut) => [timedOut.contributionId, timedOut.outcome]),
      [["slow", "aborted-the-turn"]],
    );
  });

  it("reports a refusal of a rewriting subscriber instead of acting on it", async () => {
    const { dispatcher, records } = world();

    dispatcher.register(
      subscription({ contributionId: "confused", event: "context", answer: refusing("не хочу") }),
    );

    const rewritten = await dispatcher.rewrite(
      "context",
      { type: "context", messages: [] },
      audience,
    );

    // Перезаписывающему хуку отказывать нечему: запрещать действие умеет решающий.
    assert.equal(rewritten.patch, undefined);
    assert.equal(
      records.some(
        (record) =>
          record.message === "the hook subscription failed" &&
          String(record["reason"]).includes("cannot refuse"),
      ),
      true,
    );
  });

  it("keeps the subscription of a plugin of one project out of the sessions of another", async () => {
    const { dispatcher } = world();

    dispatcher.register(
      subscription({ contributionId: "ours", source: "project:p1", answer: refusing("нельзя") }),
    );
    dispatcher.register(
      subscription({
        contributionId: "theirs",
        source: "project:p2",
        answer: refusing("тоже нельзя"),
      }),
    );
    dispatcher.register(
      subscription({ contributionId: "everywhere", source: "data", answer: nothing }),
    );

    // Применимость та же, что у остальных вкладов: плагин из папки проекта живёт в своём проекте.
    assert.deepEqual(await dispatcher.decide("before_session_start", {}, { projectId: "p1" }), {
      refusals: [{ contributionId: "ours", reason: "нельзя" }],
    });
    assert.equal(dispatcher.subscribed("before_session_start", { projectId: "p3" }), true);
    assert.deepEqual(await dispatcher.decide("before_session_start", {}, { projectId: "p3" }), {
      refusals: [],
    });
  });
});
