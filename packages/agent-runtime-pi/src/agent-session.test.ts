import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
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

    // Открытие поднимает harness заново и видит записанное: сессия переживает перезапуск демона.
    const reopened = await (await freshStore(directory)).open(listed[0]?.id ?? "", agent);

    assert.ok(reopened !== undefined);
    assert.equal((await reopened.entries()).entries.length, 5);
    await reopened.close();
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
});

/** Второй стор на той же директории: так проверяется переживание перезапуска демона. */
async function freshStore(directory: string): Promise<AgentSessionStore> {
  const scripted = scriptedModelProvider({ turns: [] });
  const models = createModels();

  models.setProvider(scripted.provider);

  return createAgentSessionStore({ models, directory });
}
