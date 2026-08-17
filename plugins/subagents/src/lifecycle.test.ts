import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { lastAgentText, launch, reconcile, settled, stop, sweep } from "./lifecycle.ts";
import { listRecords, readRecord, writeRecord, type SubagentRecord } from "./registry.ts";
import { agentMessage, installWorld, session, type World } from "./world.test-helper.ts";

let world: World | undefined;

afterEach(async () => {
  await settled();
  world?.restore();
  world = undefined;
});

const now = "2026-08-14T10:00:00.000Z";
/** Когда субагент ответил: позже начала своего задания, иначе ответ относится к прошлому. */
const answered = "2026-08-14T09:30:00.000Z";

function record(overrides: Partial<SubagentRecord> = {}): SubagentRecord {
  return {
    sessionId: "s-child",
    parentSessionId: "s-parent",
    projectId: "p1",
    agentId: "starter.generic",
    model: "scripted/one",
    thinkingLevel: "off",
    description: "check the tests",
    prompt: "run the tests",
    state: "running",
    startedAt: "2026-08-14T09:00:00.000Z",
    ...overrides,
  };
}

const listed = (): number =>
  (world?.calls ?? []).filter((call) => call.kind === "session-list").length;

/** Дождаться наблюдаемого шага платформы вместо сна на глазок: иначе тест меряет скорость машины. */
async function until(kind: string): Promise<void> {
  for (let attempt = 0; attempt < 500; attempt += 1) {
    if (world?.calls.some((call) => call.kind === kind) === true) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 1));
  }

  assert.fail(`the platform never saw ${kind}`);
}

describe("lastAgentText", () => {
  it("takes the last thing the agent said and skips the empty tail", () => {
    assert.equal(
      lastAgentText([
        agentMessage("e1", "first"),
        agentMessage("e2", "  "),
        { id: "e3", time: now, kind: "tools-change", toolNames: ["read"] },
      ]),
      "first",
    );
  });

  it("has nothing to take when the agent never spoke", () => {
    assert.equal(lastAgentText([{ id: "e1", time: now, kind: "leaf" }]), undefined);
  });
});

describe("reconcile", () => {
  it("finishes a running record whose session went idle and writes the answer into it", async () => {
    world = installWorld([
      session({ id: "s-parent", phase: "idle" }),
      session({
        id: "s-child",
        phase: "idle",
        entries: [agentMessage("e1", "all green", answered)],
      }),
    ]);
    await writeRecord(record());

    await reconcile(await listRecords(), now);

    const settled = await readRecord("s-child");

    assert.equal(settled?.state, "finished");
    assert.equal(settled?.lastResponse, "all green");
    assert.equal(settled?.finishedAt, now);
  });

  it("says nothing to the parent, idle or working", async () => {
    // Итог лежит в записи, и родитель читает его инструментом. Ни турна, ни догоняющего сообщения
    // ему никто не заводит — из-за этого он и не может получить второй доклад об одной работе.
    for (const phase of ["idle", "turn", "queued"] as const) {
      world?.restore();
      world = installWorld([
        session({ id: "s-parent", phase }),
        session({
          id: "s-child",
          phase: "idle",
          entries: [agentMessage("e1", "all green", answered)],
        }),
      ]);
      await writeRecord(record());

      await reconcile(await listRecords(), now);

      assert.equal((await readRecord("s-child"))?.state, "finished", phase);
      assert.deepEqual(
        world.calls.filter(
          (call) =>
            (call.kind === "session-prompt" && call.turn.sessionId === "s-parent") ||
            (call.kind === "session-message" && call.sessionId === "s-parent"),
        ),
        [],
        phase,
      );
    }
  });

  it("leaves a starting subagent to the call that is starting it", async () => {
    // Сессия создана, задание ещё не отправлено. Простой здесь не значит «отработал»: объяви его
    // концом — и настоящий турн пошёл бы дальше без присмотра, а родитель получил бы пустой ответ.
    world = installWorld([session({ id: "s-parent" }), session({ id: "s-child", phase: "idle" })]);
    await writeRecord(record({ state: "starting" }));

    await reconcile(await listRecords(), now);

    assert.equal((await readRecord("s-child"))?.state, "starting");
    assert.equal(
      world.calls.some((call) => call.kind === "session-prompt"),
      false,
    );
  });

  it("takes over a starting subagent after the worker was reloaded", async () => {
    // Вызова, поставившего `starting`, больше нет: он умер вместе с памятью воркера. Работающая
    // сессия значит, что задание доехало, — запись возвращается на сопровождение.
    world = installWorld([session({ id: "s-parent" }), session({ id: "s-child", phase: "turn" })]);
    await writeRecord(record({ state: "starting" }));

    await reconcile(await listRecords(), now, { afterReload: true });

    assert.equal((await readRecord("s-child"))?.state, "running");
  });

  it("finishes a starting subagent that ended while the worker was reloading", async () => {
    world = installWorld([
      session({ id: "s-parent", phase: "idle" }),
      session({
        id: "s-child",
        phase: "idle",
        entries: [agentMessage("e1", "all green", answered)],
      }),
    ]);
    await writeRecord(record({ state: "starting" }));

    await reconcile(await listRecords(), now, { afterReload: true });

    assert.equal((await readRecord("s-child"))?.state, "finished");
    assert.equal((await readRecord("s-child"))?.lastResponse, "all green");
  });

  it("calls a wordless turn failed instead of finished", async () => {
    // Провал похода к модели в файл сессии не пишется, поэтому молчание и сбой снаружи неотличимы.
    // Выдать молчание за удачный итог значило бы соврать родителю о результате работы.
    world = installWorld([
      session({ id: "s-parent", phase: "idle" }),
      session({ id: "s-child", phase: "idle" }),
    ]);
    await writeRecord(record());

    await reconcile(await listRecords(), now);

    const stopped = await readRecord("s-child");

    assert.equal(stopped?.state, "failed");
    assert.match(stopped?.failure ?? "", /without saying anything/u);
  });

  it("does not take the answer to the previous task as the answer to this one", async () => {
    // Сессия субагента переживает своё задание: вся прошлая работа остаётся в той же ветке. Без
    // отсечки по времени сорвавшееся второе задание вернуло бы ответ на первое — как свежий.
    world = installWorld([
      session({ id: "s-parent", phase: "idle" }),
      session({
        id: "s-child",
        phase: "idle",
        entries: [agentMessage("e1", "answer to the first task", "2026-08-14T09:30:00.000Z")],
      }),
    ]);
    await writeRecord(record({ startedAt: "2026-08-14T09:45:00.000Z", prompt: "the second task" }));

    await reconcile(await listRecords(), now);

    const settledRecord = await readRecord("s-child");

    assert.equal(settledRecord?.lastResponse, undefined);
    assert.equal(settledRecord?.state, "failed");
  });

  it("leaves a working subagent alone", async () => {
    world = installWorld([session({ id: "s-parent" }), session({ id: "s-child", phase: "turn" })]);
    await writeRecord(record());

    await reconcile(await listRecords(), now);

    assert.equal((await readRecord("s-child"))?.state, "running");
    assert.equal(
      world.calls.some((call) => call.kind === "session-prompt"),
      false,
    );
  });

  it("does not touch a record it has already finished", async () => {
    // Законченную запись обход обязан пропускать: перечитанная ветка переписала бы уже подведённый
    // итог, а сессия субагента живёт дальше и может сказать что-то ещё по следующему заданию.
    world = installWorld([
      session({ id: "s-parent", phase: "idle" }),
      session({
        id: "s-child",
        phase: "idle",
        entries: [agentMessage("e1", "all green", answered)],
      }),
    ]);
    await writeRecord(record());

    await reconcile(await listRecords(), now);

    const first = await readRecord("s-child");
    const reads = world.calls.filter((call) => call.kind === "session-branch").length;

    await reconcile(await listRecords(), "2026-08-14T11:00:00.000Z");

    assert.deepEqual(await readRecord("s-child"), first);
    assert.equal(world.calls.filter((call) => call.kind === "session-branch").length, reads);
  });

  it("calls a subagent whose session disappeared failed instead of leaving it running", async () => {
    world = installWorld([session({ id: "s-parent", phase: "idle" })]);
    await writeRecord(record());

    await reconcile(await listRecords(), now);

    const settled = await readRecord("s-child");

    assert.equal(settled?.state, "failed");
    assert.match(settled?.failure ?? "", /the session of the subagent is gone/u);
  });

  it("does not lose a subagent whose parent is gone", async () => {
    world = installWorld([
      session({
        id: "s-child",
        phase: "idle",
        entries: [agentMessage("e1", "all green", answered)],
      }),
    ]);
    await writeRecord(record());

    await reconcile(await listRecords(), now);

    const settled = await readRecord("s-child");

    // Родителя стёрли — на итоге это не сказывается никак: он лежит в записи и виден в панели,
    // а спрашивать его больше некому.
    assert.equal(settled?.state, "finished");
    assert.equal(settled?.lastResponse, "all green");
  });
});

describe("sweep", () => {
  it("keeps one pending sweep instead of one per session change", async () => {
    // Событие шины приходит на каждое изменение любой сессии. Обход всегда читает все записи
    // заново, поэтому второй такой же рядом со стоящим не узнал бы ничего нового.
    world = installWorld([session({ id: "s-parent" }), session({ id: "s-child", phase: "turn" })]);
    await writeRecord(record());
    world.calls.length = 0;

    const first = sweep({ coalesce: true });

    assert.equal(sweep({ coalesce: true }), first);
    assert.equal(sweep({ coalesce: true }), first);

    await settled();

    assert.equal(listed(), 1);
  });

  it("takes a new sweep for what changed after the current one started reading", async () => {
    // Флаг снимается в начале тела: обход, уже читающий записи, изменения после себя не увидит.
    world = installWorld([
      session({ id: "s-parent" }),
      session({
        id: "s-child",
        phase: "idle",
        entries: [agentMessage("e1", "all green", answered)],
      }),
    ]);
    world.branchDelayMilliseconds = 5;
    await writeRecord(record());
    world.calls.length = 0;

    const first = sweep({ coalesce: true });

    await until("session-branch");

    assert.notEqual(sweep({ coalesce: true }), first);

    await settled();
  });

  it("does not swallow the sweep of a launch into a sweep that runs before it", async () => {
    // Обход запуска идёт **после** его трёх записей и заменяться стоящим в очереди не вправе:
    // тот прошёл бы до них и оставил бы субагента идущим навсегда.
    world = installWorld([
      session({ id: "s-parent" }),
      session({ id: "s-child", phase: "idle", hidden: true }),
    ]);
    world.answerAtOnce = "done before you looked";
    world.calls.length = 0;

    void sweep({ coalesce: true });
    await launch(record({ state: "starting" }), "run the tests");
    await settled();

    assert.equal((await readRecord("s-child"))?.state, "finished");
  });
});

describe("launch", () => {
  it("does not let a stop land in the middle of it", async () => {
    // Остановка руками приходит, пока задание ещё едет до платформы. Не будь запуск в одной очереди
    // с ней, он дописал бы `running` поверх уже подведённого итога — и запись числилась бы идущей,
    // уже кончившись.
    world = installWorld([
      session({ id: "s-parent", phase: "idle" }),
      session({ id: "s-child", phase: "idle", hidden: true }),
    ]);
    world.promptDelayMilliseconds = 5;

    const started = launch(record(), "run the tests");
    const stopped = await stop("s-child");

    await started;
    await settled();

    assert.equal(stopped.kind, "stopped");
    assert.equal((await readRecord("s-child"))?.state, "stopped");
    assert.deepEqual(
      world.calls.filter(
        (call) =>
          (call.kind === "session-prompt" && call.turn.sessionId === "s-parent") ||
          (call.kind === "session-message" && call.sessionId === "s-parent"),
      ),
      [],
    );
  });
});
