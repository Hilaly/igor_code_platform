/**
 * Истории каталога: примитивы вью чата. Настоящий потребитель у них есть — `apps/web/src/sessions/`,
 * — но там их видно только с поднятым демоном и настроенным провайдером, а расхождение в отступах
 * между репликой человека, ответом агента и служебной строкой видно только когда они стоят рядом.
 *
 * Строки в историях — литералы, и это единственное место в ките, где так можно: каталог не
 * поставляется пользователю (docs/ui-kit.md).
 */

import { useState } from "react";

import type { ThinkingLevel } from "@sovereign/protocol";

import { Markdown } from "./markdown.tsx";
import { Message, MessageFeed } from "./message-feed.tsx";
import { NextTurnPicker } from "./next-turn-picker.tsx";
import { StreamingText } from "./streaming-text.tsx";
import { ToolCall } from "./tool-call.tsx";

const column = {
  display: "flex",
  flexDirection: "column",
  gap: "var(--sovereign-space-4)",
  maxWidth: "42rem",
} as const;

const answer = `## Что сделано

Правка легла в \`apps/daemon/src/sessions.ts\`. Порядок такой:

1. очередь отвечает первой — сессия в ней **уже занята**;
2. рантайм отвечает вторым;
3. остальное — \`idle\`.

| фаза     | кто ответил |
| -------- | ----------- |
| \`queued\` | очередь     |
| \`turn\`   | рантайм     |

\`\`\`ts
const phase = queue.stateOf(id) === "queued" ? "queued" : runtime.phase();
\`\`\`

> Ссылка на разбор: [sessions-and-projects.md](https://example.org/sessions).
`;

export const AgentMarkdown = () => (
  <div style={column}>
    <Markdown text={answer} />
  </div>
);

export const Arriving = () => (
  <div style={column}>
    <StreamingText text={"Смотрю очередь.\nПохоже, фаза берётся из"} streaming label="Ответ" />
    <StreamingText text="Готово: правка легла в sessions.ts." streaming={false} />
  </div>
);

export const Feed = () => (
  <div style={{ ...column, height: "28rem", border: "1px solid var(--sovereign-border)" }}>
    <MessageFeed label="Переписка" busy>
      <Message role="human" header="10:11">
        Почему фаза сессии в очереди — `queued`, а не `turn`?
      </Message>
      <Message role="agent" header="10:11">
        <Markdown text="Очередь отвечает первой: для рантайма такая сессия **ещё простаивает**." />
      </Message>
      <Message role="agent">
        <ToolCall
          icon="◇"
          toolName="search_files"
          summary="apps/daemon/src/sessions/session-runtime-coordinator/session-runtime-coordinator.ts"
          status="running"
          statusLabel="Выполняется"
          argumentsText={'{\n  "path": "apps/daemon/src/sessions",\n  "query": "queue.stateOf"\n}'}
        />
      </Message>
      <Message role="agent">
        <Markdown text="Нашёл место, где очередь сравнивается с состоянием рантайма. Читаю соседние ветки." />
      </Message>
      <Message role="agent">
        <ToolCall
          icon="↳"
          toolName="read_file"
          summary="apps/daemon/src/sessions/session-runtime-coordinator/session-runtime-coordinator.ts"
          duration="42 ms"
          status="done"
          statusLabel="Готово"
          argumentsText={
            '{\n  "path": "apps/daemon/src/sessions/session-runtime-coordinator/session-runtime-coordinator.ts",\n  "line": 118\n}'
          }
          output={
            '118  const queued = queue.stateOf(sessionId) === "queued";\n119  const phase = queued ? "queued" : runtime.phase();\n120  return { phase };'
          }
          outputLabel="Вывод"
        />
      </Message>
      <Message role="agent">
        <Markdown text="Проверю старый путь, чтобы исключить вторую реализацию." />
      </Message>
      <Message role="agent">
        <ToolCall
          icon="!"
          toolName="read_file"
          summary="apps/daemon/src/sessions/legacy/session-phase.ts"
          duration="8 ms"
          status="failed"
          statusLabel="Не удалось"
          argumentsText={'{\n  "path": "apps/daemon/src/sessions/legacy/session-phase.ts"\n}'}
        />
      </Message>
      <Message role="agent" header="10:12">
        <Markdown text="Второй реализации нет. Очередь намеренно имеет приоритет над фазой рантайма." />
      </Message>
      <Message role="service">Модель сменилась на anthropic/claude-opus-4-5</Message>
      <Message role="agent" header="10:13">
        <StreamingText text="Проверяю по коду очереди" streaming />
      </Message>
    </MessageFeed>
  </div>
);

const nextTurnGroups = [
  {
    id: "anthropic",
    label: "Anthropic",
    options: [
      {
        value: "anthropic/claude-opus-4-5-with-a-deliberately-long-model-identifier",
        label: "anthropic/claude-opus-4-5-with-a-deliberately-long-model-identifier",
      },
      { value: "anthropic/claude-sonnet-4-5", label: "anthropic/claude-sonnet-4-5" },
    ],
  },
  { id: "loading", label: "Loading catalogue", options: [], loading: true },
  { id: "failed", label: "Failed catalogue", options: [], failureReason: "Catalogue unavailable" },
  { id: "empty", label: "Empty catalogue", options: [] },
];

const nextTurnTranslations: Record<string, string> = {
  "thinking.off": "Off",
  "thinking.minimal": "Minimal",
  "thinking.low": "Low",
  "thinking.medium": "Medium",
  "thinking.high": "High",
  "thinking.xhigh": "Very high",
  "thinking.max": "Maximum",
};

export const NextTurn = () => {
  const [model, setModel] = useState(nextTurnGroups[0]!.options[0]!.value);
  const [thinkingLevel, setThinkingLevel] = useState<ThinkingLevel>("medium");
  const [reasoningSupported, setReasoningSupported] = useState(true);

  return (
    <div style={{ ...column, maxWidth: "24rem", minHeight: "34rem", justifyContent: "flex-end" }}>
      <label>
        <input
          type="checkbox"
          checked={reasoningSupported}
          onChange={(event) => setReasoningSupported(event.target.checked)}
        />{" "}
        Reasoning supported
      </label>
      <NextTurnPicker
        model={model}
        modelGroups={nextTurnGroups}
        onModelChange={setModel}
        onExpandModelGroup={() => {}}
        thinkingLevel={thinkingLevel}
        reasoningSupported={reasoningSupported}
        onThinkingLevelChange={setThinkingLevel}
        modelLabel="Model"
        reasoningLabel="Reasoning"
        triggerLabel="Next-turn settings"
        placeholder="Choose model"
        emptyText="No models"
        translator={{
          t: (key) => nextTurnTranslations[key] ?? key,
          optional: (key) => nextTurnTranslations[key],
        }}
      />
    </div>
  );
};
