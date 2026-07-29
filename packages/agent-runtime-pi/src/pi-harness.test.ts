/**
 * Проверка, что harness Pi действительно работает так, как описано в docs/agent-runtime-contract.md.
 * До этого теста ни один турн через Pi в репозитории не проходил, и весь контракт держался на
 * чтении исходников. Остальной срез опирается на то, что здесь зелено.
 */

import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import {
  AgentHarness,
  createWriteTool,
  InMemorySessionStorage,
  Session,
  type AgentHarnessEvent,
  type ExecutionToolContext,
} from "@earendil-works/pi-agent-core";
import { NodeExecutionEnv } from "@earendil-works/pi-agent-core/node";
import { createModels } from "@earendil-works/pi-ai";

import { scriptedModelProvider, type ScriptedTurn } from "./testing.ts";

type Harnessed = {
  harness: AgentHarness<ExecutionToolContext>;
  session: Session;
  types: string[];
  events: AgentHarnessEvent[];
};

function harnessed(turns: ScriptedTurn[], cwd: string): Harnessed {
  const scripted = scriptedModelProvider({ turns });
  const models = createModels();

  models.setProvider(scripted.provider);

  const session = new Session(new InMemorySessionStorage());
  const harness = new AgentHarness<ExecutionToolContext>({
    session,
    models,
    model: scripted.model,
    tools: [createWriteTool()],
    toolContext: { env: new NodeExecutionEnv({ cwd }) },
    systemPrompt: "ты двойник",
  });

  const types: string[] = [];
  const events: AgentHarnessEvent[] = [];

  harness.subscribe((event) => {
    types.push(event.type);
    events.push(event);
  });

  return { harness, session, types, events };
}

describe("running a turn through the pi harness", () => {
  it("streams the answer in deltas and keeps it in the session", async () => {
    const { harness, session, types, events } = harnessed(
      [{ text: "привет, я двойник модели" }],
      tmpdir(),
    );

    const answer = await harness.prompt("скажи что-нибудь");

    assert.equal(answer.stopReason, "stop");
    assert.deepEqual(
      types.filter((type) => type.startsWith("agent_") || type.startsWith("turn_")),
      ["agent_start", "turn_start", "turn_end", "agent_end"],
    );

    const deltas = events
      .filter((event) => event.type === "message_update")
      .map((event) => event.assistantMessageEvent)
      .filter((event) => event.type === "text_delta")
      .map((event) => event.delta);

    assert.ok(deltas.length > 1, "ответ должен приехать дельтами, а не одним куском");
    assert.equal(deltas.join(""), "привет, я двойник модели");

    // Записи попадают в дерево сессии сами: платформа их туда не кладёт.
    const entries = await session.getEntries();
    const roles = entries
      .filter((entry) => entry.type === "message")
      .map((entry) => entry.message.role);

    assert.deepEqual(roles, ["user", "assistant"]);
  });

  it("lets the model change a file in the working folder", async () => {
    const folder = await mkdtemp(join(tmpdir(), "sovereign-harness-"));

    try {
      const { harness, types } = harnessed(
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

      await harness.prompt("создай файл");

      assert.deepEqual(
        types.filter((type) => type.startsWith("tool_execution_")),
        ["tool_execution_start", "tool_execution_end"],
      );
      assert.equal(await readFile(join(folder, "hello.txt"), "utf8"), "привет");
    } finally {
      await rm(folder, { recursive: true, force: true });
    }
  });

  it("refuses a second turn while the first one runs", async () => {
    const { harness } = harnessed([{ text: "первый" }, { text: "второй" }], tmpdir());

    const running = harness.prompt("первый");
    const rejected = harness.prompt("второй");

    await assert.rejects(rejected, /busy/i);
    await running;
  });
});
