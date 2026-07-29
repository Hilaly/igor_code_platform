import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createTurnQueue } from "./turn-queue.ts";

/** Работа, которую тест доигрывает вручную: без этого «второй ждёт первого» проверить нечем. */
function pending() {
  let finish = (): void => undefined;
  const started: boolean[] = [];
  const promise = new Promise<void>((resolve) => {
    finish = resolve;
  });

  return {
    started,
    finish,
    run: async (): Promise<void> => {
      started.push(true);
      await promise;
    },
  };
}

const settle = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

function admitted(place: ReturnType<ReturnType<typeof createTurnQueue>["submit"]>) {
  assert.equal(place.kind, "accepted");

  return place;
}

describe("createTurnQueue", () => {
  it("starts a turn at once while there is room", async () => {
    const queue = createTurnQueue({ limit: () => 2 });
    const work = pending();

    const place = admitted(queue.submit({ sessionId: "s1", kind: "turn", run: work.run }));

    await settle();

    assert.equal(place.state, "running");
    assert.deepEqual(queue.size(), { running: 1, queued: 0 });
    assert.equal(queue.stateOf("s1"), "running");

    work.finish();
    await settle();

    assert.equal(queue.stateOf("s1"), "idle");
  });

  it("refuses a second turn for a session that already owns a place", async () => {
    const queue = createTurnQueue({ limit: () => 1 });
    const first = pending();
    const second = pending();

    queue.submit({ sessionId: "s1", kind: "turn", run: first.run });
    const duplicate = queue.submit({ sessionId: "s1", kind: "turn", run: second.run });

    await settle();

    assert.deepEqual(duplicate, { kind: "busy" });
    assert.deepEqual(queue.size(), { running: 1, queued: 0 });
    assert.deepEqual(second.started, []);

    first.finish();
    await settle();
  });

  it("keeps a cancelled reservation owned until validation releases it", () => {
    const queue = createTurnQueue({ limit: () => 1 });
    const reservation = queue.reserve("s1");

    assert.equal(reservation.kind, "accepted");
    assert.equal(reservation.cancel(), true);
    assert.deepEqual(queue.reserve("s1"), { kind: "busy" });
    assert.equal(queue.stateOf("s1"), "idle");

    reservation.release();

    const retry = queue.reserve("s1");

    assert.equal(retry.kind, "accepted");
    retry.release();
  });

  it("makes the turn over the limit wait, and starts it when the room frees up", async () => {
    const queue = createTurnQueue({ limit: () => 1 });
    const first = pending();
    const second = pending();

    queue.submit({ sessionId: "s1", kind: "turn", run: first.run });

    const waiting = admitted(queue.submit({ sessionId: "s2", kind: "turn", run: second.run }));

    await settle();

    // Ожидание — наблюдаемое состояние сессии, а не пауза внутри вызова
    // (docs/architecture.md).
    assert.equal(waiting.state, "queued");
    assert.equal(queue.stateOf("s2"), "queued");
    assert.deepEqual(second.started, []);

    first.finish();
    await settle();

    assert.deepEqual(second.started, [true]);
    assert.equal(queue.stateOf("s2"), "running");

    second.finish();
    await settle();
  });

  it("reads the limit again on every start, so the config applies live", async () => {
    let limit = 1;
    const queue = createTurnQueue({ limit: () => limit });
    const first = pending();
    const second = pending();
    const third = pending();

    queue.submit({ sessionId: "s1", kind: "turn", run: first.run });
    queue.submit({ sessionId: "s2", kind: "turn", run: second.run });
    await settle();

    assert.deepEqual(second.started, []);

    // Предел поднят на живой очереди: пересоздавать её не нужно, значение спрашивается заново.
    limit = 3;
    queue.submit({ sessionId: "s3", kind: "turn", run: third.run });
    await settle();

    assert.deepEqual(third.started, [true]);

    // Тот, кто уже стоял в очереди, тоже стартует: подъём предела освобождает место и ему.
    assert.deepEqual(second.started, [true]);

    first.finish();
    second.finish();
    third.finish();
    await settle();
  });

  it("leaves a running turn alone when the limit drops", async () => {
    let limit = 2;
    const queue = createTurnQueue({ limit: () => limit });
    const first = pending();
    const second = pending();

    queue.submit({ sessionId: "s1", kind: "turn", run: first.run });
    queue.submit({ sessionId: "s2", kind: "turn", run: second.run });
    await settle();

    // Турн уже оплачен, и снижение предела его не прерывает (docs/architecture.md).
    limit = 1;

    assert.deepEqual(queue.size(), { running: 2, queued: 0 });

    first.finish();
    second.finish();
    await settle();
  });

  it("takes a waiting turn out of the queue without running it", async () => {
    const queue = createTurnQueue({ limit: () => 1 });
    const first = pending();
    const second = pending();

    queue.submit({ sessionId: "s1", kind: "turn", run: first.run });

    const waiting = admitted(queue.submit({ sessionId: "s2", kind: "turn", run: second.run }));

    await settle();

    assert.equal(waiting.cancel(), true);
    // Снятый второй раз — уже не снят: повторное прерывание не выдумывает событие.
    assert.equal(waiting.cancel(), false);

    first.finish();
    await settle();

    assert.deepEqual(second.started, []);
    assert.equal(queue.stateOf("s2"), "idle");
  });

  it("refuses to take a running turn out: interrupting it is the runtime's business", async () => {
    const queue = createTurnQueue({ limit: () => 1 });
    const work = pending();

    const place = admitted(queue.submit({ sessionId: "s1", kind: "turn", run: work.run }));

    await settle();

    assert.equal(place.cancel(), false);

    work.finish();
    await settle();
  });

  it("counts a compaction against the same limit as a turn", async () => {
    const queue = createTurnQueue({ limit: () => 1 });
    const compaction = pending();
    const turn = pending();

    queue.submit({ sessionId: "s1", kind: "compaction", run: compaction.run });

    const waiting = admitted(queue.submit({ sessionId: "s2", kind: "turn", run: turn.run }));

    await settle();

    // Предел считает всё, что ходит к модели, а не только `prompt` (docs/architecture.md).
    assert.equal(waiting.state, "queued");

    compaction.finish();
    turn.finish();
    await settle();
  });

  it("keeps going after a turn that threw, and says who it was", async () => {
    const failures: { sessionId: string; reason: unknown }[] = [];
    const queue = createTurnQueue({
      limit: () => 1,
      onFailure: (sessionId, reason) => failures.push({ sessionId, reason }),
    });
    const next = pending();

    queue.submit({
      sessionId: "s1",
      kind: "turn",
      run: () => Promise.reject(new Error("модель отказала")),
    });
    queue.submit({ sessionId: "s2", kind: "turn", run: next.run });

    await settle();
    await settle();

    // Слот освобождается и на отказе: иначе одна упавшая работа съела бы место навсегда.
    assert.deepEqual(next.started, [true]);
    assert.equal(failures.length, 1);
    assert.equal(failures[0]?.sessionId, "s1");

    next.finish();
    await settle();
  });

  it("tells the caller when the state of a session changed", async () => {
    const changed: string[] = [];
    const queue = createTurnQueue({ limit: () => 1, onChange: (id) => changed.push(id) });
    const first = pending();
    const second = pending();

    queue.submit({ sessionId: "s1", kind: "turn", run: first.run });
    queue.submit({ sessionId: "s2", kind: "turn", run: second.run });
    await settle();

    first.finish();
    await settle();

    // Постановка, старт и завершение — каждое смена наблюдаемого состояния сессии.
    assert.deepEqual(changed, ["s1", "s2", "s1", "s2"]);

    second.finish();
    await settle();
  });
});
