import assert from "node:assert/strict";
import { appendFile, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";

import { createModels } from "@earendil-works/pi-ai";
import type { Context } from "@earendil-works/pi-ai";
import type { SessionDelta } from "@sovereign/protocol";

import {
  createAgentSessionStore,
  createCoreTools,
  type AgentSession,
  type AgentSessionStore,
} from "./agent-session.ts";
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

const agent = { id: "base-agent.agent", instructions: "ты двойник" };

async function withStore(
  turns: ScriptedTurn[],
  projectFolder?: string,
  beforeAnswer?: (index: number) => void,
) {
  const scripted = scriptedModelProvider({
    turns,
    ...(beforeAnswer === undefined ? {} : { beforeAnswer }),
  });
  const models = createModels();

  models.setProvider(scripted.provider);

  const directory = await freshFolder("sessions");
  const archivedDirectory = await freshFolder("sessions-archived");
  const folder = projectFolder ?? (await freshFolder("project"));
  const store = createAgentSessionStore({ models, directory, archivedDirectory });

  const open = async (): Promise<AgentSession> => {
    const created = await store.create({
      projectId: "p1",
      agentId: agent.id,
      folder,
      folderKey: folder.toLowerCase(),
      model: `scripted-model/${scripted.model.id}`,
      thinkingLevel: "off",
      agent,
    });

    assert.ok(!("kind" in created), "модель двойника обязана резолвиться");
    await created.setTools(createCoreTools(), ["bash", "read", "write", "edit"]);

    return created;
  };

  return { store, open, folder, directory, archivedDirectory, requests: scripted.requests };
}

/** Что уехало модели в обращении с этим номером: по нему видно, доехал ли стиринг до разговора. */
function saidToModel(requests: Context[], index: number): string {
  return JSON.stringify(requests[index]?.messages ?? []);
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

    assert.deepEqual(await session.prompt("скажи что-нибудь", "t1"), { kind: "done" });

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
    assert.deepEqual(await running, { kind: "done" });
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
    const restarted = createAgentSessionStore({ models, directory, archivedDirectory });
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
      "возьми левее",
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
    assert.deepEqual(session.queues().nextTurn, ["не забудь про тесты"]);

    // Прерывание чистит стиринг и догоняющее, но не сообщение к следующему турну: оно про турн,
    // которого ещё не было.
    await session.abort();
    assert.deepEqual(session.queues().nextTurn, ["не забудь про тесты"]);

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

  return createAgentSessionStore({ models, directory, archivedDirectory });
}
