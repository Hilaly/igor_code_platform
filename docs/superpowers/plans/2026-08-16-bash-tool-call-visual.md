# Визуал вызовов bash-семейства инструментов — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers.subagent-driven-development` (recommended) or `superpowers.executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for durable tracking; mirror current status through `mission-update`.

**Goal:** Дать вызовам `bash`, `job-output` и `job-kill` собственную карточку в ленте сессии: команда с промптом `$`, stdout, stderr-секция, бейджи исхода — как component-вклад плагина `starter`.

**Architecture:** Плагин `starter` получает браузерную часть (`sovereign.browser`), воркер регистрирует три component-вклада в `toolCallPlaceId("bash")`, `toolCallPlaceId("job-output")`, `toolCallPlaceId("job-kill")` с одним export `BashToolCall`. Данные компонент берёт из публичного маршрута `GET /api/sessions/:id/entries` (input виден во время турна — рантайм пишет записи прогрессивно), статусы перечитывает по событиям. Ядро и встроенный `ToolCall` не трогаются.

**Tech Stack:** TypeScript, React 19, `@sovereign/sdk` (воркер), `@sovereign/browser-sdk` (браузерный контекст), `@sovereign/ui-kit` (Badge, Code, CodeBlock, Disclosure, Notice, Text, createTranslator), vitest + jsdom + @testing-library/react (компонентные тесты), `node --test` (unit-тесты).

## Global Constraints

- **Ядро не меняется.** Встроенный `ToolCall` остаётся fallback'ом для всех инструментов вне семейства.
- **Один export на три вклада.** Компонент называется `BashToolCall`, имя тула читает из `context.subject.toolName`.
- **Свёрнуто по умолчанию всегда** — поведение как у всех тулколов, авторазворота нет.
- **Статус задания — из текста результата** (`[status: running|completed|killed]`), а не из фазы сессии.
- **Хардкод строк запрещён.** Строки — каталоги `messages.ts` + `contribute.localeCatalog` (en/ru), хук `useTranslator` — дословная копия миссийного (fetch `/api/preferences` → `createTranslator`).
- **Установка зависимостей** — только `env -u WATCH_REPORT_DEPENDENCIES pnpm install` (CLAUDE.md: переменная из окружения dev-демона ломает воркер-протокол pnpm).
- Идентификаторы вкладов проходят паттерн реестра `^[a-z0-9][a-z0-9-]*(\.[a-z0-9][a-z0-9-]*)*$` (проверяется в worker.test.ts).
- Коммиты — Conventional Commits, по-английски, атомарные; каждый оставляет репозиторий зелёным.

---

### Task 1: Парсер результата `parseBashResult`

**Files:**

- Create: `plugins/starter/src/parse-bash-result.ts`
- Test: `plugins/starter/src/parse-bash-result.test.ts`

**Interfaces:**

- Produces: `parseBashResult(text: string): ParsedBashResult` — чистая функция, контракт маркеров ровно тот, что строит `plugins/starter/src/tools.ts` (docs/bash-tool.md):

```ts
export type ParsedBashResult = {
  stdout: string;
  stderr: string;
  noOutput: boolean;
  exitCode?: number;
  timedOut?: boolean;
  killedBy?: string;
  clampedSeconds?: number;
  jobStatus?: "running" | "completed" | "killed";
  truncatedPath?: string;
  stderrTruncatedPath?: string;
};
```

Формат результата (из `tools.ts`): тело (stdout, затем строка `[stderr]` и stderr) → финальные маркеры исхода; пометки усечения живут **внутри** своих секций.

- [ ] **Step 1: Write the failing test**

Create `plugins/starter/src/parse-bash-result.test.ts`:

```ts
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parseBashResult } from "./parse-bash-result.ts";

describe("parseBashResult", () => {
  it("keeps a plain output as stdout", () => {
    assert.deepEqual(parseBashResult("hello\nworld"), {
      stdout: "hello\nworld",
      stderr: "",
      noOutput: false,
    });
  });

  it("splits the stderr section off the body", () => {
    assert.deepEqual(parseBashResult("out\n[stderr]\nerr line"), {
      stdout: "out",
      stderr: "err line",
      noOutput: false,
    });
  });

  it("parses a non-zero exit code marker", () => {
    const parsed = parseBashResult("out\n[exit code: 2]");
    assert.equal(parsed.exitCode, 2);
    assert.equal(parsed.stdout, "out");
  });

  it("parses the timed-out marker including the platform cap wording", () => {
    assert.equal(parseBashResult("out\n[timed out after 30 seconds]").timedOut, true);
    assert.equal(parseBashResult("out\n[timed out after the platform cap seconds]").timedOut, true);
  });

  it("parses the killed-by-signal marker", () => {
    const parsed = parseBashResult("out\n[killed by signal: SIGKILL]");
    assert.equal(parsed.killedBy, "SIGKILL");
  });

  it("parses the clamped-timeout marker together with the timed-out marker", () => {
    const parsed = parseBashResult(
      "[timeout clamped to 118 seconds by the platform]\n[timed out after 118 seconds]",
    );
    assert.equal(parsed.clampedSeconds, 118);
    assert.equal(parsed.timedOut, true);
  });

  it("strips the truncated-output marker and keeps its path", () => {
    const parsed = parseBashResult("out\n[output truncated; full output: /tmp/bash-1.log]");
    assert.equal(parsed.stdout, "out");
    assert.equal(parsed.truncatedPath, "/tmp/bash-1.log");
  });

  it("treats an empty body as no output", () => {
    const parsed = parseBashResult("(no output)");
    assert.equal(parsed.noOutput, true);
    assert.equal(parsed.stdout, "");
  });

  it("treats a job delta without new output as no output with its status", () => {
    const parsed = parseBashResult("(no new output)\n[status: running]");
    assert.equal(parsed.noOutput, true);
    assert.equal(parsed.jobStatus, "running");
  });

  it("parses the completed job status and the dropped-memory notice", () => {
    const parsed = parseBashResult(
      "line\n[some output was dropped from memory; full output: /tmp/j.log]\n[status: completed]",
    );
    assert.equal(parsed.stdout, "line");
    assert.equal(parsed.truncatedPath, "/tmp/j.log");
    assert.equal(parsed.jobStatus, "completed");
  });

  it("keeps unknown text whole", () => {
    assert.deepEqual(parseBashResult("[not a marker] hello"), {
      stdout: "[not a marker] hello",
      stderr: "",
      noOutput: false,
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @sovereign/plugin-starter test`
Expected: FAIL — `parse-bash-result.ts` не найден / `parseBashResult` не экспортирован.

- [ ] **Step 3: Write the minimal implementation**

Create `plugins/starter/src/parse-bash-result.ts`:

```ts
/**
 * Разбор результата инструментов bash/job-output/job-kill (docs/bash-tool.md). Чистая функция:
 * контракт маркеров — ровно тот, что строит tools.ts.
 *
 * Формат результата: тело (stdout, затем строка `[stderr]` и stderr) → финальные маркеры исхода;
 * пометки усечения живут внутри своих секций.
 */

export type ParsedBashResult = {
  stdout: string;
  stderr: string;
  /** Тело было `(no output)` или `(no new output)`: показывать приглушённой строкой. */
  noOutput: boolean;
  /** `[exit code: N]` — приходит только для ненулевого кода. */
  exitCode?: number;
  /** `[timed out after … seconds]` (включая «the platform cap»). */
  timedOut?: boolean;
  /** `[killed by signal: SIG]`. */
  killedBy?: string;
  /** `[timeout clamped to N seconds by the platform]`. */
  clampedSeconds?: number;
  /** `[status: running|completed|killed]` — статус фонового задания у job-output. */
  jobStatus?: "running" | "completed" | "killed";
  /** stdout-секция усечена или её кусок выпал из памяти: путь к полному выводу. */
  truncatedPath?: string;
  /** stderr-секция усечена или её кусок выпал из памяти: путь(ы) к полному выводу. */
  stderrTruncatedPath?: string;
};

const outcomeMarkerPatterns = [
  /^\[exit code: (\d+)\]$/,
  /^\[timed out after .* seconds\]$/,
  /^\[killed by signal: (.+)\]$/,
  /^\[timeout clamped to (\d+) seconds by the platform\]$/,
  /^\[status: (running|completed|killed)\]$/,
];

/** Пометка усечения внутри секции: `[output truncated; full output: …]` и job-вариант. */
const truncatedMarkerPattern = /^\[(?:output truncated|some output was dropped from memory); full output: (.+)\]$/;

/** Секция без пометок усечения: сами пометки — структура, а не содержимое. */
function section(text: string): { text: string; truncatedPath?: string } {
  let truncatedPath: string | undefined;
  const kept: string[] = [];

  for (const line of text.split("\n")) {
    const match = truncatedMarkerPattern.exec(line);
    if (match === null) {
      kept.push(line);
    } else {
      truncatedPath = truncatedPath === undefined ? match[1] : `${truncatedPath}, ${match[1]}`;
    }
  }

  return {
    text: kept.join("\n"),
    ...(truncatedPath === undefined ? {} : { truncatedPath }),
  };
}

export function parseBashResult(text: string): ParsedBashResult {
  const lines = text.split("\n");
  const markers: string[] = [];

  // Маркеры исхода — последние строки результата; отделяются от тела с конца.
  while (lines.length > 0 && outcomeMarkerPatterns.some((pattern) => pattern.test(lines[lines.length - 1]))) {
    markers.unshift(lines.pop() as string);
  }

  let exitCode: number | undefined;
  let timedOut: boolean | undefined;
  let killedBy: string | undefined;
  let clampedSeconds: number | undefined;
  let jobStatus: "running" | "completed" | "killed" | undefined;

  for (const marker of markers) {
    let match = /^\[exit code: (\d+)\]$/.exec(marker);
    if (match !== null) {
      exitCode = Number(match[1]);
      continue;
    }
    match = /^\[timed out after .* seconds\]$/.exec(marker);
    if (match !== null) {
      timedOut = true;
      continue;
    }
    match = /^\[killed by signal: (.+)\]$/.exec(marker);
    if (match !== null) {
      killedBy = match[1];
      continue;
    }
    match = /^\[timeout clamped to (\d+) seconds by the platform\]$/.exec(marker);
    if (match !== null) {
      clampedSeconds = Number(match[1]);
      continue;
    }
    match = /^\[status: (running|completed|killed)\]$/.exec(marker);
    if (match !== null) {
      jobStatus = match[1] as "running" | "completed" | "killed";
    }
  }

  const stderrIndex = lines.findIndex((line) => line === "[stderr]");
  const stdoutBody = stderrIndex === -1 ? lines.join("\n") : lines.slice(0, stderrIndex).join("\n");
  const stderrBody = stderrIndex === -1 ? "" : lines.slice(stderrIndex + 1).join("\n");

  const trimmedBody = stdoutBody.trim();
  const noOutput =
    stderrBody === "" && (trimmedBody === "(no output)" || trimmedBody === "(no new output)");

  const out = section(noOutput ? "" : stdoutBody);
  const err = section(stderrBody);

  return {
    stdout: out.text,
    stderr: err.text,
    noOutput,
    ...(exitCode === undefined ? {} : { exitCode }),
    ...(timedOut === undefined ? {} : { timedOut }),
    ...(killedBy === undefined ? {} : { killedBy }),
    ...(clampedSeconds === undefined ? {} : { clampedSeconds }),
    ...(jobStatus === undefined ? {} : { jobStatus }),
    ...(out.truncatedPath === undefined ? {} : { truncatedPath: out.truncatedPath }),
    ...(err.truncatedPath === undefined ? {} : { stderrTruncatedPath: err.truncatedPath }),
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @sovereign/plugin-starter test`
Expected: PASS, все тесты Task 1 зелёные, `fail 0`.

- [ ] **Step 5: Commit**

```bash
git add plugins/starter/src/parse-bash-result.ts plugins/starter/src/parse-bash-result.test.ts
git commit -m "feat(starter): parse the bash tool result markers into a card model"
```

---

### Task 2: Карточка `BashToolCall` с данными и локализацией

**Files:**

- Modify: `plugins/starter/package.json` (browser-поле, devDeps, скрипт test)
- Modify: `plugins/starter/tsconfig.json` (dom, jsx, bundler)
- Create: `plugins/starter/vitest.config.ts`
- Create: `plugins/starter/src/messages.ts`
- Create: `plugins/starter/src/entries.ts`
- Test: `plugins/starter/src/entries.test.ts`
- Create: `plugins/starter/src/bash-tool-call.tsx`
- Create: `plugins/starter/src/bash-tool-call.css`
- Test: `plugins/starter/src/bash-tool-call.test.tsx`

**Interfaces:**

- Consumes: `parseBashResult` из Task 1.
- Produces: `fetchEntries(sessionId: string): Promise<SessionEntriesPage | undefined>` — публичный маршрут записей; `findToolCall(entries: SessionEntry[], toolCallId: string): ToolCallData | undefined`; `ToolCallData = { input: unknown; result?: { text: string; failed: boolean } }`. Экспорт компонента `BashToolCall({ context }: { context: PlaceContext })` использует Task 3.

- [ ] **Step 1: Готовим пакет к браузерной части и тестам**

В `plugins/starter/package.json`:

- в `devDependencies` добавить (версии те же, что у mission/subagents — уже разрешены в lockfile):

```json
"@sovereign/browser-sdk": "workspace:*",
"@sovereign/ui-kit": "workspace:*",
"@testing-library/react": "^16.3.2",
"@types/react": "^19.0.0",
"jsdom": "^30.0.0",
"react": "^19.0.0",
"vite": "^7.0.0",
"vitest": "^4.1.10"
```

- в `sovereign` добавить `"browser": "src/browser.tsx"`.

В `plugins/starter/tsconfig.json` — как у mission (браузерный код и воркер живут в одном пакете):

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "lib": ["es2023", "dom", "dom.iterable"],
    "jsx": "react-jsx",
    "module": "esnext",
    "moduleResolution": "bundler",
    "types": ["vite/client", "node"]
  },
  "include": ["src"]
}
```

Создать `plugins/starter/vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({ test: { environment: "jsdom", include: ["src/**/*.test.tsx"] } });
```

Установить зависимости (обязательно с обходом из CLAUDE.md):

```bash
env -u WATCH_REPORT_DEPENDENCIES pnpm install
```

Проверить: `pnpm --filter @sovereign/plugin-starter typecheck` — PASS. Скрипт `test` пока не меняется: vitest без `.test.tsx`-файлов падает с exit 1, поэтому он переключится в Step 8 вместе с первым компонентным тестом.

- [ ] **Step 2: Write the failing test for `findToolCall`**

Create `plugins/starter/src/entries.test.ts`:

```ts
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { SessionEntry } from "@sovereign/sdk";

import { findToolCall } from "./entries.ts";

function callEntry(toolCallId: string, toolName: string, input: unknown): SessionEntry {
  return {
    id: `m-${toolCallId}`,
    time: "2026-08-16T12:00:00.000Z",
    kind: "message",
    role: "agent",
    content: [{ kind: "tool-call", toolCallId, toolName, input }],
  };
}

function resultEntry(toolCallId: string, text: string, failed: boolean): SessionEntry {
  return {
    id: `r-${toolCallId}`,
    time: "2026-08-16T12:00:01.000Z",
    kind: "tool-result",
    toolCallId,
    toolName: "bash",
    text,
    failed,
  };
}

describe("findToolCall", () => {
  it("finds a call without a result", () => {
    const found = findToolCall([callEntry("c1", "bash", { command: "ls" })], "c1");
    assert.deepEqual(found, { input: { command: "ls" } });
  });

  it("finds the call and its result", () => {
    const entries = [callEntry("c1", "bash", { command: "ls" }), resultEntry("c1", "out", false)];
    const found = findToolCall(entries, "c1");
    assert.deepEqual(found, {
      input: { command: "ls" },
      result: { text: "out", failed: false },
    });
  });

  it("returns undefined for an unknown call id", () => {
    assert.equal(findToolCall([callEntry("c1", "bash", { command: "ls" })], "c2"), undefined);
  });

  it("ignores text blocks and calls with other ids", () => {
    const entries: SessionEntry[] = [
      {
        id: "m0",
        time: "2026-08-16T12:00:00.000Z",
        kind: "message",
        role: "user",
        content: [{ kind: "text", text: "hi" }],
      },
      callEntry("c1", "bash", { command: "ls" }),
    ];
    const found = findToolCall(entries, "c1");
    assert.deepEqual(found, { input: { command: "ls" } });
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm --filter @sovereign/plugin-starter test`
Expected: FAIL — `entries.ts` не найден.

- [ ] **Step 4: Write the minimal implementation of `entries.ts`**

Create `plugins/starter/src/entries.ts`:

```ts
/**
 * Данные вызова bash-семейства из записей сессии (спека
 * 2026-08-16-bash-tool-call-visual-design.md). Записи пишутся рантаймом во время турна, поэтому
 * input доступен, как только модель вызвала инструмент, а результат — когда он завершился.
 */

import type { SessionEntriesPage, SessionEntry } from "@sovereign/sdk";

/** Пара «вызов и его результат» из записей сессии. */
export type ToolCallData = {
  input: unknown;
  result?: { text: string; failed: boolean };
};

/**
 * Записи сессии из публичного маршрута (docs/web-api.md). 404 — сессии нет: карточка остаётся без
 * данных, а не падает.
 */
export async function fetchEntries(sessionId: string): Promise<SessionEntriesPage | undefined> {
  const response = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/entries`);
  if (response.status === 404) {
    return undefined;
  }
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return (await response.json()) as SessionEntriesPage;
}

/** Найти вызов по идентификатору: input — из блока сообщения, результат — отдельной записью. */
export function findToolCall(entries: SessionEntry[], toolCallId: string): ToolCallData | undefined {
  let input: unknown | undefined;
  for (const entry of entries) {
    if (entry.kind !== "message") {
      continue;
    }
    for (const block of entry.content) {
      if (block.kind === "tool-call" && block.toolCallId === toolCallId) {
        input = block.input;
      }
    }
  }

  let result: { text: string; failed: boolean } | undefined;
  for (const entry of entries) {
    if (entry.kind === "tool-result" && entry.toolCallId === toolCallId) {
      result = { text: entry.text, failed: entry.failed };
    }
  }

  if (input === undefined && result === undefined) {
    return undefined;
  }
  return { input, ...(result === undefined ? {} : { result }) };
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm --filter @sovereign/plugin-starter test`
Expected: PASS — тесты Task 1 и `entries.test.ts` зелёные, `fail 0`.

- [ ] **Step 6: Write the failing component test**

Create `plugins/starter/src/bash-tool-call.test.tsx` (образец — `plugins/mission/src/mission-panel.test.tsx`):

```tsx
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { BrowserRuntimeProvider } from "@sovereign/browser-sdk/host";
import type {
  BrowserEvent,
  BrowserEventBridge,
  BrowserEventListener,
  BrowserRecoveryListener,
} from "@sovereign/browser-sdk";
import type { SessionEntriesPage, SessionEntry } from "@sovereign/sdk";

import { BashToolCall } from "./bash-tool-call.tsx";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function event(type: string, payload: unknown = {}): BrowserEvent {
  return { type, index: 2, time: "2026-08-16T12:30:00.000Z", payload } as BrowserEvent;
}

function bridge() {
  const eventListeners = new Set<BrowserEventListener>();
  const recoveryListeners = new Set<BrowserRecoveryListener>();
  const events: BrowserEventBridge = {
    subscribe(listener) {
      eventListeners.add(listener);
      return () => eventListeners.delete(listener);
    },
    subscribeRecovery(listener) {
      recoveryListeners.add(listener);
      return () => recoveryListeners.delete(listener);
    },
  };
  return {
    events,
    publish(next: BrowserEvent) {
      for (const listener of eventListeners) listener(next);
    },
    recover() {
      for (const listener of recoveryListeners) listener();
    },
  };
}

function callEntry(toolCallId: string, toolName: string, input: unknown): SessionEntry {
  return {
    id: `m-${toolCallId}`,
    time: "2026-08-16T12:30:00.000Z",
    kind: "message",
    role: "agent",
    content: [{ kind: "tool-call", toolCallId, toolName, input }],
  };
}

function resultEntry(toolCallId: string, text: string, failed: boolean): SessionEntry {
  return {
    id: `r-${toolCallId}`,
    time: "2026-08-16T12:30:01.000Z",
    kind: "tool-result",
    toolCallId,
    toolName: "bash",
    text,
    failed,
  };
}

function page(entries: SessionEntry[]): SessionEntriesPage {
  return { sessionId: "s1", entries, seen: entries.length };
}

function response(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as Response;
}

/** Мок fetch: локализация, записи сессии, всё остальное — 404. */
function installFetch(entries: SessionEntry[]) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url === "/api/preferences") return response({ locale: "ru" });
    if (url === "/api/sessions/s1/entries") return response(page(entries));
    return { ok: false, status: 404 } as Response;
  });
}

function renderCard(channel: ReturnType<typeof bridge>, toolName = "bash", toolCallId = "c1") {
  const cache = {
    load: () => ({ kind: "loading" as const }),
    peek: () => undefined,
    version: () => 0,
    retain: () => {},
    subscribe: () => () => {},
    dispose: () => {},
  };
  return render(
    <BrowserRuntimeProvider
      contributions={[]}
      plugins={[]}
      onDiagnostic={() => {}}
      events={channel.events}
      cache={cache}
      createCache={() => cache}
    >
      <BashToolCall context={{ subject: { sessionId: "s1", toolCallId, toolName } }} />
    </BrowserRuntimeProvider>,
  );
}

function expand(title: string): Promise<void> {
  return act(async () => {
    (screen.getByText(title).closest("summary") as HTMLElement).click();
  });
}

it("shows the command and a running badge while the call has no result yet", async () => {
  installFetch([callEntry("c1", "bash", { command: "pnpm test" })]);
  renderCard(bridge());
  expect(await screen.findByText("pnpm test")).toBeTruthy();
  expect(screen.getByText("Выполняется")).toBeTruthy();
});

it("shows a compact card while the call is not in the records yet", async () => {
  installFetch([]);
  renderCard(bridge());
  expect(await screen.findByText("bash")).toBeTruthy();
  expect(screen.getByText("Выполняется")).toBeTruthy();
});

it("is collapsed by default and shows output, stderr and the exit badge when expanded", async () => {
  installFetch([
    callEntry("c1", "bash", { command: "pnpm test" }),
    resultEntry("c1", "ok\n[stderr]\nwarn", false),
  ]);
  renderCard(bridge());
  await screen.findByText("pnpm test");
  expect(screen.queryByText("ok")).toBeNull();
  await expand("pnpm test");
  expect(await screen.findByText("ok")).toBeTruthy();
  expect(screen.getByText("warn")).toBeTruthy();
  expect(screen.getByText("exit 0")).toBeTruthy();
  expect(screen.getByText("Готово")).toBeTruthy();
});

it("shows the failed state with the whole result in the stderr section", async () => {
  installFetch([
    callEntry("c1", "job-kill", { jobId: "j9" }),
    resultEntry("c1", "unknown job j9", true),
  ]);
  renderCard(bridge(), "job-kill", "c1");
  await screen.findByText("job-kill j9");
  await expand("job-kill j9");
  expect(await screen.findByText("unknown job j9")).toBeTruthy();
  expect(screen.getByText("Не удалось")).toBeTruthy();
});

it("reflects the job status from the result text for job-output", async () => {
  installFetch([
    callEntry("c1", "job-output", { jobId: "j9" }),
    resultEntry("c1", "(no new output)\n[status: running]", false),
  ]);
  renderCard(bridge(), "job-output", "c1");
  expect(await screen.findByText("job-output j9")).toBeTruthy();
  expect(screen.getByText("Выполняется")).toBeTruthy();
});

it("shows the background badge for a background job", async () => {
  installFetch([callEntry("c1", "bash", { command: "sleep 60", run_in_background: true })]);
  renderCard(bridge());
  await screen.findByText("sleep 60");
  await expand("sleep 60");
  expect(await screen.findByText("фон")).toBeTruthy();
});

it("reloads the records when the session state changes", async () => {
  const channel = bridge();
  const fetchMock = installFetch([callEntry("c1", "bash", { command: "ls" })]);
  renderCard(channel);
  await screen.findByText("ls");
  fetchMock.mockClear();
  await act(async () => channel.publish(event("core.sessions.changed")));
  expect(fetchMock).toHaveBeenCalled();
});
```

- [ ] **Step 7: Run the test to verify it fails**

Run: `pnpm --filter @sovereign/plugin-starter test`
Expected: FAIL — `bash-tool-call.tsx` не найден.

- [ ] **Step 8: Write the messages, the component and the styles**

Сначала переключить скрипт теста в `plugins/starter/package.json`:

```json
"test": "node --test \"src/**/*.test.ts\" && vitest run"
```

Затем создать `plugins/starter/src/messages.ts`:

```ts
/**
 * Строки карточки bash-семейства. Один модуль на обе половины плагина: воркер объявляет каталоги
 * вкладом `contribute.localeCatalog`, браузерная часть строит из них переводчик кита
 * (спека 2026-08-16-bash-tool-call-visual-design.md).
 */

export const messagesNamespace = "starter-bash";

export const englishMessages: Record<string, string> = {
  "tool.status.running": "Running",
  "tool.status.done": "Done",
  "tool.status.failed": "Failed",
  "tool.status.killed": "Killed",
  "tool.stderr": "stderr",
  "tool.noOutput": "(no output)",
  "tool.noNewOutput": "(no new output)",
  "tool.background": "background",
  "tool.timedOut": "Timed out",
  "tool.killedBy": "Killed by {signal}",
  "tool.clamped": "Timeout clamped to {seconds}s",
  "tool.truncated": "Output truncated",
  "tool.stderrTruncated": "Stderr truncated",
  "tool.failure": "Could not read the tool call: {reason}",
};

export const russianMessages: Record<string, string> = {
  "tool.status.running": "Выполняется",
  "tool.status.done": "Готово",
  "tool.status.failed": "Не удалось",
  "tool.status.killed": "Остановлено",
  "tool.stderr": "stderr",
  "tool.noOutput": "(нет вывода)",
  "tool.noNewOutput": "(нет нового вывода)",
  "tool.background": "фон",
  "tool.timedOut": "Таймаут",
  "tool.killedBy": "Остановлен сигналом {signal}",
  "tool.clamped": "Таймаут ограничен {seconds} с",
  "tool.truncated": "Вывод усечён",
  "tool.stderrTruncated": "stderr усечён",
  "tool.failure": "Не удалось прочитать вызов: {reason}",
};
```

Create `plugins/starter/src/bash-tool-call.tsx`:

```tsx
/**
 * Карточка вызова bash/job-output/job-kill в ленте сессии (спека
 * 2026-08-16-bash-tool-call-visual-design.md). Встроенный ToolCall остаётся fallback'ом.
 *
 * Данные — из записей сессии: input виден, как только модель вызвала инструмент, результат — когда
 * инструмент завершился. Статус перечитывается по событиям и ограниченным retry в состоянии
 * «записей ещё нет».
 */

import { useSovereignEvents, type PlaceContext } from "@sovereign/browser-sdk";
import {
  Badge,
  Code,
  CodeBlock,
  Disclosure,
  Notice,
  Text,
  createTranslator,
  type Translator,
} from "@sovereign/ui-kit";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { fetchEntries, findToolCall, type ToolCallData } from "./entries.ts";
import { englishMessages, messagesNamespace, russianMessages } from "./messages.ts";
import { parseBashResult, type ParsedBashResult } from "./parse-bash-result.ts";
import "./bash-tool-call.css";

type CardStatus = "running" | "done" | "failed";
type BadgeTone = "neutral" | "accent" | "success" | "warning" | "danger";

/** Сколько раз перечитывать записи, пока вызова в них нет (доли секунды после вызова модели). */
const NO_DATA_RETRY_ATTEMPTS = 20;
const NO_DATA_RETRY_DELAY_MS = 1_000;

/**
 * Подпись и тон карточки. Статус задания из текста (`[status: …]`) важнее факта ответа тула:
 * job-output отвечает успешно, даже когда задание ещё бежит.
 */
function statusOf(status: CardStatus, jobStatus: ParsedBashResult["jobStatus"]): {
  key: string;
  tone: BadgeTone;
} {
  if (jobStatus === "killed") return { key: "tool.status.killed", tone: "danger" };
  if (jobStatus === "completed") return { key: "tool.status.done", tone: "success" };
  if (jobStatus === "running") return { key: "tool.status.running", tone: "accent" };
  if (status === "failed") return { key: "tool.status.failed", tone: "danger" };
  if (status === "done") return { key: "tool.status.done", tone: "success" };
  return { key: "tool.status.running", tone: "accent" };
}

/** Заголовок карточки: команда для bash, имя тула с jobId для job-инструментов. */
function toolTitle(toolName: string, input: unknown): string {
  if (toolName === "bash") {
    const command = (input as { command?: unknown } | null | undefined)?.command;
    return typeof command === "string" && command !== "" ? command : toolName;
  }
  const jobId = (input as { jobId?: unknown } | null | undefined)?.jobId;
  return typeof jobId === "string" && jobId !== "" ? `${toolName} ${jobId}` : toolName;
}

function isBackground(input: unknown): boolean {
  return (input as { run_in_background?: unknown } | null | undefined)?.run_in_background === true;
}

/** Хук переводчика — дословная копия миссийного: общего модуля в SDK нет (docs/backlog.md). */
function useTranslator(): Translator {
  const [locale, setLocale] = useState("en");

  useEffect(() => {
    const controller = new AbortController();

    void (async () => {
      try {
        const answer = await fetch("/api/preferences", { signal: controller.signal });

        if (answer.ok) {
          const body = (await answer.json()) as { locale?: string };

          if (typeof body.locale === "string") {
            setLocale(body.locale);
          }
        }
      } catch {
        // Локаль не прочиталась — карточка говорит по-английски. Ронять её из-за этого нечего.
      }
    })();

    return () => controller.abort();
  }, []);

  return useMemo(
    () =>
      createTranslator({
        locale,
        namespace: messagesNamespace,
        catalogs: [
          { namespace: messagesNamespace, locale: "en", messages: englishMessages },
          { namespace: messagesNamespace, locale: "ru", messages: russianMessages },
        ],
        onDiagnostic: (diagnostic) => console.warn(`[starter] ${diagnostic}`),
      }),
    [locale],
  );
}

export function BashToolCall({ context }: { context: PlaceContext }): ReactNode {
  const sessionId = context.subject?.sessionId;
  const toolCallId = context.subject?.toolCallId;
  const toolName = context.subject?.toolName ?? "bash";
  const translator = useTranslator();
  const events = useSovereignEvents();
  const [data, setData] = useState<ToolCallData | undefined>(undefined);
  const [refusal, setRefusal] = useState<string | undefined>(undefined);
  const retries = useRef(0);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const disposed = useRef(false);

  useEffect(() => {
    if (sessionId === undefined || toolCallId === undefined) {
      return;
    }

    disposed.current = false;
    retries.current = 0;

    const load = (): void => {
      void fetchEntries(sessionId)
        .then((page) => {
          if (disposed.current) {
            return;
          }
          const found = page === undefined ? undefined : findToolCall(page.entries, toolCallId);
          if (found === undefined) {
            if (retries.current < NO_DATA_RETRY_ATTEMPTS) {
              retries.current += 1;
              retryTimer.current = setTimeout(load, NO_DATA_RETRY_DELAY_MS);
            }
            return;
          }
          setData(found);
        })
        .catch((cause: unknown) => {
          if (!disposed.current) {
            setRefusal(cause instanceof Error ? cause.message : String(cause));
          }
        });
    };

    load();

    const unsubscribe = events.subscribe((event) => {
      // События без нагрузки (docs/event-bus.md): «состояние сессий изменилось» — повод
      // перечитать записи; догон потока — то же самое, на другой стороне моста.
      if (event.type === "core.sessions.changed" || event.type === "core.stream.gap") {
        retries.current = 0;
        load();
      }
    });
    const unsubscribeRecovery = events.subscribeRecovery?.(() => {
      retries.current = 0;
      load();
    });

    return () => {
      disposed.current = true;
      if (retryTimer.current !== undefined) {
        clearTimeout(retryTimer.current);
        retryTimer.current = undefined;
      }
      unsubscribe();
      unsubscribeRecovery?.();
    };
  }, [events, sessionId, toolCallId]);

  const t = translator.t;
  const status: CardStatus =
    data?.result === undefined ? "running" : data.result.failed ? "failed" : "done";
  const parsed = data?.result === undefined ? undefined : parseBashResult(data.result.text);
  const { key: statusKey, tone } = statusOf(status, parsed?.jobStatus);
  const title = data === undefined ? toolName : toolTitle(toolName, data.input);

  const failed = status === "failed";
  const rawOutput = data?.result?.text ?? "";
  // Упавший результат без маркеров — это текст ошибки целиком: он идёт в stderr-секцию.
  const stdout = failed && parsed?.stderr === "" ? "" : parsed?.stdout ?? "";
  const stderr = failed && parsed?.stderr === "" ? rawOutput : parsed?.stderr ?? "";

  const badges: ReactNode[] = [];
  if (parsed?.exitCode !== undefined) {
    badges.push(
      <Badge key="exit" tone="danger">
        {`exit ${parsed.exitCode}`}
      </Badge>,
    );
  } else if (
    parsed !== undefined &&
    !failed &&
    parsed.timedOut !== true &&
    parsed.killedBy === undefined &&
    parsed.jobStatus !== "running" &&
    parsed.jobStatus !== "killed"
  ) {
    badges.push(
      <Badge key="exit" tone="success">
        exit 0
      </Badge>,
    );
  }
  if (parsed?.timedOut === true) {
    badges.push(
      <Badge key="timedOut" tone="danger">
        {t("tool.timedOut")}
      </Badge>,
    );
  }
  if (parsed?.killedBy !== undefined) {
    badges.push(
      <Badge key="killed" tone="danger">
        {t("tool.killedBy", { signal: parsed.killedBy })}
      </Badge>,
    );
  }
  if (parsed?.clampedSeconds !== undefined) {
    badges.push(
      <Badge key="clamped" tone="warning">
        {t("tool.clamped", { seconds: parsed.clampedSeconds })}
      </Badge>,
    );
  }
  if (data !== undefined && isBackground(data.input)) {
    badges.push(
      <Badge key="background" tone="neutral">
        {t("tool.background")}
      </Badge>,
    );
  }

  return (
    <div className="starter-bash-tool-call" data-status={status}>
      <Disclosure
        summary={
          <span className="sbtc-summary">
            <span className="sbtc-identity">
              {toolName === "bash" ? (
                <span className="sbtc-prompt" aria-hidden="true">
                  $
                </span>
              ) : undefined}
              <span className="sbtc-title">
                <Code>{title}</Code>
              </span>
            </span>
            <span className="sbtc-outcome">
              <Badge tone={tone}>{t(statusKey)}</Badge>
            </span>
          </span>
        }
      >
        {stdout === "" ? undefined : <CodeBlock>{stdout}</CodeBlock>}
        {stderr === "" ? undefined : (
          <div className="sbtc-stderr">
            <div className="sbtc-stderr-label">{t("tool.stderr")}</div>
            <CodeBlock>{stderr}</CodeBlock>
          </div>
        )}
        {parsed?.noOutput === true ? (
          <Text tone="muted">{t(toolName === "job-output" ? "tool.noNewOutput" : "tool.noOutput")}</Text>
        ) : undefined}
        {badges.length === 0 ? undefined : <div className="sbtc-footer">{badges}</div>}
        {parsed?.truncatedPath === undefined ? undefined : (
          <Notice tone="warning" title={t("tool.truncated")}>
            {parsed.truncatedPath}
          </Notice>
        )}
        {parsed?.stderrTruncatedPath === undefined ? undefined : (
          <Notice tone="warning" title={t("tool.stderrTruncated")}>
            {parsed.stderrTruncatedPath}
          </Notice>
        )}
        {refusal === undefined ? undefined : (
          <Notice tone="danger" title={t("tool.failure", { reason: refusal })} />
        )}
      </Disclosure>
    </div>
  );
}
```

Create `plugins/starter/src/bash-tool-call.css` (композиция повторяет встроенную `tool-call.module.css`, чтобы блоки семейства не отличались от остальных):

```css
/**
 * Карточка вызова bash/job-output/job-kill (спека 2026-08-16-bash-tool-call-visual-design.md).
 */

.starter-bash-tool-call {
  min-width: 0;
  border: var(--sovereign-stroke-thin) solid var(--sovereign-border-subtle);
  border-inline-start-width: var(--sovereign-stroke-emphasis);
  border-radius: var(--sovereign-radius-sm);
  background: var(--sovereign-fill-surface);
  font-family: var(--sovereign-font-family-mono);
}

.starter-bash-tool-call[data-status="running"] {
  border-inline-start-color: var(--sovereign-accent-border);
}

.starter-bash-tool-call[data-status="done"] {
  border-inline-start-color: var(--sovereign-success-border);
}

.starter-bash-tool-call[data-status="failed"] {
  border-color: var(--sovereign-danger-border);
}

.sbtc-summary {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: var(--sovereign-space-2);
  width: 100%;
  min-width: 0;
}

.sbtc-identity {
  display: flex;
  align-items: baseline;
  gap: var(--sovereign-space-2);
  min-width: 0;
}

.sbtc-prompt {
  color: var(--sovereign-text-muted);
  font-family: var(--sovereign-font-family-mono);
  line-height: var(--sovereign-line-height-none);
}

.sbtc-title {
  min-width: 0;
}

/* Команда не обрезается: переносится внутри, чтобы её можно было прочитать целиком. */
.sbtc-title code {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.sbtc-outcome {
  display: inline-flex;
  align-items: center;
  gap: var(--sovereign-space-2);
  min-width: 0;
  font-family: var(--sovereign-font-family-body);
}

.sbtc-stderr {
  margin-block-start: var(--sovereign-space-2);
  border: 1px solid var(--sovereign-danger-border);
  border-radius: var(--sovereign-radius-sm);
  background: var(--sovereign-danger-surface);
  padding: var(--sovereign-space-2);
}

.sbtc-stderr-label {
  margin-block-end: var(--sovereign-space-2);
  color: var(--sovereign-danger-text);
  font-family: var(--sovereign-font-family-body);
  font-size: var(--sovereign-font-size-xs);
  font-weight: var(--sovereign-font-weight-semibold);
  text-transform: uppercase;
}

.sbtc-footer {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sovereign-space-2);
  margin-block-start: var(--sovereign-space-2);
}
```

- [ ] **Step 9: Run the tests to verify they pass**

Run: `pnpm --filter @sovereign/plugin-starter test`
Expected: PASS — `node --test` (Task 1 + entries) и `vitest run` (7 тестов карточки), `fail 0`.

- [ ] **Step 10: Typecheck the package**

Run: `pnpm --filter @sovereign/plugin-starter typecheck`
Expected: PASS.

- [ ] **Step 11: Commit**

```bash
git add plugins/starter/package.json plugins/starter/tsconfig.json plugins/starter/vitest.config.ts \
  plugins/starter/src/messages.ts plugins/starter/src/entries.ts plugins/starter/src/entries.test.ts \
  plugins/starter/src/bash-tool-call.tsx plugins/starter/src/bash-tool-call.css \
  plugins/starter/src/bash-tool-call.test.tsx
git commit -m "feat(starter): render bash family tool calls with a dedicated card"
```

---

### Task 3: Регистрация вкладов и браузерный экспорт

**Files:**

- Create: `plugins/starter/src/browser.tsx`
- Modify: `plugins/starter/src/worker.ts`
- Modify: `plugins/starter/src/worker.test.ts`

**Interfaces:**

- Consumes: export `BashToolCall` из Task 2, каталоги `messages.ts` из Task 2.
- Produces: активация плагина объявляет два `locale-catalog` и три `component`-вклада с `placeId = toolCallPlaceId("bash" | "job-output" | "job-kill")` и `export = "BashToolCall"`.

- [ ] **Step 1: Write the failing test**

В `plugins/starter/src/worker.test.ts` заменить список ожидаемых вкладов в тесте «contributes the bash tools and the session-close cleanup on activation»:

```ts
    assert.deepEqual(ids, [
      "component",
      "component",
      "component",
      "hook:bash-jobs-session-close:session_closed",
      "locale-catalog",
      "locale-catalog",
      "tool:bash",
      "tool:job-kill",
      "tool:job-output",
    ]);

    const isComponent = (
      contribution: PluginContribution,
    ): contribution is Extract<PluginContribution, { kind: "component" }> =>
      contribution.kind === "component";
    const components = host.contributions.filter(isComponent);
    assert.deepEqual(
      components.map((contribution) => ({
        id: contribution.id,
        placeId: contribution.placeId,
        export: contribution.export,
      })),
      [
        { id: "starter-bash-tool-call", placeId: toolCallPlaceId("bash"), export: "BashToolCall" },
        {
          id: "starter-job-output-tool-call",
          placeId: toolCallPlaceId("job-output"),
          export: "BashToolCall",
        },
        {
          id: "starter-job-kill-tool-call",
          placeId: toolCallPlaceId("job-kill"),
          export: "BashToolCall",
        },
      ],
    );

    const catalogs = host.contributions.filter(
      (contribution): contribution is Extract<PluginContribution, { kind: "locale-catalog" }> =>
        contribution.kind === "locale-catalog",
    );
    assert.deepEqual(
      catalogs.map((contribution) => contribution.locale).sort(),
      ["en", "ru"],
    );
```

В шапку импортов теста добавить:

```ts
import { toolCallPlaceId, type PluginContribution } from "@sovereign/sdk";
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @sovereign/plugin-starter test`
Expected: FAIL — активация не объявляет ни компоненты, ни каталоги.

- [ ] **Step 3: Wire the browser export and the contributions**

Create `plugins/starter/src/browser.tsx`:

```tsx
export { BashToolCall } from "./bash-tool-call.tsx";
```

В `plugins/starter/src/worker.ts` — импорты и вклады:

```ts
import { contribute, log, toolCallPlaceId, type PluginModule } from "@sovereign/sdk";

import { killAllJobs, killJobsOfSession } from "./bash.ts";
import { englishMessages, messagesNamespace, russianMessages } from "./messages.ts";
import { contributeBashTools } from "./tools.ts";

export const activate: PluginModule["activate"] = async () => {
  await contributeBashTools();

  // Строки карточки — каталоги, а не зашитый текст (спека 2026-08-16-bash-tool-call-visual-design.md).
  await contribute.localeCatalog({
    id: "bash-messages-en",
    namespace: messagesNamespace,
    locale: "en",
    messages: englishMessages,
  });
  await contribute.localeCatalog({
    id: "bash-messages-ru",
    namespace: messagesNamespace,
    locale: "ru",
    messages: russianMessages,
  });

  // Один export на всё семейство: место разрешается по точному имени тула (спека 2026-08-09).
  for (const [id, toolName] of [
    ["starter-bash-tool-call", "bash"],
    ["starter-job-output-tool-call", "job-output"],
    ["starter-job-kill-tool-call", "job-kill"],
  ] as const) {
    await contribute.component({ id, placeId: toolCallPlaceId(toolName), export: "BashToolCall" });
  }

  // Фоновые задания живут с сессией (docs/bash-tool.md): закрытая сессия уносит свои задания.
  await contribute.hook({
    id: "bash-jobs-session-close",
    event: "session_closed",
    handler: async (payload) => {
      killJobsOfSession(payload.sessionId);
    },
  });

  await log.info("the starter plugin is active");
};
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @sovereign/plugin-starter test`
Expected: PASS — тесты worker.test.ts зелёные вместе со всеми остальными.

- [ ] **Step 5: Typecheck and commit**

Run: `pnpm --filter @sovereign/plugin-starter typecheck`
Expected: PASS.

```bash
git add plugins/starter/src/browser.tsx plugins/starter/src/worker.ts plugins/starter/src/worker.test.ts
git commit -m "feat(starter): register the bash tool call card for the three tool names"
```

---

### Task 4: Полная проверка и живая сверка

**Files:**

- Проверяются, но не меняются: все пакеты репозитория; `docs/README.md` уже ссылается на спеку.

**Interfaces:**

- Consumes: Tasks 1–3.

- [ ] **Step 1: Typecheck всех пакетов**

Run (из корня ворктри): `pnpm --recursive run typecheck`
Expected: PASS во всех 13 пакетах.

- [ ] **Step 2: Линтер**

Run: `pnpm exec eslint .`
Expected: без ошибок.

- [ ] **Step 3: Формат**

Run: `pnpm exec prettier --write plugins/starter/src/bash-tool-call.tsx plugins/starter/src/bash-tool-call.css plugins/starter/src/bash-tool-call.test.tsx plugins/starter/src/entries.ts plugins/starter/src/entries.test.ts plugins/starter/src/messages.ts plugins/starter/src/parse-bash-result.ts plugins/starter/src/parse-bash-result.test.ts plugins/starter/src/browser.tsx plugins/starter/src/worker.ts plugins/starter/src/worker.test.ts plugins/starter/vitest.config.ts`
Затем: `pnpm exec prettier --check .`
Expected: PASS.

- [ ] **Step 4: Полный прогон тестов**

Run: `env -u WATCH_REPORT_DEPENDENCIES pnpm --recursive run test`
Expected: все пакеты зелёные, `fail 0` везде.

Если где-то появится ошибка деструктуризации из воркера — повторить с префиксом `env -u WATCH_REPORT_DEPENDENCIES` (CLAUDE.md).

- [ ] **Step 5: Живая сверка в dev-окружении**

Демон dev сам перезагрузит `starter` по правке исходников (плагин-вотчер) и соберёт браузерный бандл (`sovereign.browser`). В открытой сессии попросить агента выполнить команды и проверить глазами:

1. `bash` без результата (идущий вызов): заголовок `$ команда` + бейдж «Выполняется», свёрнуто.
2. Успешный `bash`: после турна — «Готово», при разворачивании stdout и бейдж `exit 0`; команда с переносом, не обрезается.
3. Упавший `bash` (`exit 2`): карточка в danger-оформлении, при разворачивании stderr-секция и бейдж `exit N`.
4. `bash` с `run_in_background: true` и опросом `job-output`: бейдж «фон», карточки `job-output <id>` со статусами задания «Выполняется»/«Готово».
5. `job-kill`: карточка `job-kill <id>` с «Остановлено» или «Не удалось» для неизвестного задания.
6. Переключить локаль в настройках (ru/en): строки карточки меняются.
7. `(no output)` у команды без вывода: приглушённая строка.

- [ ] **Step 6: Итоговый коммит**

Отдельного коммита нет — все изменения уже в Tasks 1–3. Проверить: `git status` чистый, `git log --oneline` показывает три feat-коммита поверх `78015129`.
