import assert from "node:assert/strict";
import { appendFile, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";

import { createModels } from "@earendil-works/pi-ai";
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

async function withStore(turns: ScriptedTurn[], projectFolder?: string) {
  const scripted = scriptedModelProvider({ turns });
  const models = createModels();

  models.setProvider(scripted.provider);

  const directory = await freshFolder("sessions");
  const folder = projectFolder ?? (await freshFolder("project"));
  const store = createAgentSessionStore({ models, directory });

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

  return { store, open, folder, directory };
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
    const { open, store, directory, folder } = await withStore([{ text: "привет" }]);
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
    const persisted = await (await freshStore(directory)).open(listed[0]?.id ?? "");

    assert.ok(persisted !== undefined);
    const reopened = persisted.activate(agent);

    assert.ok(!("kind" in reopened));
    assert.equal((await reopened.entries()).entries.length, 5);
    await reopened.close();
  });

  it("reads a persisted session after its model disappears", async () => {
    const { open, directory } = await withStore([{ text: "привет" }]);
    const session = await open();

    await session.prompt("скажи", "t1");
    const sessionId = session.summary().id;
    await session.close();

    const models = createModels();
    const restarted = createAgentSessionStore({ models, directory });
    const listed = await restarted.list();
    const persisted = await restarted.open(sessionId);

    assert.equal(listed[0]?.id, sessionId);
    assert.ok(persisted !== undefined);
    assert.equal((await persisted.entries()).entries.length, 5);
    assert.deepEqual(persisted.activate(agent), { kind: "unknown-model" });
  });

  it("keeps one owner per session file", async () => {
    const { open, store, directory } = await withStore([
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
    const reread = await (await freshStore(directory)).open(sessionId);

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

async function onlySessionFile(directory: string): Promise<string> {
  const [sessionDirectory] = await readdir(directory);

  assert.ok(sessionDirectory !== undefined);

  const [sessionFile] = await readdir(join(directory, sessionDirectory));

  assert.ok(sessionFile !== undefined);

  return join(directory, sessionDirectory, sessionFile);
}

/** Второй стор на той же директории: так проверяется переживание перезапуска демона. */
async function freshStore(directory: string): Promise<AgentSessionStore> {
  const scripted = scriptedModelProvider({ turns: [] });
  const models = createModels();

  models.setProvider(scripted.provider);

  return createAgentSessionStore({ models, directory });
}
