import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { contributeTools } from "./tools.ts";
import { readRecord } from "./registry.ts";
import { agentMessage, installWorld, session, type World } from "./world.test-helper.ts";

let world: World | undefined;

afterEach(() => {
  world?.restore();
  world = undefined;
});

const parent = { sessionId: "s-parent", projectId: "p1", folder: "/tmp/project" };

async function ready(sessions = [session({ id: "s-parent" })]): Promise<World> {
  world = installWorld(sessions);
  await contributeTools();

  return world;
}

describe("subagent-spawn", () => {
  it("starts a hidden session on the agent of the caller and gives it the task", async () => {
    const here = await ready();

    const outcome = await here.host.callTool(
      "subagent-spawn",
      { description: "check the tests", prompt: "run the tests and say what broke" },
      parent,
    );

    assert.equal(outcome.isError, false);
    assert.match(outcome.content, /Started subagent s-new/u);
    // Отдельно: инструмент говорит модели не ждать. Ожидание внутри вызова упёрлось бы в таймаут
    // инструмента и держало бы слот турна родителя.
    assert.match(outcome.content, /do not wait for it/u);

    const created = here.calls.find((call) => call.kind === "session-create");

    assert.deepEqual(created?.kind === "session-create" ? created.draft : undefined, {
      projectId: "p1",
      agentId: "starter.generic",
      hidden: true,
      model: "scripted/one",
      thinkingLevel: "medium",
    });

    const prompted = here.calls.find((call) => call.kind === "session-prompt");

    assert.equal(
      prompted?.kind === "session-prompt" ? prompted.turn.text : undefined,
      "run the tests and say what broke",
    );

    const record = await readRecord("s-new");

    assert.equal(record?.state, "running");
    assert.equal(record?.parentSessionId, "s-parent");
    assert.equal(record?.description, "check the tests");
  });

  it("takes the agent, the model and the reasoning level the caller named", async () => {
    const here = await ready();

    await here.host.callTool(
      "subagent-spawn",
      {
        description: "review",
        prompt: "review the diff",
        agent: "starter.reviewer",
        model: "scripted/three",
        thinkingLevel: "xhigh",
      },
      parent,
    );

    const created = here.calls.find((call) => call.kind === "session-create");

    assert.deepEqual(created?.kind === "session-create" ? created.draft : undefined, {
      projectId: "p1",
      agentId: "starter.reviewer",
      hidden: true,
      model: "scripted/three",
      thinkingLevel: "xhigh",
    });
  });

  it("brings a refusal of before_session_start to the model as a result, not as a crash", async () => {
    const here = await ready();

    here.refuseCreate = "subagents are switched off in this project";

    const outcome = await here.host.callTool(
      "subagent-spawn",
      { description: "check", prompt: "do it" },
      parent,
    );

    assert.equal(outcome.isError, true);
    assert.match(outcome.content, /guard\.no-subagents: subagents are switched off/u);
    assert.equal(await readRecord("s-new"), undefined);
  });

  it("finds an agent that only the project of the caller has", async () => {
    const here = await ready();

    const outcome = await here.host.callTool(
      "subagent-spawn",
      { description: "local work", prompt: "do it", agent: "local.specialist" },
      parent,
    );

    assert.equal(outcome.isError, false);

    const created = here.calls.find((call) => call.kind === "session-create");

    assert.equal(
      created?.kind === "session-create" ? created.draft.agentId : undefined,
      "local.specialist",
    );
  });

  it("names an agent that does not exist instead of starting something else", async () => {
    const here = await ready();

    const outcome = await here.host.callTool(
      "subagent-spawn",
      { description: "check", prompt: "do it", agent: "never.declared" },
      parent,
    );

    assert.equal(outcome.isError, true);
    assert.match(outcome.content, /there is no agent never\.declared/u);
  });
});

describe("subagent-types", () => {
  it("offers the agents of the project of the caller, not only the base catalogue", async () => {
    const here = await ready();

    const outcome = await here.host.callTool("subagent-types", {}, parent);

    assert.match(outcome.content, /starter\.generic \| model=scripted\/one/u);
    // Агент из папки проекта обязан быть в списке выбора: сессия его принимает, и скрывать его от
    // модели значило бы предлагать ей меньше, чем платформа умеет.
    assert.match(outcome.content, /local\.specialist/u);
  });
});

describe("subagent-list and subagent-output", () => {
  it("lists only the subagents of the calling session unless asked for all", async () => {
    const here = await ready([session({ id: "s-parent" }), session({ id: "s-other" })]);

    await here.host.callTool("subagent-spawn", { description: "mine", prompt: "a" }, parent);
    here.nextId.push("s-second");
    await here.host.callTool(
      "subagent-spawn",
      { description: "theirs", prompt: "b" },
      {
        ...parent,
        sessionId: "s-other",
      },
    );

    const mine = await here.host.callTool("subagent-list", {}, parent);

    assert.match(mine.content, /mine/u);
    assert.doesNotMatch(mine.content, /theirs/u);

    const all = await here.host.callTool("subagent-list", { all: true }, parent);

    assert.match(all.content, /mine/u);
    assert.match(all.content, /theirs/u);
  });

  it("reads what a working subagent has already said", async () => {
    const here = await ready();

    await here.host.callTool("subagent-spawn", { description: "mine", prompt: "a" }, parent);
    here.sessions.get("s-new")?.entries.push(agentMessage("e1", "halfway there"));

    const outcome = await here.host.callTool("subagent-output", { sessionId: "s-new" }, parent);

    assert.equal(outcome.content, "halfway there");
  });

  it("names a subagent nobody started", async () => {
    const here = await ready();
    const outcome = await here.host.callTool("subagent-output", { sessionId: "s-none" }, parent);

    assert.equal(outcome.isError, true);
    assert.match(outcome.content, /there is no subagent s-none/u);
  });
});

describe("subagent-message", () => {
  it("steers a working subagent", async () => {
    const here = await ready();

    await here.host.callTool("subagent-spawn", { description: "mine", prompt: "a" }, parent);
    here.calls.length = 0;

    const outcome = await here.host.callTool(
      "subagent-message",
      { sessionId: "s-new", text: "look at the config too" },
      parent,
    );

    assert.equal(outcome.isError, false);

    const steered = here.calls.find((call) => call.kind === "session-message");

    assert.equal(steered?.kind === "session-message" ? steered.message.mode : undefined, "steer");
  });

  it("gives a finished subagent a second task with an ordinary turn", async () => {
    const here = await ready();

    await here.host.callTool("subagent-spawn", { description: "mine", prompt: "a" }, parent);
    // Субагент отработал: запись доведена до конца тем же кодом, что и на живой платформе.
    const finishedSession = here.sessions.get("s-new");

    if (finishedSession !== undefined) {
      finishedSession.phase = "idle";
      finishedSession.entries.push(agentMessage("e1", "done"));
    }

    const { reconcile } = await import("./lifecycle.ts");

    await reconcile([...(await listAll())], "2026-08-14T10:00:00.000Z");
    here.calls.length = 0;

    const outcome = await here.host.callTool(
      "subagent-message",
      { sessionId: "s-new", text: "now do the other half" },
      parent,
    );

    assert.equal(outcome.isError, false);

    // Ни архивации, ни восстановления: скрытая сессия принимает второе задание как есть.
    assert.deepEqual(
      here.calls.map((call) => call.kind),
      ["session-prompt"],
    );

    const record = await readRecord("s-new");

    assert.equal(record?.state, "running");
    // Итог прошлого задания стёрт: старый ответ рядом с новой работой вводил бы в заблуждение.
    assert.equal(record?.lastResponse, undefined);
  });
});

describe("subagent-stop", () => {
  it("aborts a working subagent and keeps its session alive", async () => {
    const here = await ready();

    await here.host.callTool("subagent-spawn", { description: "mine", prompt: "a" }, parent);
    here.sessions.get("s-new")?.entries.push(agentMessage("e1", "got this far"));

    const outcome = await here.host.callTool("subagent-stop", { sessionId: "s-new" }, parent);

    assert.equal(outcome.isError, false);
    assert.match(outcome.content, /Stopped the subagent s-new/u);

    const record = await readRecord("s-new");

    assert.equal(record?.state, "stopped");
    // То, что субагент успел сказать, доходит до родителя: молчать о прерванном значило бы
    // оставить родителя ждать ответа, которого не будет.
    assert.equal(record?.lastResponse, "got this far");
  });

  it("says so when the subagent had already finished", async () => {
    const here = await ready();

    await here.host.callTool("subagent-spawn", { description: "mine", prompt: "a" }, parent);
    await here.host.callTool("subagent-stop", { sessionId: "s-new" }, parent);

    const again = await here.host.callTool("subagent-stop", { sessionId: "s-new" }, parent);

    assert.match(again.content, /had already stopped/u);
  });
});

/** Записи глазами теста: хранилище шва настоящее, поэтому читать его надо тем же способом. */
async function listAll() {
  const { listRecords } = await import("./registry.ts");

  return listRecords();
}
