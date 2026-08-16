import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { contributeTools } from "./tools.ts";
import { settled, sweep } from "./lifecycle.ts";
import { readRecord } from "./registry.ts";
import {
  agentMessage,
  installWorld,
  session,
  type FakeProvider,
  type World,
} from "./world.test-helper.ts";

let world: World | undefined;

afterEach(async () => {
  // Запуск заканчивается обходом, который никто не ждёт: снимать шов из-под него нельзя.
  await settled();
  world?.restore();
  world = undefined;
});

const parent = { sessionId: "s-parent", projectId: "p1", folder: "/tmp/project" };

const defaultProviders: FakeProvider[] = [
  { id: "scripted", name: "Scripted", signedIn: true, models: ["scripted/one", "scripted/two"] },
  { id: "example-vendor", name: "Example Vendor", signedIn: false, models: ["example-vendor/big"] },
];

async function ready(
  sessions = [session({ id: "s-parent" })],
  providers: FakeProvider[] = defaultProviders,
): Promise<World> {
  world = installWorld(sessions, providers);
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
    // Отдельно: инструмент говорит модели, что доклада не будет и спросить надо самой. Модель,
    // которой об этом не сказали, ждала бы сообщения, которого не придёт.
    assert.match(outcome.content, /will not report back/u);
    assert.match(outcome.content, /subagent-output/u);

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

  it("does not lose a subagent whose turn ended before the tool returned", async () => {
    const here = await ready();

    // Турн кончился раньше, чем `prompt` вернулся: событие о его конце прошло мимо записи, которая
    // тогда ещё числилась запускающейся, и второго события может не быть вовсе.
    here.answerAtOnce = "done before you looked";

    await here.host.callTool("subagent-spawn", { description: "quick", prompt: "a" }, parent);
    await settled();

    const settledRecord = await readRecord("s-new");

    assert.equal(settledRecord?.state, "finished");
    assert.equal(settledRecord?.lastResponse, "done before you looked");
    // Итог подведён обходом самого запуска, хотя шина плагина за это время не сказала ни слова, —
    // и при этом родителю не ушло ничего: он прочитает запись сам.
    assert.deepEqual(
      here.calls.filter(
        (call) => call.kind === "session-prompt" && call.turn.sessionId === "s-parent",
      ),
      [],
    );
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

  it("defaults the reasoning level to high when neither the caller nor the agent names one", async () => {
    const here = await ready();

    await here.host.callTool(
      "subagent-spawn",
      { description: "check", prompt: "do it", agent: "starter.nothinking" },
      parent,
    );

    const created = here.calls.find((call) => call.kind === "session-create");

    assert.equal(
      created?.kind === "session-create" ? created.draft.thinkingLevel : undefined,
      "high",
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

describe("subagent-models", () => {
  it("lists the models of the signed-in providers with full ids", async () => {
    const here = await ready();

    const outcome = await here.host.callTool("subagent-models", {}, parent);

    assert.equal(outcome.isError, false);
    assert.match(outcome.content, /scripted \(Scripted, 2 models\):/u);
    assert.match(
      outcome.content,
      /scripted\/one \| one \| context=128000 \| maxTokens=8192 \| reasoning=yes/u,
    );
    // Провайдер без входа в списке выбора не участвует: его модели не запустятся.
    assert.doesNotMatch(outcome.content, /example-vendor/u);
  });

  it("marks models that accept images", async () => {
    const here = await ready(
      [session({ id: "s-parent" })],
      [
        {
          id: "zai",
          name: "Z.AI",
          signedIn: true,
          models: ["zai/glm-5.2", { id: "zai/glm-4.6v", input: ["text", "image"] }],
        },
      ],
    );

    const outcome = await here.host.callTool("subagent-models", {}, parent);

    assert.match(outcome.content, /zai\/glm-4\.6v .*\| image input/u);
    assert.doesNotMatch(outcome.content, /zai\/glm-5\.2 \|.*image input/u);
  });

  it("narrows to one provider when asked", async () => {
    const here = await ready(
      [session({ id: "s-parent" })],
      [
        { id: "zai", name: "Z.AI", signedIn: true, models: ["zai/glm-5.2"] },
        {
          id: "anthropic",
          name: "Anthropic",
          signedIn: true,
          models: ["anthropic/claude-opus-5"],
        },
      ],
    );

    const outcome = await here.host.callTool("subagent-models", { provider: "zai" }, parent);

    assert.match(outcome.content, /zai \(Z\.AI, 1 models\):/u);
    assert.match(outcome.content, /zai\/glm-5\.2/u);
    assert.doesNotMatch(outcome.content, /anthropic/u);
  });

  it("names a provider nobody has, with the signed-in ones to choose from", async () => {
    const here = await ready();

    const outcome = await here.host.callTool(
      "subagent-models",
      { provider: "never-declared" },
      parent,
    );

    assert.equal(outcome.isError, true);
    assert.match(
      outcome.content,
      /there is no provider never-declared; the signed-in providers are scripted/u,
    );
  });

  it("says so when the named provider is not signed in", async () => {
    const here = await ready();

    const outcome = await here.host.callTool(
      "subagent-models",
      { provider: "example-vendor" },
      parent,
    );

    assert.equal(outcome.isError, true);
    assert.match(outcome.content, /the provider example-vendor is not signed in/u);
  });

  it("says when no provider is signed in at all", async () => {
    const here = await ready(
      [session({ id: "s-parent" })],
      [{ id: "scripted", signedIn: false, models: ["scripted/one"] }],
    );

    const outcome = await here.host.callTool("subagent-models", {}, parent);

    assert.equal(outcome.isError, false);
    assert.equal(outcome.content, "No provider is signed in, so there is no model to choose from.");
  });

  it("does not invent models when the platform gave no list for a named provider", async () => {
    const here = await ready(
      [session({ id: "s-parent" })],
      [{ id: "scripted", signedIn: true, models: ["scripted/one"], noModelList: true }],
    );

    const outcome = await here.host.callTool("subagent-models", { provider: "scripted" }, parent);

    assert.equal(outcome.isError, true);
    assert.match(
      outcome.content,
      /the platform named the provider scripted but gave no model list/u,
    );
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
    // То, что субагент успел сказать, остаётся в записи: терять сказанное прерванным значило бы
    // прятать работу, за которую заплачено.
    assert.equal(record?.lastResponse, "got this far");
  });

  it("settles an interruption once even when a sweep runs on the same one", async () => {
    const here = await ready();

    await here.host.callTool("subagent-spawn", { description: "mine", prompt: "a" }, parent);
    await settled();
    here.calls.length = 0;

    // Прерывание возвращает сессию в простой, а платформа объявляет об этом на шине — обход
    // приходит прямо посреди остановки и тоже считает субагента отработавшим. Без общей очереди
    // он подвёл бы итог второй раз и написал бы `finished` поверх `stopped`.
    here.onAbort = () => void sweep();
    here.branchDelayMilliseconds = 5;

    await here.host.callTool("subagent-stop", { sessionId: "s-new" }, parent);
    await settled();

    assert.equal((await readRecord("s-new"))?.state, "stopped");
    assert.deepEqual(
      here.calls.filter(
        (call) =>
          (call.kind === "session-prompt" && call.turn.sessionId === "s-parent") ||
          (call.kind === "session-message" && call.sessionId === "s-parent"),
      ),
      [],
    );
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
