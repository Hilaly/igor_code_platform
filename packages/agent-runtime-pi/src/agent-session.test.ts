import assert from "node:assert/strict";
import { appendFile, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";

import { createModels } from "@earendil-works/pi-ai";
import type { Context } from "@earendil-works/pi-ai";
import { foldEntryLabels, type SessionDelta } from "@sovereign/protocol";

import {
  createAgentSessionStore,
  createCoreTools,
  type AgentDefinition,
  type AgentSession,
  type AgentSessionStore,
  type CompactionTuning,
  type TurnOutcome,
} from "./agent-session.ts";
import type {
  RuntimeHookName,
  RuntimeHookSeam,
  SessionHookContext,
  SessionHookSeam,
} from "./hook-events.ts";
import { scriptedModelProvider, type ScriptedTurn } from "./testing.ts";

const folders: string[] = [];

after(async () => {
  for (const folder of folders) {
    await rm(folder, { recursive: true, force: true });
  }
});

async function freshFolder(name: string): Promise<string> {
  const folder = await mkdtemp(join(tmpdir(), `sovereign-${name}-`));

  folders.push(folder);

  return folder;
}

const agent = { id: "starter.generic", instructions: "ты двойник" };

/**
 * Параметры компакции в тестах те же, что зашиты в Pi: своя компакция заведена ради управляемости,
 * а не ради других чисел. Функция, а не значение, — как на живой системе.
 */
const compactionSettings = () => ({ reserveTokens: 16384, keepRecentTokens: 20000 });

async function withStore(
  turns: ScriptedTurn[],
  projectFolder?: string,
  beforeAnswer?: (index: number) => void,
  tuning: () => CompactionTuning = compactionSettings,
  hooks?: RuntimeHookSeam,
  definition: AgentDefinition = agent,
  input?: ("text" | "image")[],
) {
  const scripted = scriptedModelProvider({
    turns,
    ...(beforeAnswer === undefined ? {} : { beforeAnswer }),
    ...(input === undefined ? {} : { input }),
  });
  const models = createModels();

  models.setProvider(scripted.provider);

  const directory = await freshFolder("sessions");
  const archivedDirectory = await freshFolder("sessions-archived");
  const sovereignDataDirectory = await freshFolder("data");
  const folder = projectFolder ?? (await freshFolder("project"));
  const store = createAgentSessionStore({
    models,
    directory,
    archivedDirectory,
    sovereignDataDirectory,
    compactionSettings: tuning,
    ...(hooks === undefined ? {} : { hooks }),
  });

  const open = async (): Promise<AgentSession> => {
    const created = await store.create({
      projectId: "p1",
      agentId: agent.id,
      folder,
      folderKey: folder.toLowerCase(),
      model: `scripted-model/${scripted.model.id}`,
      thinkingLevel: "off",
      agent: definition,
    });

    assert.ok(!("kind" in created), "модель двойника обязана резолвиться");
    await created.setTools(createCoreTools(), ["bash", "read", "write", "edit"]);

    return created;
  };

  return {
    store,
    open,
    folder,
    directory,
    archivedDirectory,
    sovereignDataDirectory,
    requests: scripted.requests,
  };
}

/** Что уехало модели в обращении с этим номером: по нему видно, доехал ли стиринг до разговора. */
function saidToModel(requests: Context[], index: number): string {
  return JSON.stringify(requests[index]?.messages ?? []);
}

/**
 * Трата турна. Наружу она уходит непрозрачной — ядру её разбирать незачем, — поэтому тест смотрит в
 * неё так же, как посмотрел бы плагин: по имени поля рантайма.
 */
function spentOn(outcome: TurnOutcome): number | undefined {
  return outcome.kind === "done"
    ? (outcome.usage as { totalTokens?: number } | undefined)?.totalTokens
    : undefined;
}

function recorder(session: AgentSession): SessionDelta[] {
  const deltas: SessionDelta[] = [];

  session.subscribe((delta) => deltas.push(delta));

  return deltas;
}

describe("an agent session over pi", () => {
  it("runs a turn, streams it and keeps it in the tree", async () => {
    const { open } = await withStore([{ text: "привет от двойника" }]);
    const session = await open();
    const deltas = recorder(session);

    assert.equal((await session.prompt("скажи что-нибудь", "t1")).kind, "done");

    assert.deepEqual(
      deltas.filter((delta) => delta.kind === "phase").map((delta) => delta.phase),
      ["turn", "idle"],
    );
    assert.equal(
      deltas
        .filter((delta) => delta.kind === "message-delta" && delta.channel === "text")
        .map((delta) => (delta.kind === "message-delta" ? delta.text : ""))
        .join("")
        .endsWith("привет от двойника"),
      true,
    );
    assert.equal(
      deltas.filter((delta) => delta.kind === "message-start" && delta.role === "user").length,
      1,
    );
    // Конец турна и возврат в простой — две разные дельты, и порядок между ними именно такой:
    // сначала «турн кончился», потом «сессия свободна».
    assert.deepEqual(
      deltas.slice(-2).map((delta) => delta.kind),
      ["turn-end", "phase"],
    );

    const page = await session.entries();

    // Смена набора инструментов тоже запись дерева: она восстанавливается при перечитывании сессии.
    assert.deepEqual(
      page.entries.map((entry) => entry.kind),
      ["model-change", "thinking-level-change", "tools-change", "message", "message"],
    );
    assert.equal(page.seen, 5);
    await session.close();
  });

  it("reports what the whole turn spent, not what the last request spent", async () => {
    // Вызов инструмента гонит цикл агента на второй круг: обращений к провайдеру два, и платит
    // владелец за оба (docs/hooks.md).
    const { open } = await withStore([
      { toolCalls: [{ id: "c1", name: "read", arguments: { path: "/dev/null" } }], tokens: 7 },
      { text: "готово", tokens: 11 },
      { text: "и ещё", tokens: 3 },
    ]);
    const session = await open();

    assert.equal(spentOn(await session.prompt("прочитай", "t1")), 18);

    // Следующий турн начинается с чистого счёта: иначе трата турна была бы тратой сессии, а
    // накопленную плагин спрашивает у ядра отдельно (docs/hooks.md).
    assert.equal(spentOn(await session.prompt("ещё", "t2")), 3);
    await session.close();
  });

  it("starts a turn with the instructions of an explicitly named skill", async () => {
    const { open, folder, sovereignDataDirectory, requests } = await withStore([
      { text: "разобрал" },
    ]);
    const session = await open();
    const deltas = recorder(session);

    // Каталог системного prompt при этом не трогается: скрытый скил остаётся скрытым от модели, а
    // инструкции уезжают ровно один раз — первым сообщением турна.
    session.setSkills([
      {
        name: "review",
        description: "Review the change",
        location: "/tmp/review/SKILL.md",
        disableModelInvocation: true,
      },
    ]);

    const outcome = await session.activateSkill(
      {
        name: "review",
        description: "Review the change",
        location: "/tmp/review/SKILL.md",
        content: "смотри на границы модулей",
        disableModelInvocation: true,
      },
      "t1",
      "начни с тестов",
    );

    assert.equal(outcome.kind, "done");
    assert.match(requests[0]?.systemPrompt ?? "", /^ты двойник\n\n<runtime_context>/);
    assert.match(requests[0]?.systemPrompt ?? "", new RegExp(`<cwd>${folder}</cwd>`));
    assert.match(
      requests[0]?.systemPrompt ?? "",
      new RegExp(`<sovereign_data_directory>${sovereignDataDirectory}</sovereign_data_directory>`),
    );
    assert.doesNotMatch(requests[0]?.systemPrompt ?? "", /<available_skills>/);

    const said = saidToModel(requests, 0);

    assert.match(said, /смотри на границы модулей/);
    assert.match(said, /начни с тестов/);
    assert.deepEqual(
      deltas.filter((delta) => delta.kind === "phase").map((delta) => delta.phase),
      ["turn", "idle"],
    );
    await session.close();
  });

  it("starts a turn from a prompt template with the arguments substituted", async () => {
    const { open, requests } = await withStore([{ text: "разобрал" }]);
    const session = await open();

    const outcome = await session.runPromptTemplate(
      {
        name: "review",
        description: "Разбор изменения",
        content: "Разбери $1 и обрати внимание на $ARGUMENTS",
      },
      "t1",
      'срез "пятнадцать b"',
    );

    assert.equal(outcome.kind, "done");

    const said = saidToModel(requests, 0);

    // Кавычки разбирает Pi — тот же разбор, что и подстановка: `$1` это `срез`, а `$ARGUMENTS` —
    // оба аргумента целиком.
    assert.match(said, /Разбери срез/);
    assert.match(said, /пятнадцать b/);
    await session.close();
  });

  it("refuses a skill turn while the session is busy", async () => {
    const { open } = await withStore([{ text: "первый" }, { text: "второй" }]);
    const session = await open();
    const running = session.prompt("первый", "t1");
    const refused = await session.activateSkill(
      {
        name: "review",
        description: "Review the change",
        location: "/tmp/review/SKILL.md",
        content: "смотри на границы модулей",
      },
      "t2",
    );

    assert.equal(refused.kind, "busy");
    assert.equal((await running).kind, "done");
    await session.close();
  });

  it("uses the latest instructions, agent data and skills on every turn", async () => {
    const { open, folder, sovereignDataDirectory, requests } = await withStore(
      [{ text: "reviewed" }, { text: "deployed" }, { text: "finished" }],
      undefined,
      undefined,
      compactionSettings,
      undefined,
      { ...agent, directory: "/tmp/review-agent" },
    );
    const session = await open();

    session.setSkills([
      {
        name: "review",
        description: "Review the change",
        location: "/tmp/review/SKILL.md",
      },
    ]);
    await session.prompt("review", "t1");

    assert.equal(
      requests[0]?.systemPrompt,
      `ты двойник\n\n<runtime_context>\n  <cwd>${folder}</cwd>\n  <agent_personal_directory>/tmp/review-agent</agent_personal_directory>\n  <sovereign_data_directory>${sovereignDataDirectory}</sovereign_data_directory>\n\n  <directory_guidance>\n    Work on the current project in cwd. Use it as the default location for project files and project-relative operations.\n    The agent personal directory contains this agent&apos;s definition and private persistent files, such as its own notes. Do not treat it as the project workspace.\n    The Sovereign data directory contains platform-managed shared data. Use it only when the task requires Sovereign resources or state; do not treat it as the current project.\n  </directory_guidance>\n</runtime_context>\n\n<available_skills>\n  <skill>\n    <name>review</name>\n    <description>Review the change</description>\n    <location>/tmp/review/SKILL.md</location>\n  </skill>\n</available_skills>`,
    );

    session.setInstructions("updated");
    session.setAgentDirectory("/tmp/deploy-agent");
    session.setSkills([
      {
        name: "deploy",
        description: "Deploy the change",
        location: "/tmp/deploy/SKILL.md",
      },
    ]);
    await session.prompt("deploy", "t2");

    assert.equal(
      requests[1]?.systemPrompt,
      `updated\n\n<runtime_context>\n  <cwd>${folder}</cwd>\n  <agent_personal_directory>/tmp/deploy-agent</agent_personal_directory>\n  <sovereign_data_directory>${sovereignDataDirectory}</sovereign_data_directory>\n\n  <directory_guidance>\n    Work on the current project in cwd. Use it as the default location for project files and project-relative operations.\n    The agent personal directory contains this agent&apos;s definition and private persistent files, such as its own notes. Do not treat it as the project workspace.\n    The Sovereign data directory contains platform-managed shared data. Use it only when the task requires Sovereign resources or state; do not treat it as the current project.\n  </directory_guidance>\n</runtime_context>\n\n<available_skills>\n  <skill>\n    <name>deploy</name>\n    <description>Deploy the change</description>\n    <location>/tmp/deploy/SKILL.md</location>\n  </skill>\n</available_skills>`,
    );

    session.setAgentDirectory(undefined);
    session.setSkills([]);
    await session.prompt("finish", "t3");

    assert.equal(
      requests[2]?.systemPrompt,
      `updated\n\n<runtime_context>\n  <cwd>${folder}</cwd>\n  <sovereign_data_directory>${sovereignDataDirectory}</sovereign_data_directory>\n\n  <directory_guidance>\n    Work on the current project in cwd. Use it as the default location for project files and project-relative operations.\n    The agent personal directory contains this agent&apos;s definition and private persistent files, such as its own notes. Do not treat it as the project workspace.\n    The Sovereign data directory contains platform-managed shared data. Use it only when the task requires Sovereign resources or state; do not treat it as the current project.\n  </directory_guidance>\n</runtime_context>`,
    );
    assert.throws(() => session.setInstructions(""), /instructions/i);
    await session.close();
  });

  it("lets the agent change a file in the project folder", async () => {
    const folder = await freshFolder("project");
    const { open } = await withStore(
      [
        {
          toolCalls: [
            {
              id: "call-1",
              name: "write",
              arguments: { path: join(folder, "hello.txt"), content: "привет" },
            },
          ],
        },
        { text: "готово" },
      ],
      folder,
    );
    const session = await open();
    const deltas = recorder(session);

    await session.prompt("создай файл", "t1");

    assert.equal(await readFile(join(folder, "hello.txt"), "utf8"), "привет");
    assert.deepEqual(
      deltas.filter((delta) => delta.kind === "tool-start").map((delta) => delta.toolName),
      ["write"],
    );
    assert.deepEqual(
      deltas.filter((delta) => delta.kind === "tool-end").map((delta) => delta.failed),
      [false],
    );

    // Вызов инструмента — блок внутри сообщения агента, а результат — своя запись.
    const kinds = (await session.entries()).entries.map((entry) => entry.kind);

    assert.ok(kinds.includes("tool-result"));
    await session.close();
  });

  it("answers busy instead of throwing while a turn runs", async () => {
    const { open } = await withStore([{ text: "первый" }, { text: "второй" }]);
    const session = await open();

    const running = session.prompt("первый", "t1");
    const second = await session.prompt("второй", "t2");

    assert.deepEqual(second, { kind: "busy" });
    assert.equal((await running).kind, "done");
    await session.close();
  });

  it("says there was nothing to interrupt when the session idles", async () => {
    const { open } = await withStore([{ text: "тихо" }]);
    const session = await open();

    assert.equal(await session.abort(), false);
    await session.close();
  });

  it("keeps a session across a restart of the store", async () => {
    const { open, store, directory, archivedDirectory, folder } = await withStore([
      { text: "привет" },
    ]);
    const session = await open();

    await session.prompt("скажи", "t1");
    await session.close();

    const listed = await store.list();

    assert.deepEqual(
      listed.map((summary) => [summary.projectId, summary.agentId, summary.folder]),
      [["p1", agent.id, folder]],
    );
    assert.match(listed[0]?.model ?? "", /^scripted-model\//);

    // Активация поднимает harness заново и видит записанное: сессия переживает перезапуск демона.
    const persisted = await (
      await freshStore(directory, archivedDirectory)
    ).open(listed[0]?.id ?? "");

    assert.ok(persisted !== undefined);
    const reopened = persisted.activate(agent);

    assert.ok(!("kind" in reopened));
    assert.equal((await reopened.entries()).entries.length, 5);
    await reopened.close();
  });

  it("reads a persisted session after its model disappears", async () => {
    const { open, directory, archivedDirectory } = await withStore([{ text: "привет" }]);
    const session = await open();

    await session.prompt("скажи", "t1");
    const sessionId = session.summary().id;
    await session.close();

    const models = createModels();
    const restarted = createAgentSessionStore({
      models,
      directory,
      archivedDirectory,
      sovereignDataDirectory: directory,
      compactionSettings,
    });
    const listed = await restarted.list();
    const persisted = await restarted.open(sessionId);

    assert.equal(listed[0]?.id, sessionId);
    assert.ok(persisted !== undefined);
    assert.equal((await persisted.entries()).entries.length, 5);
    assert.deepEqual(persisted.activate(agent), { kind: "unknown-model" });
  });

  it("keeps one owner per session file", async () => {
    const { open, store, directory, archivedDirectory } = await withStore([
      { text: "первый" },
      { text: "второй" },
      { text: "третий" },
    ]);
    const session = await open();
    const sessionId = session.summary().id;

    await session.prompt("первый", "t1");

    // Второе открытие посреди жизни сессии — обычное дело: так демон читает ленту, пока harness
    // держит ту же сессию. Оно обязано отдать того же владельца, а не второй экземпляр.
    const persisted = await store.open(sessionId);

    assert.ok(persisted !== undefined);
    assert.equal(persisted.activate(agent), session);

    // Запись после второго открытия для второго экземпляра прошла бы незамеченной: он остался бы
    // с устаревшим листом, и его собственная запись встала бы веткой от него.
    await session.prompt("второй", "t2");

    const second = persisted.activate(agent);

    assert.ok(!("kind" in second));
    await second.prompt("третий", "t3");
    await session.close();

    // Правда о дереве — на диске, поэтому читается она свежим стором, а не тем же экземпляром.
    const reread = await (await freshStore(directory, archivedDirectory)).open(sessionId);

    assert.ok(reread !== undefined);

    const chain = (await reread.entries()).entries;
    const identifiers = chain.map((entry) => entry.id);

    assert.deepEqual(
      chain.map((entry) => entry.parentId),
      [undefined, ...identifiers.slice(0, -1)],
    );
  });

  it("refuses to create a session on a model nobody has", async () => {
    const { store, folder } = await withStore([]);

    assert.deepEqual(
      await store.create({
        projectId: "p1",
        agentId: agent.id,
        folder,
        folderKey: folder,
        model: "выдуманный/провайдер",
        thinkingLevel: "off",
        agent,
      }),
      { kind: "unknown-model" },
    );
  });

  it("replaces diagnostics with the latest storage scan", async () => {
    const { directory, open, store } = await withStore([]);
    const session = await open();

    await session.close();

    const path = await onlySessionFile(directory);
    const contents = await readFile(path, "utf8");

    await appendFile(path, '{"broken"\n');

    assert.deepEqual(await store.list(), []);
    assert.equal(store.problems().length, 1);

    assert.deepEqual(await store.list(), []);
    assert.equal(store.problems().length, 1);

    await writeFile(path, contents);

    assert.equal((await store.list()).length, 1);
    assert.deepEqual(store.problems(), []);
  });
});

describe("messages that do not start a turn", () => {
  it("carries steering into the conversation while the turn runs", async () => {
    // Сессия попадает сюда позже, чем заводится двойник: вмешаться в турн можно только из его
    // ответа, а ответить он должен уже открытой сессии.
    const running: { session?: AgentSession } = {};
    const { open, requests } = await withStore(
      // Первый ответ — вызов инструмента: цикл агента пойдёт на второй круг, и стиринг, положенный
      // в очередь во время первого, обязан доехать до второго обращения.
      [
        { toolCalls: [{ id: "c1", name: "read", arguments: { path: "/dev/null" } }] },
        { text: "ок" },
      ],
      undefined,
      (index) => {
        if (index === 0) {
          void running.session?.message("возьми левее", "steer");
        }
      },
    );

    const session = await open();

    running.session = session;

    const deltas = recorder(session);

    await session.prompt("сделай", "t1");

    assert.match(saidToModel(requests, 1), /возьми левее/);
    assert.deepEqual(deltas.filter((delta) => delta.kind === "queues").at(0)?.queues.steer, [
      { text: "возьми левее" },
    ]);
    // Очередь опустела к концу турна: сообщение ушло в разговор, а не осталось висеть.
    assert.deepEqual(session.queues(), { steer: [], followUp: [], nextTurn: [] });
    await session.close();
  });

  it("refuses steering and a follow-up when there is no turn to steer", async () => {
    const { open } = await withStore([]);
    const session = await open();

    assert.deepEqual(await session.message("левее", "steer"), { kind: "idle" });
    assert.deepEqual(await session.message("и ещё", "follow-up"), { kind: "idle" });
    await session.close();
  });

  it("keeps a message for the next turn across an interruption", async () => {
    const { open, requests } = await withStore([{ text: "первый" }]);
    const session = await open();

    assert.deepEqual(await session.message("не забудь про тесты", "next-turn"), { kind: "queued" });
    assert.deepEqual(session.queues().nextTurn, [{ text: "не забудь про тесты" }]);

    // Прерывание чистит стиринг и догоняющее, но не сообщение к следующему турну: оно про турн,
    // которого ещё не было.
    await session.abort();
    assert.deepEqual(session.queues().nextTurn, [{ text: "не забудь про тесты" }]);

    await session.prompt("поехали", "t1");

    assert.match(saidToModel(requests, 0), /не забудь про тесты/);
    assert.deepEqual(session.queues().nextTurn, []);
    await session.close();
  });

  it("appends a message to the tree without waking anybody", async () => {
    const { open } = await withStore([]);
    const session = await open();

    assert.deepEqual(await session.message("заметка на полях", "append"), { kind: "queued" });

    const kinds = (await session.entries()).entries;

    assert.equal(kinds.at(-1)?.kind, "message");
    assert.equal(session.phase(), "idle");
    await session.close();
  });
});

describe("images in a message", () => {
  const png = {
    mimeType: "image/png" as const,
    data: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x07]).toString("base64"),
  };
  const seeing = (turns: ScriptedTurn[], beforeAnswer?: (index: number) => void) =>
    withStore(turns, undefined, beforeAnswer, compactionSettings, undefined, agent, [
      "text",
      "image",
    ]);

  it("hands the model the very bytes it was given, on the turn and in every queue", async () => {
    const running: { session?: AgentSession } = {};
    const { open, requests } = await seeing(
      [
        { toolCalls: [{ id: "c1", name: "read", arguments: { path: "/dev/null" } }] },
        { text: "ок" },
      ],
      (index) => {
        if (index === 0) {
          void running.session?.message("а тут?", "steer", [png]);
        }
      },
    );
    const session = await open();

    running.session = session;
    await session.prompt("что тут", "t1", [png]);

    // Ни пережатия, ни перекодирования: провайдеру уезжает ровно то, что дал человек.
    assert.match(saidToModel(requests, 0), new RegExp(png.data));
    assert.match(saidToModel(requests, 1), new RegExp(png.data));
    await session.close();
  });

  it("keeps the image in the tree as its own block, in the order it was written", async () => {
    const { open } = await seeing([{ text: "вижу" }]);
    const session = await open();

    await session.prompt("что тут", "t1", [png]);

    const said = (await session.entries()).entries.find(
      (entry) => entry.kind === "message" && entry.role === "user",
    );

    assert.deepEqual(said?.kind === "message" ? said.content : undefined, [
      { kind: "text", text: "что тут" },
      { kind: "image", mimeType: "image/png", data: png.data },
    ]);
    await session.close();
  });

  it("leaves out the empty text block pi puts before an image-only message", async () => {
    const { open } = await seeing([{ text: "вижу" }]);
    const session = await open();

    await session.prompt("", "t1", [png]);

    const said = (await session.entries()).entries.find(
      (entry) => entry.kind === "message" && entry.role === "user",
    );

    // Пустой текстовый блок ставит сам рантайм. Показывать его — значит рисовать в ленте пустой
    // абзац, которого человек не писал.
    assert.deepEqual(said?.kind === "message" ? said.content : undefined, [
      { kind: "image", mimeType: "image/png", data: png.data },
    ]);
    await session.close();
  });

  it("refuses a model that only reads text instead of letting it lose the image", async () => {
    // Fail closed: провайдер либо ответит невнятной ошибкой, либо молча выбросит картинку, и
    // человек решит, что модель её посмотрела.
    const { open } = await withStore([{ text: "вижу" }]);
    const session = await open();

    assert.deepEqual(await session.prompt("что тут", "t1", [png]), {
      kind: "failed",
      reason: `the model ${session.summary().model} does not read images`,
    });
    assert.deepEqual(await session.message("а тут", "append", [png]), { kind: "text-only-model" });

    // Отказ ничего не записывает: принятое сообщение уже лежало бы в дереве, и объяснять отказ
    // пришлось бы задним числом. Записи создания сессии при этом на месте.
    assert.equal(
      (await session.entries()).entries.filter((entry) => entry.kind === "message").length,
      0,
    );
    await session.close();
  });

  it("keeps a queued message whole in the snapshot, images and all", async () => {
    const { open } = await seeing([{ text: "ок" }]);
    const session = await open();
    const deltas = recorder(session);

    assert.deepEqual(await session.message("посмотри потом", "next-turn", [png]), {
      kind: "queued",
    });
    assert.deepEqual(session.queues().nextTurn, [{ text: "посмотри потом", images: [png] }]);
    assert.deepEqual(deltas.filter((delta) => delta.kind === "queues").at(-1)?.queues.nextTurn, [
      { text: "посмотри потом", images: [png] },
    ]);
    await session.close();
  });

  it("publishes the images of a live message beside its text", async () => {
    const { open } = await seeing([{ text: "вижу" }]);
    const session = await open();
    const deltas = recorder(session);

    await session.prompt("что тут", "t1", [png]);

    assert.deepEqual(
      deltas.filter((delta) => delta.kind === "message-images"),
      [{ kind: "message-images", messageId: "t1:1", images: [png] }],
    );
    await session.close();
  });

  it("will not move a branch that already holds an image onto a text-only model", async () => {
    const { open } = await seeing([{ text: "вижу" }]);
    const session = await open();

    await session.prompt("что тут", "t1", [png]);

    // Дело не в этом сообщении, а в контексте: следующий турн всё равно понесёт картинку из ветки.
    // Модель при этом существует и годна — негодна она именно для этой ветки.
    assert.deepEqual(await session.setModel("scripted-model/scripted-model-1-text-only"), {
      kind: "text-only-model",
    });
    assert.equal(session.summary().model, "scripted-model/scripted-model-1");
    await session.close();
  });
});

describe("forking a session", () => {
  it("cuts the history before a question and lives its own life", async () => {
    const { open, store } = await withStore([{ text: "первый" }, { text: "второй" }]);
    const session = await open();

    await session.prompt("первый вопрос", "t1");
    await session.prompt("второй вопрос", "t2");

    const asked = (await session.entries()).entries.filter(
      (entry) => entry.kind === "message" && entry.role === "user",
    );
    const secondQuestion = asked[1];

    assert.ok(secondQuestion !== undefined);

    const forked = await store.fork(session.summary().id, { entryId: secondQuestion.id });

    assert.equal(forked.kind, "forked");

    if (forked.kind !== "forked") {
      return;
    }

    // Форк унаследовал проект и папку, но не второй вопрос и не ответ на него.
    assert.equal(forked.session.summary().projectId, "p1");
    assert.notEqual(forked.session.summary().id, session.summary().id);
    assert.deepEqual(
      (await forked.session.entries()).entries.map((entry) => entry.kind),
      ["model-change", "thinking-level-change", "tools-change", "message", "message"],
    );
    await session.close();
  });

  it("cuts at any entry when asked to include it", async () => {
    const { open, store } = await withStore([{ text: "первый" }]);
    const session = await open();

    await session.prompt("вопрос", "t1");

    const answer = (await session.entries()).entries.at(-1);

    assert.ok(answer !== undefined);

    const forked = await store.fork(session.summary().id, {
      entryId: answer.id,
      position: "at",
    });

    assert.equal(forked.kind, "forked");
    assert.equal(
      forked.kind === "forked" ? (await forked.session.entries()).entries.length : 0,
      // Всё до ответа модели включительно: модель, уровень ризонинга, набор инструментов,
      // вопрос и ответ.
      5,
    );
    await session.close();
  });

  it("refuses to cut before an entry that is not a question", async () => {
    const { open, store } = await withStore([{ text: "первый" }]);
    const session = await open();

    await session.prompt("вопрос", "t1");

    const answer = (await session.entries()).entries.at(-1);

    assert.ok(answer !== undefined);

    const forked = await store.fork(session.summary().id, { entryId: answer.id });

    // Отрезать ответ модели вместе с вопросом осмысленно только в одну сторону, и рантайм это знает.
    assert.equal(forked.kind, "refused");
    await session.close();
  });

  it("says there is nothing to fork when the session is unknown", async () => {
    const { store } = await withStore([]);

    assert.deepEqual(await store.fork("00000000"), { kind: "unknown-session" });
  });
});

describe("naming, counting and removing a session", () => {
  it("keeps the name across a restart of the store", async () => {
    const { open, store, directory, archivedDirectory } = await withStore([]);
    const session = await open();
    const sessionId = session.summary().id;
    const persisted = await store.open(sessionId);

    assert.ok(persisted !== undefined);
    await persisted.setName("  разбор бага  ");

    // Имя видно и живой сессии: сводка у записи и у harness одна.
    assert.equal(session.summary().name, "разбор бага");
    await session.close();

    const restarted = await freshStore(directory, archivedDirectory);

    assert.deepEqual(
      (await restarted.list()).map((summary) => summary.name),
      ["разбор бага"],
    );
  });

  it("clears the name with an empty one", async () => {
    const { open, store, directory, archivedDirectory } = await withStore([]);
    const session = await open();
    const persisted = await store.open(session.summary().id);

    assert.ok(persisted !== undefined);
    await persisted.setName("разбор бага");
    await persisted.setName("");

    assert.equal(session.summary().name, undefined);
    await session.close();

    const restarted = await freshStore(directory, archivedDirectory);

    assert.deepEqual(
      (await restarted.list()).map((summary) => summary.name),
      [undefined],
    );
  });

  it("counts what the session cost, including the branches nobody kept", async () => {
    const { open, store } = await withStore([{ text: "привет" }]);
    const session = await open();
    const persisted = await store.open(session.summary().id);

    assert.ok(persisted !== undefined);
    await session.prompt("скажи", "t1");

    const stats = await persisted.stats();

    // Двойник модели считает расход нулевым, поэтому проверяется то, что от него не зависит:
    // сообщения посчитаны, а не потеряны.
    assert.equal(stats.messageCount, 2);
    assert.equal(stats.totalTokens, 0);
    await session.close();
  });

  it("removes the file and forgets the session", async () => {
    const { open, store, directory } = await withStore([]);
    const session = await open();
    const sessionId = session.summary().id;

    assert.equal(await store.remove(sessionId), true);
    assert.deepEqual(await store.list(), []);
    assert.equal(await store.open(sessionId), undefined);
    assert.equal(await store.remove(sessionId), false);
    assert.deepEqual(await readdir(join(directory, (await readdir(directory))[0] ?? "")), []);
  });
});

describe("archiving a session", () => {
  it("moves the file to the archived root and back", async () => {
    const { open, store, directory, archivedDirectory } = await withStore([{ text: "привет" }]);
    const session = await open();
    const sessionId = session.summary().id;

    await session.prompt("скажи", "t1");
    await session.close();

    assert.deepEqual(await store.archive(sessionId), { kind: "moved" });

    // Переезжает файл, а не папка: опустевшая папка рабочей директории остаётся в действующем
    // корне и никому не мешает — сессий в ней рантайм больше не видит.
    assert.deepEqual(await sessionFiles(directory), []);
    assert.equal((await store.list()).filter((summary) => summary.archived).length, 1);
    assert.match(await onlySessionFile(archivedDirectory), /\.jsonl$/);

    // Архивная сессия цела: по прямому адресу она читается со всеми записями.
    const persisted = await store.open(sessionId);

    assert.ok(persisted !== undefined);
    assert.equal(persisted.summary().archived, true);
    assert.equal((await persisted.entries()).entries.length, 5);

    assert.deepEqual(await store.restore(sessionId), { kind: "moved" });
    assert.deepEqual(await sessionFiles(archivedDirectory), []);
    assert.deepEqual(
      (await store.list()).map((summary) => summary.archived),
      [false],
    );
  });

  it("takes a session already where it is asked to be as done", async () => {
    const { open, store } = await withStore([]);
    const session = await open();

    await session.close();

    assert.deepEqual(await store.restore(session.summary().id), { kind: "moved" });
    assert.deepEqual(await store.archive("00000000"), { kind: "unknown-session" });
  });

  it("keeps writing to the archived file after it moved", async () => {
    const { open, store, archivedDirectory } = await withStore([]);
    const session = await open();
    const sessionId = session.summary().id;

    await session.close();
    await store.archive(sessionId);

    const persisted = await store.open(sessionId);

    assert.ok(persisted !== undefined);
    await persisted.setName("убрано с глаз");

    // Имя ушло в перенесённый файл, а не в старый путь, оставшийся в памяти прежнего владельца.
    const contents = await readFile(await onlySessionFile(archivedDirectory), "utf8");

    assert.match(contents, /убрано с глаз/);
  });
});

describe("reading the branch, the labels and the context", () => {
  it("reads the branch from the leaf and from a named entry", async () => {
    const { open, store } = await withStore([{ text: "первый" }, { text: "второй" }]);
    const session = await open();
    const persisted = await recordOf(store, session);

    await session.prompt("первый вопрос", "t1");
    await session.prompt("второй вопрос", "t2");

    const whole = await persisted.branch();

    assert.equal(whole.kind, "branch");

    if (whole.kind !== "branch") {
      return;
    }

    assert.deepEqual(
      whole.entries.map((entry) => entry.kind),
      [
        "model-change",
        "thinking-level-change",
        "tools-change",
        "message",
        "message",
        "message",
        "message",
      ],
    );
    assert.equal(whole.leafId, whole.entries.at(-1)?.id);

    // Ветка от записи — путь до неё, а не до листа: лист при этом остаётся листом сессии.
    const middle = whole.entries[3];

    assert.ok(middle !== undefined);

    const partial = await persisted.branch(middle.id);

    assert.equal(partial.kind === "branch" ? partial.entries.length : 0, 4);
    assert.equal(partial.kind === "branch" ? partial.leafId : "", whole.leafId);
    assert.deepEqual(await persisted.branch("никакой"), { kind: "unknown-entry" });
    await session.close();
  });

  it("labels an entry, clears the label and folds the records", async () => {
    const { open, store } = await withStore([{ text: "готово" }]);
    const session = await open();
    const persisted = await recordOf(store, session);

    await session.prompt("вопрос", "t1");

    const answer = (await session.entries()).entries.at(-1);

    assert.ok(answer !== undefined);
    assert.deepEqual(await persisted.label(answer.id, "важное"), { kind: "labelled" });
    assert.deepEqual(await persisted.label(answer.id, "важное решение"), { kind: "labelled" });
    assert.deepEqual(
      foldEntryLabels((await session.entries()).entries),
      new Map([[answer.id, "важное решение"]]),
    );

    // Снятие — такая же запись, только без значения, и свёртка обязана видеть именно снятие.
    assert.deepEqual(await persisted.label(answer.id, null), { kind: "labelled" });
    assert.deepEqual(foldEntryLabels((await session.entries()).entries), new Map());

    assert.deepEqual(await persisted.label("никакой", "метка"), { kind: "unknown-entry" });
    await session.close();
  });

  it("counts the context of the branch and names the window of the model", async () => {
    const { open, store } = await withStore([{ text: "готово" }]);
    const session = await open();
    const persisted = await recordOf(store, session);

    const empty = await persisted.contextUsage();

    assert.equal(empty.tokens, 0);
    assert.equal(empty.contextWindow, 128_000);

    await session.prompt("вопрос подлиннее, чтобы токенов стало больше нуля", "t1");

    assert.ok((await persisted.contextUsage()).tokens > 0);
    await session.close();
  });

  it("leaves the window out when the model of the session is gone", async () => {
    const { open, directory, archivedDirectory } = await withStore([{ text: "готово" }]);
    const session = await open();
    const sessionId = session.summary().id;

    await session.prompt("вопрос", "t1");
    await session.close();

    // Пустой каталог моделей: доли контекста не существует, и проценты показывать не из чего.
    const models = createModels();
    const restarted = createAgentSessionStore({
      models,
      directory,
      archivedDirectory,
      sovereignDataDirectory: directory,
      compactionSettings,
    });
    const persisted = await restarted.open(sessionId);

    assert.ok(persisted !== undefined);

    const usage = await persisted.contextUsage();

    assert.ok(usage.tokens > 0);
    assert.equal(usage.contextWindow, undefined);
  });
});

describe("translating every kind of tree entry", () => {
  it("names all eleven kinds the runtime writes and keeps the unknown one visible", async () => {
    const { open, directory, archivedDirectory } = await withStore([]);
    const session = await open();
    const sessionId = session.summary().id;

    await session.close();

    // Часть записей рантайм пишет только изнутри компакции и навигации, а `custom_message` наша
    // поверхность не создаёт вовсе. Проверяется здесь перевод, а не путь их появления, поэтому
    // строки дописываются в файл сессии дословно — ровно в том виде, в каком их пишет Pi.
    const path = await onlySessionFile(directory);
    const written = [
      { type: "compaction", summary: "свёрнуто", tokensBefore: 4096, firstKeptEntryId: "e-9" },
      { type: "compaction", summary: "своё", tokensBefore: 1, fromHook: true },
      { type: "branch_summary", fromId: "e-1", summary: "пересказ ветки" },
      { type: "label", targetId: "e-1", label: "важное" },
      { type: "label", targetId: "e-1" },
      { type: "session_info", name: "разбор бага" },
      { type: "session_info" },
      { type: "leaf", targetId: "e-1" },
      { type: "leaf", targetId: null },
      { type: "custom", customType: "sovereign.degraded", data: { kind: "tool" } },
      {
        type: "custom_message",
        customType: "sovereign.note",
        content: [
          { type: "text", text: "первая часть " },
          { type: "text", text: "и вторая" },
        ],
        display: true,
      },
      { type: "из будущей версии pi" },
    ];

    await appendFile(
      path,
      written
        .map((entry, index) =>
          JSON.stringify({
            ...entry,
            id: `raw-${String(index)}`,
            parentId: null,
            timestamp: "2026-07-31T00:00:00.000Z",
          }),
        )
        .join("\n") + "\n",
    );

    const reread = await (await freshStore(directory, archivedDirectory)).open(sessionId);

    assert.ok(reread !== undefined);

    const entries = (await reread.entries()).entries.slice(-written.length);

    assert.deepEqual(
      entries.map((entry) => entry.kind),
      [
        "compaction",
        "compaction",
        "branch-summary",
        "label",
        "label",
        "session-name",
        "session-name",
        "leaf",
        "leaf",
        "custom",
        "custom-message",
        "other",
      ],
    );
    assert.deepEqual(entries[0], {
      id: "raw-0",
      time: "2026-07-31T00:00:00.000Z",
      kind: "compaction",
      summary: "свёрнуто",
      tokensBefore: 4096,
      firstKeptEntryId: "e-9",
      // Поля у Pi нет — значит компакцию считал сам harness, а не подсунул хук.
      fromHook: false,
    });
    assert.equal(entries[1]?.kind === "compaction" ? entries[1].fromHook : undefined, true);
    assert.equal(
      entries[1]?.kind === "compaction" ? entries[1].firstKeptEntryId : "нет",
      undefined,
    );
    assert.deepEqual(entries[3], {
      id: "raw-3",
      time: "2026-07-31T00:00:00.000Z",
      kind: "label",
      targetId: "e-1",
      label: "важное",
    });
    // Снятая метка — запись без значения, а не с пустым.
    assert.equal(entries[4]?.kind === "label" ? entries[4].label : "нет", undefined);
    assert.equal(entries[6]?.kind === "session-name" ? entries[6].name : "нет", undefined);
    // Лист, вернувший дерево в пустое состояние, приезжает без цели.
    assert.equal(entries[8]?.kind === "leaf" ? entries[8].targetId : "нет", undefined);
    assert.deepEqual(entries[9], {
      id: "raw-9",
      time: "2026-07-31T00:00:00.000Z",
      kind: "custom",
      type: "sovereign.degraded",
      data: { kind: "tool" },
    });
    // Содержимое своего сообщения бывает массивом блоков: текстовые склеиваются по порядку.
    assert.deepEqual(entries[10], {
      id: "raw-10",
      time: "2026-07-31T00:00:00.000Z",
      kind: "custom-message",
      type: "sovereign.note",
      text: "первая часть и вторая",
      display: true,
    });
    assert.deepEqual(entries[11], {
      id: "raw-11",
      time: "2026-07-31T00:00:00.000Z",
      kind: "other",
      type: "из будущей версии pi",
    });
  });
});

describe("compacting the context", () => {
  it("writes a compaction the platform built itself, honouring our keepRecentTokens", async () => {
    // Четыре ответа: два турна и два пересказа. Пересказов два, потому что срез по хвосту в один
    // токен разрезает турн пополам, а разрезанный турн Pi пересказывает вторым запросом.
    const { open, requests, store } = await withStore(
      [
        { text: "первый ответ" },
        { text: "второй ответ" },
        { text: "вот пересказ" },
        { text: "и хвост турна" },
      ],
      undefined,
      undefined,
      () => ({ reserveTokens: 4096, keepRecentTokens: 1 }),
    );
    const session = await open();
    const persisted = await recordOf(store, session);

    await session.prompt("первый вопрос", "t1");
    await session.prompt("второй вопрос", "t2");

    assert.deepEqual(await session.compact(), { kind: "done" });

    const entries = (await session.entries()).entries;
    const written = entries.at(-1);

    assert.ok(written?.kind === "compaction");
    assert.match(written.summary, /вот пересказ/);
    // Компакцию собрала платформа, а не рантайм: иначе наши `reserveTokens` и `keepRecentTokens`
    // применить было бы негде (docs/agent-runtime-contract.md).
    assert.equal(written.fromHook, true);
    assert.ok(written.tokensBefore > 0);

    // `keepRecentTokens: 1` обрезает разговор почти целиком, поэтому пересказывать уехал первый
    // вопрос: по этому и видно, что наши настройки доехали до подготовки, а не остались словами.
    assert.match(JSON.stringify(requests.slice(2)), /первый вопрос/);

    // Свёрнутая ветка кончается компакцией, и второй раз сворачивать нечего.
    const branch = await persisted.branch();

    assert.equal(branch.kind === "branch" ? branch.entries.at(-1)?.kind : "нет", "compaction");
    await session.close();
  });

  it("keeps the whole conversation out of the summary when the tail budget is large", async () => {
    const { open, requests } = await withStore([
      { text: "первый ответ" },
      { text: "вот пересказ" },
    ]);
    const session = await open();

    await session.prompt("первый вопрос", "t1");

    assert.deepEqual(await session.compact(), { kind: "done" });

    // Хвост в двадцать тысяч токенов покрывает весь разговор: пересказывать оказалось нечего, и в
    // запрос уехала пустая история. Это та же настройка, только с другим значением.
    assert.doesNotMatch(JSON.stringify(requests.at(-1)?.messages ?? []), /первый вопрос/);
    await session.close();
  });

  it("answers busy instead of throwing while a turn runs", async () => {
    const { open } = await withStore([{ text: "первый" }, { text: "пересказ" }]);
    const session = await open();

    const running = session.prompt("первый", "t1");
    const refused = await session.compact();

    assert.deepEqual(refused, { kind: "busy" });
    await running;
    await session.close();
  });
});

describe("navigating the tree", () => {
  it("moves the leaf back to a question and hands its text to the editor", async () => {
    const { open } = await withStore([{ text: "первый ответ" }, { text: "второй ответ" }]);
    const session = await open();

    await session.prompt("первый вопрос", "t1");
    await session.prompt("второй вопрос", "t2");

    const questions = (await session.entries()).entries.filter(
      (entry) => entry.kind === "message" && entry.role === "user",
    );
    const second = questions[1];

    assert.ok(second !== undefined);

    const moved = await session.navigate({ entryId: second.id });

    assert.equal(moved.kind, "navigated");

    if (moved.kind !== "navigated") {
      return;
    }

    // Целью была реплика человека, поэтому листом стал её родитель, а текст уехал в ответ: иначе
    // переспросить иначе было бы нечем (docs/sessions-and-projects.md).
    assert.equal(moved.editorText, "второй вопрос");
    assert.equal(moved.leafId, second.parentId);
    assert.equal(moved.summarized, false);
    assert.equal(moved.cancelled, false);
    await session.close();
  });

  it("summarizes the branch it leaves when asked to", async () => {
    const { open, requests } = await withStore([
      { text: "первый ответ" },
      { text: "второй ответ" },
      { text: "пересказ покинутой ветки" },
    ]);
    const session = await open();

    await session.prompt("первый вопрос", "t1");
    await session.prompt("второй вопрос", "t2");

    const questions = (await session.entries()).entries.filter(
      (entry) => entry.kind === "message" && entry.role === "user",
    );
    const second = questions[1];

    assert.ok(second !== undefined);

    const moved = await session.navigate({
      entryId: second.id,
      summarize: true,
      instructions: "коротко",
    });

    assert.equal(moved.kind === "navigated" ? moved.summarized : false, true);
    assert.match(JSON.stringify(requests.at(-1)?.messages ?? []), /коротко/);

    const summary = (await session.entries()).entries.at(-1);

    assert.equal(summary?.kind, "branch-summary");
    assert.match(
      summary?.kind === "branch-summary" ? summary.summary : "",
      /пересказ покинутой ветки/,
    );
    await session.close();
  });

  it("says the entry is unknown instead of throwing", async () => {
    const { open } = await withStore([]);
    const session = await open();

    assert.deepEqual(await session.navigate({ entryId: "никакой" }), { kind: "unknown-entry" });
    await session.close();
  });
});

/** Запись той же сессии: у файла один владелец, поэтому это тот же экземпляр, а не второй. */
async function recordOf(store: AgentSessionStore, session: AgentSession) {
  const persisted = await store.open(session.summary().id);

  assert.ok(persisted !== undefined);

  return persisted;
}

/** Файлы сессий в корне, по всем папкам рабочих директорий. Пустая папка сессией не считается. */
async function sessionFiles(root: string): Promise<string[]> {
  const found: string[] = [];

  for (const folder of await readdir(root)) {
    for (const file of await readdir(join(root, folder))) {
      found.push(file);
    }
  }

  return found;
}

async function onlySessionFile(directory: string): Promise<string> {
  const [sessionDirectory] = await readdir(directory);

  assert.ok(sessionDirectory !== undefined);

  const [sessionFile] = await readdir(join(directory, sessionDirectory));

  assert.ok(sessionFile !== undefined);

  return join(directory, sessionDirectory, sessionFile);
}

/** Второй стор на тех же корнях: так проверяется переживание перезапуска демона. */
async function freshStore(
  directory: string,
  archivedDirectory: string,
): Promise<AgentSessionStore> {
  const scripted = scriptedModelProvider({ turns: [] });
  const models = createModels();

  models.setProvider(scripted.provider);

  return createAgentSessionStore({
    models,
    directory,
    archivedDirectory,
    sovereignDataDirectory: directory,
    compactionSettings,
  });
}

/**
 * Двойник шва подписок: сведение ответов живёт в ядре, а рантайму отдаётся результат. Здесь он
 * задаётся тестом — иначе проверялось бы сведение, а не то, как рантайм зовёт хуки.
 */
function hookSeam(answers: {
  events?: RuntimeHookName[];
  rewrite?: (
    event: RuntimeHookName,
    payload: object,
  ) => Awaited<ReturnType<SessionHookSeam["rewrite"]>>;
  decide?: (
    event: RuntimeHookName,
    payload: unknown,
  ) => Awaited<ReturnType<SessionHookSeam["decide"]>>;
  permission?: (call: {
    tool: string;
    arguments: unknown;
  }) => Awaited<ReturnType<SessionHookSeam["permission"]>>;
}) {
  const observed: { event: RuntimeHookName; payload: unknown }[] = [];
  const rewritten: { event: RuntimeHookName; payload: object }[] = [];
  const decided: { event: RuntimeHookName; payload: unknown }[] = [];
  const asked: { tool: string; arguments: unknown }[] = [];
  const sessions: SessionHookContext[] = [];
  const subscribed = new Set(answers.events ?? []);

  return {
    observed,
    rewritten,
    decided,
    asked,
    /** Контексты, с которыми шов спрашивали: по ним видно, что он берётся один раз на сессию. */
    sessions,
    seam: {
      for: (session) => {
        sessions.push(session);

        return {
          subscribed: (event) => subscribed.has(event),
          observe: (event, payload) => {
            observed.push({ event, payload });
          },
          rewrite: async (event, payload) => {
            rewritten.push({ event, payload });

            return answers.rewrite?.(event, payload) ?? { patch: undefined };
          },
          decide: async (event, payload) => {
            decided.push({ event, payload });

            return answers.decide?.(event, payload) ?? { refusals: [] };
          },
          permission: async (call) => {
            asked.push(call);

            return answers.permission?.(call) ?? { refusals: [] };
          },
        };
      },
    } satisfies RuntimeHookSeam,
  };
}

describe("the seam of hook subscriptions", () => {
  it("fans out the observing events of a turn and keeps the intercepting ones out of it", async () => {
    const hooks = hookSeam({});
    const { open } = await withStore(
      [{ text: "ответ" }],
      undefined,
      undefined,
      undefined,
      hooks.seam,
    );
    const session = await open();

    await session.prompt("вопрос", "t1");

    const names = new Set(hooks.observed.map((entry) => entry.event));

    // Наблюдение не спрашивает, есть ли подписчик: `subscribed` у этого шва пуст, а события всё
    // равно доехали — их не ждут, и решать, нужны ли они, будет сведение.
    assert.equal(names.has("turn_start"), true);
    assert.equal(names.has("message_update"), true);
    assert.equal(names.has("settled"), true);

    // Перехватывающие идут своими обработчиками: подписчик, получивший событие и наблюдением, и
    // вмешательством, увидел бы его дважды.
    assert.equal(names.has("context"), false);
    assert.equal(names.has("before_agent_start"), false);
    await session.close();
  });

  it("hands the model what a rewriting subscriber left of the context", async () => {
    const hooks = hookSeam({
      events: ["context"],
      rewrite: () => ({
        patch: {
          messages: [{ role: "user", content: [{ type: "text", text: "переписано подписчиком" }] }],
        },
      }),
    });
    const { open, requests } = await withStore(
      [{ text: "ответ" }],
      undefined,
      undefined,
      undefined,
      hooks.seam,
    );
    const session = await open();

    await session.prompt("исходный вопрос", "t1");

    // Перезапись доехала до провайдера: иначе хук был бы наблюдением, названным вмешательством.
    assert.match(saidToModel(requests, 0), /переписано подписчиком/);
    assert.doesNotMatch(saidToModel(requests, 0), /исходный вопрос/);
    assert.deepEqual(
      hooks.rewritten.map((entry) => entry.event),
      ["context"],
    );
    await session.close();
  });

  it("leaves the turn alone when a subscriber changed nothing", async () => {
    const hooks = hookSeam({ events: ["context", "before_agent_start"] });
    const { open, requests } = await withStore(
      [{ text: "ответ" }],
      undefined,
      undefined,
      undefined,
      hooks.seam,
    );
    const session = await open();

    assert.equal((await session.prompt("исходный вопрос", "t1")).kind, "done");

    // Пустая поправка — это «ничего не менялось»: пустой объект рантайм принял бы за результат и
    // применил бы поправку без полей.
    assert.match(saidToModel(requests, 0), /исходный вопрос/);
    await session.close();
  });

  it("stops the turn with the author when a critical subscriber did not answer", async () => {
    const hooks = hookSeam({
      events: ["context"],
      rewrite: () => ({
        patch: undefined,
        aborted: { contributionId: "guard.slow", reason: "did not answer in 5000 ms" },
      }),
    });
    const { open } = await withStore(
      [{ text: "ответ" }],
      undefined,
      undefined,
      undefined,
      hooks.seam,
    );
    const session = await open();

    const outcome = await session.prompt("вопрос", "t1");

    assert.equal(outcome.kind, "failed");
    assert.match(outcome.kind === "failed" ? outcome.reason : "", /guard\.slow/);
    assert.match(outcome.kind === "failed" ? outcome.reason : "", /did not answer in 5000 ms/);
    await session.close();
  });

  it("blocks a tool call the deciding subscribers refused, naming every author", async () => {
    const hooks = hookSeam({
      events: ["tool_call"],
      decide: () => ({ refusals: [{ contributionId: "guard.paths", reason: "чужая папка" }] }),
      // Хук платформы спрашивается рядом с событием Pi: у события нет ни сессии, ни папки, а отказы
      // сводятся вместе (docs/hooks.md).
      permission: () => ({
        refusals: [{ contributionId: "guard.hours", reason: "нерабочее время" }],
      }),
    });
    const { open } = await withStore(
      [
        { toolCalls: [{ id: "c1", name: "read", arguments: { path: "/etc/hosts" } }] },
        { text: "не вышло" },
      ],
      undefined,
      undefined,
      undefined,
      hooks.seam,
    );
    const session = await open();

    await session.prompt("прочитай", "t1");

    // Причина одна, авторов столько, сколько отказало: инструмент запретили вместе.
    assert.match(JSON.stringify(hooks.decided), /"toolName":"read"/);
    assert.deepEqual(hooks.asked, [{ tool: "read", arguments: { path: "/etc/hosts" } }]);

    const entries = (await session.entries()).entries;
    const results = JSON.stringify(entries);

    assert.match(results, /guard\.paths: чужая папка/);
    assert.match(results, /guard\.hours: нерабочее время/);
    await session.close();
  });

  it("makes the platform the first link of the compaction chain", async () => {
    const hooks = hookSeam({ events: ["session_before_compact"] });
    const { open } = await withStore(
      [{ text: "первый ответ" }, { text: "вот пересказ" }],
      undefined,
      undefined,
      () => ({ reserveTokens: 4096, keepRecentTokens: 1 }),
      hooks.seam,
    );
    const session = await open();

    await session.prompt("первый вопрос", "t1");

    assert.deepEqual(await session.compact(), { kind: "done" });

    const asked = hooks.rewritten.at(0);

    // Платформа управляет параметрами компакции, плагин видит уже подготовленное: наше решение
    // приехало подписчику частью нагрузки, а не осталось за кадром (docs/hooks.md).
    assert.equal(asked?.event, "session_before_compact");
    assert.match(JSON.stringify(asked?.payload ?? {}), /вот пересказ/);

    // Сигнал отмены границу воркера не переживает, поэтому в нагрузке его нет вовсе.
    assert.equal("signal" in (asked?.payload ?? {}), false);
    await session.close();
  });

  it("takes the seam of the session once, with the session, the project and the folder", async () => {
    const hooks = hookSeam({});
    const { open, folder } = await withStore(
      [{ text: "первый" }, { text: "второй" }],
      undefined,
      undefined,
      undefined,
      hooks.seam,
    );
    const session = await open();

    await session.prompt("раз", "t1");
    await session.prompt("два", "t2");

    // Контекст сессии от события к событию не меняется, а `message_update` публикуется на каждую
    // дельту стриминга: спрашивать шов на каждое событие значило бы платить за это на горячем пути.
    assert.deepEqual(hooks.sessions, [
      { sessionId: session.summary().id, projectId: "p1", folder },
    ]);
    await session.close();
  });
});
