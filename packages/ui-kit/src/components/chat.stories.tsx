/**
 * Истории каталога: примитивы вью чата. Настоящий потребитель у них есть — `apps/web/src/sessions/`,
 * — но там их видно только с поднятым демоном и настроенным провайдером, а расхождение в отступах
 * между репликой человека, ответом агента и служебной строкой видно только когда они стоят рядом.
 *
 * Строки в историях — литералы, и это единственное место в ките, где так можно: каталог не
 * поставляется пользователю (docs/ui-kit.md).
 */

import { Markdown } from "./markdown.tsx";
import { Message, MessageFeed } from "./message-feed.tsx";
import { StreamingText } from "./streaming-text.tsx";

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
      <Message role="service">Модель сменилась на anthropic/claude-opus-4-5</Message>
      <Message role="agent" header="10:12">
        <StreamingText text="Проверяю по коду очереди" streaming />
      </Message>
    </MessageFeed>
  </div>
);
