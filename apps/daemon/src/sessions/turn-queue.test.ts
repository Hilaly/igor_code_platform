import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  createTurnQueue,
  type CreateTurnQueueOptions,
  type TurnJob,
  type TurnLane,
  type TurnQueue,
} from "./turn-queue.ts";

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

/**
 * Очередь без сказанной доли агентов: она равна общему пределу, то есть полоса ничего не ограничивает.
 * Так проверяется всё, что про полосы не спрашивает, — правила общего предела от них не зависят.
 */
function queueOf(options: Partial<CreateTurnQueueOptions> & { limit: () => number }): TurnQueue {
  return createTurnQueue({ agentLimit: options.limit, ...options });
}

/** Работа с полосой. Умолчание человеческое: полосу называет тот тест, который её и проверяет. */
function job(
  sessionId: string,
  run: TurnJob["run"],
  lane: TurnLane = "interactive",
  kind: TurnJob["kind"] = "turn",
): TurnJob {
  return { sessionId, kind, lane, run };
}

const settle = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

function admitted(place: ReturnType<TurnQueue["submit"]>) {
  assert.equal(place.kind, "accepted");

  return place;
}

describe("createTurnQueue", () => {
  it("starts a turn at once while there is room", async () => {
    const queue = queueOf({ limit: () => 2 });
    const work = pending();

    const place = admitted(queue.submit(job("s1", work.run)));

    await settle();

    assert.equal(place.state, "running");
    assert.deepEqual(queue.size(), { running: 1, queued: 0, agentRunning: 0, agentQueued: 0 });
    assert.equal(queue.stateOf("s1"), "running");

    work.finish();
    await settle();

    assert.equal(queue.stateOf("s1"), "idle");
  });

  it("refuses a second turn for a session that already owns a place", async () => {
    const queue = queueOf({ limit: () => 1 });
    const first = pending();
    const second = pending();

    queue.submit(job("s1", first.run));
    const duplicate = queue.submit(job("s1", second.run));

    await settle();

    assert.deepEqual(duplicate, { kind: "busy" });
    assert.deepEqual(queue.size(), { running: 1, queued: 0, agentRunning: 0, agentQueued: 0 });
    assert.deepEqual(second.started, []);

    first.finish();
    await settle();
  });

  it("keeps a cancelled reservation owned until validation releases it", () => {
    const queue = queueOf({ limit: () => 1 });
    const reservation = queue.reserve("s1", "interactive");

    assert.equal(reservation.kind, "accepted");
    assert.equal(reservation.cancel(), true);
    assert.deepEqual(queue.reserve("s1", "interactive"), { kind: "busy" });
    assert.equal(queue.stateOf("s1"), "idle");

    reservation.release();

    const retry = queue.reserve("s1", "interactive");

    assert.equal(retry.kind, "accepted");
    retry.release();
  });

  it("makes the turn over the limit wait, and starts it when the room frees up", async () => {
    const queue = queueOf({ limit: () => 1 });
    const first = pending();
    const second = pending();

    queue.submit(job("s1", first.run));

    const waiting = admitted(queue.submit(job("s2", second.run)));

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
    const queue = queueOf({ limit: () => limit });
    const first = pending();
    const second = pending();
    const third = pending();

    queue.submit(job("s1", first.run));
    queue.submit(job("s2", second.run));
    await settle();

    assert.deepEqual(second.started, []);

    // Предел поднят на живой очереди: пересоздавать её не нужно, значение спрашивается заново.
    limit = 3;
    queue.submit(job("s3", third.run));
    await settle();

    assert.deepEqual(third.started, [true]);

    // Тот, кто уже стоял в очереди, тоже стартует: подъём предела освобождает место и ему.
    assert.deepEqual(second.started, [true]);

    first.finish();
    second.finish();
    third.finish();
    await settle();
  });

  it("starts an older waiting turn before a new turn after the limit grows", async () => {
    let limit = 1;
    const queue = queueOf({ limit: () => limit });
    const order: string[] = [];
    const first = pending();
    const second = pending();
    const third = pending();

    queue.submit(job("s1", first.run));
    queue.submit(
      job("s2", async () => {
        order.push("second");
        await second.run();
      }),
    );
    await settle();

    limit = 2;
    queue.submit(
      job("s3", async () => {
        order.push("third");
        await third.run();
      }),
    );
    await settle();

    assert.deepEqual(order, ["second"]);
    assert.equal(queue.stateOf("s2"), "running");
    assert.equal(queue.stateOf("s3"), "queued");

    first.finish();
    second.finish();
    await settle();
    await settle();

    assert.deepEqual(order, ["second", "third"]);
    third.finish();
    await settle();
  });

  it("leaves a running turn alone when the limit drops", async () => {
    let limit = 2;
    const queue = queueOf({ limit: () => limit });
    const first = pending();
    const second = pending();

    queue.submit(job("s1", first.run));
    queue.submit(job("s2", second.run));
    await settle();

    // Турн уже оплачен, и снижение предела его не прерывает (docs/architecture.md).
    limit = 1;

    assert.deepEqual(queue.size(), { running: 2, queued: 0, agentRunning: 0, agentQueued: 0 });

    first.finish();
    second.finish();
    await settle();
  });

  it("takes a waiting turn out of the queue without running it", async () => {
    const queue = queueOf({ limit: () => 1 });
    const first = pending();
    const second = pending();

    queue.submit(job("s1", first.run));

    const waiting = admitted(queue.submit(job("s2", second.run)));

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
    const queue = queueOf({ limit: () => 1 });
    const work = pending();

    const place = admitted(queue.submit(job("s1", work.run)));

    await settle();

    assert.equal(place.cancel(), false);

    work.finish();
    await settle();
  });

  it("counts a compaction against the same limit as a turn", async () => {
    const queue = queueOf({ limit: () => 1 });
    const compaction = pending();
    const turn = pending();

    queue.submit(job("s1", compaction.run, "interactive", "compaction"));

    const waiting = admitted(queue.submit(job("s2", turn.run)));

    await settle();

    // Предел считает всё, что ходит к модели, а не только `prompt` (docs/architecture.md).
    assert.equal(waiting.state, "queued");

    compaction.finish();
    turn.finish();
    await settle();
  });

  it("keeps going after a turn that threw, and says who it was", async () => {
    const failures: { sessionId: string; reason: unknown }[] = [];
    const queue = queueOf({
      limit: () => 1,
      onFailure: (sessionId, reason) => failures.push({ sessionId, reason }),
    });
    const next = pending();

    queue.submit(job("s1", () => Promise.reject(new Error("модель отказала"))));
    queue.submit(job("s2", next.run));

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
    const queue = queueOf({ limit: () => 1, onChange: (id) => changed.push(id) });
    const first = pending();
    const second = pending();

    queue.submit(job("s1", first.run));
    queue.submit(job("s2", second.run));
    await settle();

    first.finish();
    await settle();

    // Постановка, старт и завершение — каждое смена наблюдаемого состояния сессии.
    assert.deepEqual(changed, ["s1", "s2", "s1", "s2"]);

    second.finish();
    await settle();
  });
});

describe("createTurnQueue: полосы", () => {
  it("lets agents take no more than their share of the limit", async () => {
    const queue = createTurnQueue({ limit: () => 4, agentLimit: () => 2 });
    const work = [pending(), pending(), pending()];

    queue.submit(job("a1", work[0]!.run, "agent"));
    queue.submit(job("a2", work[1]!.run, "agent"));

    const third = admitted(queue.submit(job("a3", work[2]!.run, "agent")));

    await settle();

    // Общий предел не выбран, но доля агентов выбрана: третий ждёт, хотя место у очереди есть.
    assert.equal(third.state, "queued");
    assert.deepEqual(queue.size(), { running: 2, queued: 1, agentRunning: 2, agentQueued: 1 });

    work[0]!.finish();
    await settle();

    assert.deepEqual(work[2]!.started, [true]);

    work[1]!.finish();
    work[2]!.finish();
    await settle();
  });

  it("starts a human turn while the agent lane is full and the queue is not", async () => {
    // Ради этого полосы и заведены: разлёт субагентов не отодвигает сообщение человека.
    const queue = createTurnQueue({ limit: () => 3, agentLimit: () => 2 });
    const agents = [pending(), pending(), pending()];
    const human = pending();

    queue.submit(job("a1", agents[0]!.run, "agent"));
    queue.submit(job("a2", agents[1]!.run, "agent"));
    queue.submit(job("a3", agents[2]!.run, "agent"));

    const mine = admitted(queue.submit(job("s1", human.run)));

    await settle();

    assert.equal(mine.state, "running");
    assert.deepEqual(human.started, [true]);
    // Агентский третий по-прежнему ждёт свою полосу, а не общее место.
    assert.deepEqual(agents[2]!.started, []);

    human.finish();
    agents[0]!.finish();
    agents[1]!.finish();
    await settle();

    agents[2]!.finish();
    await settle();
  });

  it("keeps the order inside a lane while the other lane overtakes", async () => {
    const queue = createTurnQueue({ limit: () => 2, agentLimit: () => 1 });
    const order: string[] = [];
    const started = [pending(), pending(), pending()];
    const note =
      (name: string, work: ReturnType<typeof pending>) => async (): Promise<void> => {
        order.push(name);
        await work.run();
      };

    queue.submit(job("a1", note("a1", started[0]!), "agent"));
    queue.submit(job("a2", note("a2", started[1]!), "agent"));
    queue.submit(job("s1", note("s1", started[2]!)));
    await settle();

    // Человек обогнал ждущего агента — но только его, чужую полосу. Свой порядок агенты держат.
    assert.deepEqual(order, ["a1", "s1"]);

    started[0]!.finish();
    await settle();

    assert.deepEqual(order, ["a1", "s1", "a2"]);

    started[1]!.finish();
    started[2]!.finish();
    await settle();
  });

  it("reads the share again on every start, so the config applies live", async () => {
    let agentLimit = 1;
    const queue = createTurnQueue({ limit: () => 4, agentLimit: () => agentLimit });
    const work = [pending(), pending()];

    queue.submit(job("a1", work[0]!.run, "agent"));
    queue.submit(job("a2", work[1]!.run, "agent"));
    await settle();

    assert.deepEqual(work[1]!.started, []);

    // Доля поднята на живой очереди: ждущему агенту место появилось без пересоздания очереди.
    agentLimit = 2;
    queue.submit(job("s1", pending().run));
    await settle();

    assert.deepEqual(work[1]!.started, [true]);

    work[0]!.finish();
    work[1]!.finish();
    await settle();
  });

  it("does not let the share above the limit raise the limit", async () => {
    const queue = createTurnQueue({ limit: () => 1, agentLimit: () => 5 });
    const work = [pending(), pending()];

    queue.submit(job("a1", work[0]!.run, "agent"));

    const second = admitted(queue.submit(job("a2", work[1]!.run, "agent")));

    await settle();

    // Доля — часть общего предела, а не второй предел рядом с ним.
    assert.equal(second.state, "queued");

    work[0]!.finish();
    await settle();

    work[1]!.finish();
    await settle();
  });
});
