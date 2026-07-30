/**
 * Истории каталога: примитивы вью чата. Настоящий потребитель у них есть — `apps/web/src/sessions/`,
 * — но там их видно только с поднятым демоном и настроенным провайдером, а расхождение в отступах
 * между репликой человека, ответом агента и служебной строкой видно только когда они стоят рядом.
 *
 * Строки в историях — литералы, и это единственное место в ките, где так можно: каталог не
 * поставляется пользователю (docs/ui-kit.md).
 */

import { Markdown } from "./markdown.tsx";

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
