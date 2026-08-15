import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { LogRecord } from "@sovereign/protocol";
import type { PluginContribution } from "@sovereign/sdk";

import { createContributionRegistry, type ContributingPlugin } from "./contribution-registry.ts";
import { createLogger } from "../platform/public.ts";
import type { PluginCallOutcome } from "./plugin-supervisor.ts";
import type { PluginCall } from "./plugin-wire.ts";
import { pluginToolSource } from "./plugin-tools.ts";
import type { CollectedTool } from "../sessions/public.ts";

const weather: ContributingPlugin = { key: "data:weather", id: "weather", source: "data" };
const context = { projectId: "p1", folder: "/tmp/project", sessionId: "s1" };
const timeout = 120_000;

const forecast: PluginContribution = {
  kind: "tool",
  id: "forecast",
  description: "говорит погоду",
  parameters: { type: "object", properties: { city: { type: "string" } } },
};

/** Ручка Pi глазами теста: ядру она непрозрачна, но модель зовёт именно её. */
type PiHandle = {
  name: string;
  label: string;
  description: string;
  parameters: object;
  execute: (
    toolCallId: string,
    params: unknown,
  ) => Promise<{ content: { type: string; text: string }[]; details: unknown; isError: boolean }>;
};

function world(answer: (call: PluginCall) => PluginCallOutcome, disabled: string[] = []) {
  const records: LogRecord[] = [];
  const asked: { pluginKey: string; call: PluginCall; timeoutMilliseconds: number }[] = [];
  const registry = createContributionRegistry();

  registry.applyPlugin(weather, [forecast], new Set(disabled));

  return {
    records,
    asked,
    source: pluginToolSource({
      registry,
      plugins: {
        call: async (pluginKey, call, waiting) => {
          asked.push({ pluginKey, call, timeoutMilliseconds: waiting.timeoutMilliseconds });

          return answer(call);
        },
      },
      timeoutMilliseconds: () => timeout,
      dataDirectory: () => "/test-data",
      logger: createLogger({
        source: "core",
        level: () => "debug",
        write: (record) => records.push(record),
      }),
    }),
  };
}

const handleOf = (collected: CollectedTool): PiHandle => collected.tool as PiHandle;

const answered = (content: string): PluginCallOutcome => ({
  kind: "value",
  value: { content, isError: false },
});

describe("the tools of a plugin as a source of the collection", () => {
  it("collects a tool under the name the model calls and the group of its plugin", async () => {
    const { source } = world(() => answered("ясно"));

    const collected = await source.collect(context);

    // Имя — объявленный идентификатор, без неймспейса: точку в имени инструмента провайдеры не
    // принимают. Группа — плагин, порядок внутри группы остаётся за именем (docs/hooks.md).
    assert.deepEqual(
      collected.map((tool) => [tool.name, tool.group, tool.order]),
      [["forecast", "weather", 0]],
    );

    const handle = handleOf(collected[0]!);

    assert.equal(handle.description, "говорит погоду");
    assert.deepEqual(handle.parameters, forecast.kind === "tool" ? forecast.parameters : {});
  });

  it("brings the text of the plugin to the model and asks with the wait of its own key", async () => {
    const { source, asked } = world(() => answered("в Тбилиси ясно"));

    const collected = await source.collect(context);
    const result = await handleOf(collected[0]!).execute("c1", { city: "Тбилиси" });

    assert.deepEqual(result.content, [{ type: "text", text: "в Тбилиси ясно" }]);
    assert.equal(result.isError, false);

    // Своё ожидание, а не таймаут хуков: инструмент ходит в сеть, и пять секунд запретили бы такие
    // инструменты вовсе (docs/data-directory.md).
    assert.deepEqual(asked, [
      {
        pluginKey: "data:weather",
        call: {
          kind: "tool",
          contributionId: "forecast",
          arguments: { city: "Тбилиси" },
          // Обратный адрес вызова: набор собран под сессию, и она едет вместе с вызовом.
          invocation: {
            sessionId: "s1",
            projectId: "p1",
            folder: "/tmp/project",
            dataDirectory: "/test-data",
            callTimeoutMilliseconds: timeout,
          },
        },
        timeoutMilliseconds: timeout,
      },
    ]);
  });

  it("carries the context of the collection into every call of the tool", async () => {
    const { source, asked } = world(() => answered("ясно"));

    const collected = await source.collect({
      projectId: "p2",
      folder: "/tmp/other",
      sessionId: "s2",
    });

    await handleOf(collected[0]!).execute("c1", {});

    assert.deepEqual(asked[0]?.call.kind === "tool" ? asked[0].call.invocation : undefined, {
      sessionId: "s2",
      projectId: "p2",
      folder: "/tmp/other",
      dataDirectory: "/test-data",
      callTimeoutMilliseconds: timeout,
    });
  });

  it("gives the model an error result with the author when the plugin did not answer in time", async () => {
    const { source, records } = world(() => ({ kind: "timed-out", waitedMilliseconds: timeout }));

    const collected = await source.collect(context);
    const result = await handleOf(collected[0]!).execute("c1", {});

    // Турн продолжается: инструмент, который не ответил, — это результат-ошибка, а не обрыв работы.
    assert.equal(result.isError, true);
    assert.match(result.content[0]?.text ?? "", /weather\.forecast failed: did not answer in/);
    assert.equal(
      records.some(
        (record) => record.message === "the tool of the plugin did not answer with a result",
      ),
      true,
    );
  });

  it("gives the model an error result when the call failed", async () => {
    const { source } = world(() => ({ kind: "failed", reason: "the plugin is gone" }));

    const collected = await source.collect(context);
    const result = await handleOf(collected[0]!).execute("c1", {});

    assert.equal(result.isError, true);
    assert.match(result.content[0]?.text ?? "", /the plugin is gone/);
  });

  it("keeps the mark of failure the plugin set itself", async () => {
    const { source } = world(() => ({
      kind: "value",
      value: { content: "город не найден", isError: true },
    }));

    const collected = await source.collect(context);
    const result = await handleOf(collected[0]!).execute("c1", {});

    assert.deepEqual(result.content, [{ type: "text", text: "город не найден" }]);
    assert.equal(result.isError, true);
  });

  it("calls an answer that is not a result a failure of the tool, and says so", async () => {
    const { source, records } = world(() => ({ kind: "value", value: { temperature: 25 } }));

    const collected = await source.collect(context);
    const result = await handleOf(collected[0]!).execute("c1", {});

    assert.equal(result.isError, true);
    assert.equal(
      records.some(
        (record) =>
          record.message === "the tool of the plugin answered with something that is not a result",
      ),
      true,
    );
  });

  it("collects nothing for a switched-off contribution", async () => {
    const { source } = world(() => answered("ясно"), ["weather.forecast"]);

    // Инструмент исчезает вместе с выключенным вкладом, и набор пересобирается перед каждым турном.
    assert.deepEqual(await source.collect(context), []);
  });
});
