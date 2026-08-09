# Dynamic Tool Call Visual Replacements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every persisted and live tool call a dynamically replaceable place selected by exact `toolName`, while preserving the existing `component` contribution wire contract and built-in `ToolCall` fallback.

**Architecture:** Core and server SDK expose compatible pure `toolCallPlaceId(toolName)` helpers that encode the UTF-8 tool name into an injective place id. A focused web component wraps the current UI-kit `ToolCall` in the existing `HostPlace`, using session, project, call, and tool identity in the existing `PlaceContext`; the current place resolver, loader, error boundary, conflict handling, and fallback remain unchanged.

**Tech Stack:** TypeScript, React 19, Vitest, Node test runner, Testing Library, pnpm, Prettier, ESLint.

## Global Constraints

- Do not add a new contribution kind, field, matcher, renderer registry, or static `corePlaces` entry.
- Address one dynamic place per exact tool name; masks and groups are out of scope.
- Keep `input`, `output`, `status`, callbacks, and `ToolCallProps` out of the public place context.
- Keep the built-in `ToolCall` visually and semantically unchanged when no replacement applies.
- Allow any enabled plugin to claim any tool name through the existing `component` contribution.
- Preserve project-source ranking by passing the open session project through `PlaceContext.project`.
- Add no external dependency.
- Run Node-powered browser tests with `NODE_OPTIONS=--no-experimental-webstorage` in this desktop environment because its ambient `--localstorage-file` flag creates a broken Node `localStorage` before jsdom starts.

---

## File Structure

- `packages/protocol/src/places.ts` — core-side canonical dynamic tool-call place naming.
- `packages/protocol/src/places.test.ts` — place-id validity, injectivity, and exact examples.
- `packages/sdk/src/places.ts` — dependency-free SDK copy of the public naming helper.
- `packages/sdk/src/index.ts` — public SDK export.
- `packages/sdk/src/index.test.ts` — public SDK compatibility examples.
- `apps/web/src/sessions/tool-call-place.tsx` — one focused adapter from current tool-call props to `HostPlace` plus built-in `ToolCall`.
- `apps/web/src/sessions/tool-call-place.test.tsx` — dynamic id, context, and fallback contract.
- `apps/web/src/sessions/session-message-list.tsx` — route both persisted and live calls through the adapter.
- `apps/web/src/sessions/session-message-list.test.tsx` — preserve both existing built-in render paths.
- `docs/ui-extension-model.md` — publish the dynamic place family and context keys.
- `docs/public-contract.md` — mark the helper and family as public compatibility surface.
- `docs/README.md` — index this implementation plan.

---

### Task 1: Canonical dynamic tool-call place ids

**Files:**

- Modify: `packages/protocol/src/places.test.ts`
- Modify: `packages/protocol/src/places.ts`
- Create: `packages/sdk/src/places.ts`
- Modify: `packages/sdk/src/index.test.ts`
- Modify: `packages/sdk/src/index.ts`

**Interfaces:**

- Consumes: the existing place id grammar `^[a-z0-9][a-z0-9-]*(\.[a-z0-9][a-z0-9-]*)+$` enforced by the daemon contribution registry.
- Produces in both public packages: `toolCallPlaceId(toolName: string): string`.
- Produces exact form: `core.session.tool-call.t-<lowercase UTF-8 hex>`.

- [ ] **Step 1: Write the failing protocol tests**

Add `toolCallPlaceId` to the import from `./places.ts` and add:

```ts
describe("toolCallPlaceId", () => {
  it("encodes an arbitrary tool name as one valid dynamic core place", () => {
    assert.equal(toolCallPlaceId("spawn_agent"), "core.session.tool-call.t-737061776e5f6167656e74");
    assert.match(
      toolCallPlaceId("mcp__github.create/issue"),
      /^[a-z0-9][a-z0-9-]*(\.[a-z0-9][a-z0-9-]*)+$/,
    );
  });

  it("does not collapse distinct exact tool names", () => {
    const names = ["write_file", "write-file", "é", "e\u0301", "工具"];
    const ids = names.map(toolCallPlaceId);

    assert.equal(new Set(ids).size, names.length);
  });
});
```

- [ ] **Step 2: Run the protocol test and verify the red state**

Run:

```bash
pnpm --filter @sovereign/protocol test
```

Expected: FAIL because `toolCallPlaceId` is not exported from `places.ts`.

- [ ] **Step 3: Implement the protocol helper minimally**

Add near the core place declarations in `packages/protocol/src/places.ts`:

```ts
const toolCallPlacePrefix = "core.session.tool-call";

export function toolCallPlaceId(toolName: string): string {
  const encoded = [...new TextEncoder().encode(toolName)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");

  return `${toolCallPlacePrefix}.t-${encoded}`;
}
```

Do not add the prefix or generated ids to `corePlaces`: the family is dynamic.

- [ ] **Step 4: Run the protocol test and verify green**

Run:

```bash
pnpm --filter @sovereign/protocol test
```

Expected: PASS, including the exact `spawn_agent` example and five distinct ids.

- [ ] **Step 5: Write the failing SDK surface test**

Import `toolCallPlaceId` from `./index.ts` in `packages/sdk/src/index.test.ts` and add:

```ts
describe("tool call place names", () => {
  it("matches the public dynamic place contract without importing the internal protocol", () => {
    assert.equal(toolCallPlaceId("spawn_agent"), "core.session.tool-call.t-737061776e5f6167656e74");
    assert.notEqual(toolCallPlaceId("write_file"), toolCallPlaceId("write-file"));
  });
});
```

- [ ] **Step 6: Run the SDK test and verify the red state**

Run:

```bash
pnpm --filter @sovereign/sdk test
```

Expected: FAIL because the root SDK exports no `toolCallPlaceId`.

- [ ] **Step 7: Implement and export the dependency-free SDK helper**

Create `packages/sdk/src/places.ts` with the same pure algorithm:

```ts
const toolCallPlacePrefix = "core.session.tool-call";

export function toolCallPlaceId(toolName: string): string {
  const encoded = [...new TextEncoder().encode(toolName)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");

  return `${toolCallPlacePrefix}.t-${encoded}`;
}
```

Export it from `packages/sdk/src/index.ts`:

```ts
export { toolCallPlaceId } from "./places.ts";
```

Do not add `@sovereign/protocol` as an SDK dependency.

- [ ] **Step 8: Run focused Task 1 checks**

Run:

```bash
pnpm --filter @sovereign/protocol test
pnpm --filter @sovereign/sdk test
pnpm --filter @sovereign/protocol typecheck
pnpm --filter @sovereign/sdk typecheck
```

Expected: all commands PASS.

- [ ] **Step 9: Commit Task 1**

```bash
git add packages/protocol/src/places.ts packages/protocol/src/places.test.ts packages/sdk/src/places.ts packages/sdk/src/index.ts packages/sdk/src/index.test.ts
git commit -m "feat(protocol): name dynamic tool call places"
```

---

### Task 2: Route persisted and live tool calls through dynamic places

**Files:**

- Create: `apps/web/src/sessions/tool-call-place.tsx`
- Create: `apps/web/src/sessions/tool-call-place.test.tsx`
- Modify: `apps/web/src/sessions/session-message-list.tsx`
- Test: `apps/web/src/sessions/session-message-list.test.tsx`

**Interfaces:**

- Consumes: protocol `toolCallPlaceId(toolName: string): string` from Task 1.
- Consumes: existing `HostPlace`, `PlaceContext`, UI-kit `ToolCall`, and `ToolCallProps`.
- Produces: `ToolCallPlace`, a focused component accepting current `ToolCallProps` plus `sessionId`, optional `projectId`, and `toolCallId`.

- [ ] **Step 1: Write the failing placement test**

Create `apps/web/src/sessions/tool-call-place.test.tsx`:

```tsx
// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { ReactNode } from "react";

const captured = vi.hoisted(() => ({
  props: undefined as { id: string; context: unknown; builtIn: ReactNode } | undefined,
}));

vi.mock("../places/place-host.tsx", () => ({
  HostPlace: (props: { id: string; context: unknown; builtIn: ReactNode }) => {
    captured.props = props;
    return props.builtIn;
  },
}));

import { ToolCallPlace } from "./tool-call-place.tsx";

afterEach(() => {
  captured.props = undefined;
  cleanup();
});

it("addresses the exact tool place and keeps the existing ToolCall as fallback", () => {
  render(
    <ToolCallPlace
      sessionId="session-1"
      projectId="project-1"
      toolCallId="call-1"
      icon="◇"
      toolName="spawn_agent"
      status="running"
      statusLabel="Выполняется"
      argumentsText="{}"
    />,
  );

  expect(captured.props).toMatchObject({
    id: "core.session.tool-call.t-737061776e5f6167656e74",
    context: {
      project: "project-1",
      subject: {
        sessionId: "session-1",
        toolCallId: "call-1",
        toolName: "spawn_agent",
      },
    },
  });
  expect(screen.getByText("spawn_agent")).toBeTruthy();
  expect(screen.getByText("Выполняется")).toBeTruthy();
});

it("omits project context when the session summary is not loaded yet", () => {
  render(
    <ToolCallPlace
      sessionId="session-1"
      toolCallId="call-2"
      toolName="read"
      status="done"
      statusLabel="Готово"
      argumentsText="{}"
    />,
  );

  expect(captured.props?.context).toEqual({
    subject: { sessionId: "session-1", toolCallId: "call-2", toolName: "read" },
  });
});
```

- [ ] **Step 2: Run the placement test and verify the red state**

Run:

```bash
NODE_OPTIONS=--no-experimental-webstorage pnpm --filter @sovereign/web exec vitest run src/sessions/tool-call-place.test.tsx
```

Expected: FAIL because `tool-call-place.tsx` does not exist.

- [ ] **Step 3: Implement the focused placement adapter**

Create `apps/web/src/sessions/tool-call-place.tsx`:

```tsx
import { toolCallPlaceId } from "@sovereign/protocol";
import { ToolCall, type ToolCallProps } from "@sovereign/ui-kit";
import type { ReactNode } from "react";

import { HostPlace } from "../places/place-host.tsx";

export type ToolCallPlaceProps = ToolCallProps & {
  sessionId: string;
  projectId?: string;
  toolCallId: string;
};

export function ToolCallPlace(props: ToolCallPlaceProps): ReactNode {
  const { sessionId, projectId, toolCallId, ...toolCall } = props;

  return (
    <HostPlace
      id={toolCallPlaceId(toolCall.toolName)}
      context={{
        ...(projectId === undefined ? {} : { project: projectId }),
        subject: { sessionId, toolCallId, toolName: toolCall.toolName },
      }}
      builtIn={<ToolCall {...toolCall} />}
    />
  );
}
```

- [ ] **Step 4: Run the placement test and verify green**

Run:

```bash
NODE_OPTIONS=--no-experimental-webstorage pnpm --filter @sovereign/web exec vitest run src/sessions/tool-call-place.test.tsx
```

Expected: 2 tests PASS.

- [ ] **Step 5: Replace both direct `ToolCall` branches**

In `apps/web/src/sessions/session-message-list.tsx`:

1. Remove `ToolCall` from the `@sovereign/ui-kit` import.
2. Import `ToolCallPlace` from `./tool-call-place.tsx`.
3. Add `sessionId: string` and optional `projectId?: string` to `EntryMessage`, `ContentBlock`, and `LiveMessage` inputs.
4. Pass `open.id` and `open.summary?.projectId` from `SessionMessageList` into both persisted and live render paths.
5. Replace each `<ToolCall>` with `<ToolCallPlace sessionId={sessionId} toolCallId={...} ...>` while leaving all existing built-in props unchanged.

The persisted branch must keep this effective prop set:

```tsx
<ToolCallPlace
  sessionId={sessionId}
  {...(projectId === undefined ? {} : { projectId })}
  toolCallId={block.toolCallId}
  icon="◇"
  toolName={block.toolName}
  summary={toolSummary(block.toolName, block.input)}
  status={status}
  statusLabel={t(`chat.tool.${status}`)}
  argumentsText={JSON.stringify(block.input, undefined, 2) ?? ""}
  {...(outcome === undefined ? {} : { output: outcome.text, outputLabel: t("chat.tool.output") })}
/>
```

The live branch must keep this effective prop set:

```tsx
<ToolCallPlace
  sessionId={sessionId}
  {...(projectId === undefined ? {} : { projectId })}
  toolCallId={item.toolCallId}
  icon="◇"
  toolName={item.toolName}
  summary={toolSummary(item.toolName, item.input)}
  status={status}
  statusLabel={t(`chat.tool.${status}`)}
  argumentsText={JSON.stringify(item.input, undefined, 2) ?? ""}
/>
```

- [ ] **Step 6: Run the existing persisted/live regression test**

Run:

```bash
NODE_OPTIONS=--no-experimental-webstorage pnpm --filter @sovereign/web exec vitest run src/sessions/session-message-list.test.tsx src/sessions/tool-call-place.test.tsx
```

Expected: all tests PASS; the existing test `shows a path and command in persisted and live tool summaries` proves both fallback branches still render.

- [ ] **Step 7: Run focused Task 2 checks**

Run:

```bash
pnpm --filter @sovereign/web typecheck
NODE_OPTIONS=--no-experimental-webstorage pnpm --filter @sovereign/web test
```

Expected: typecheck PASS and 65 web test files PASS.

- [ ] **Step 8: Commit Task 2**

```bash
git add apps/web/src/sessions/tool-call-place.tsx apps/web/src/sessions/tool-call-place.test.tsx apps/web/src/sessions/session-message-list.tsx apps/web/src/sessions/session-message-list.test.tsx
git commit -m "feat(web): make tool call visuals replaceable"
```

---

### Task 3: Publish the implemented extension contract

**Files:**

- Modify: `docs/ui-extension-model.md`
- Modify: `docs/public-contract.md`
- Modify: `docs/superpowers/specs/2026-08-09-dynamic-tool-call-visual-replacements-design.md`
- Modify: `docs/README.md`

**Interfaces:**

- Consumes: implemented `toolCallPlaceId` form and exact `PlaceContext.subject` keys from Tasks 1–2.
- Produces: normative Russian documentation for plugin authors and compatibility reviewers.

- [ ] **Step 1: Document the dynamic family in the UI extension model**

After the static core places table in `docs/ui-extension-model.md`, add a subsection that states:

```markdown
### Динамические места вызовов инструментов

Каждый вызов инструмента публикует одиночное заменяемое место
`toolCallPlaceId(toolName)`. Оно принадлежит динамическому семейству
`core.session.tool-call.t-<utf8-hex-tool-name>` и не перечисляется в `corePlaces`: экземпляр
появляется только вместе с вызовом. Плагин занимает его обычным component-вкладом; объявлять
отдельный place-вклад не нужно.

Контекст содержит проект сессии и `subject` из `sessionId`, `toolCallId`, `toolName`. Внутренние
`input`, `output`, `status` и callbacks хоста в публичный контекст не входят. Встроенный провайдер —
общий `ToolCall`; конфликт, отключение, ошибка загрузки или отрисовки возвращают его по обычным
правилам одиночного места.
```

Include the SDK registration example using `toolCallPlaceId("spawn_agent")` and an unchanged
`contribute.component` call.

- [ ] **Step 2: Record compatibility in the public contract**

In `docs/public-contract.md`, add `toolCallPlaceId(toolName)` and the generated
`core.session.tool-call.*` family to the browser/plugin public surface. State that changing the
encoding is breaking because existing component contributions address the generated ids.

- [ ] **Step 3: Align the design document with the SDK package boundary**

Keep the approved clarification that protocol and SDK contain compatible independent helper
implementations because the external SDK intentionally has no protocol dependency. Ensure no text
claims that SDK re-exports protocol internals.

- [ ] **Step 4: Index the implementation plan**

Add to `docs/README.md`:

```markdown
- [План динамической подмены визуала вызовов инструментов](superpowers/plans/2026-08-09-dynamic-tool-call-visual-replacements.md) —
  TDD-срезы для канонического динамического place-id, общего HostPlace-адаптера и публичного
  контракта без нового вида вклада.
```

- [ ] **Step 5: Run documentation and full repository checks**

Run:

```bash
pnpm exec prettier --check docs packages apps
NODE_OPTIONS=--no-experimental-webstorage make check
git diff --check
```

Expected: all commands exit 0; web reports 65 passing files and 783 or more passing tests, daemon
reports 741 or more passing tests.

- [ ] **Step 6: Commit Task 3**

```bash
git add docs/README.md docs/ui-extension-model.md docs/public-contract.md docs/superpowers/specs/2026-08-09-dynamic-tool-call-visual-replacements-design.md
git commit -m "docs(ui): publish dynamic tool call places"
```

---

## Final Verification

- [ ] Confirm `git status --short` is empty.
- [ ] Confirm `git log --oneline -4` shows the plan plus three atomic implementation commits.
- [ ] Run `NODE_OPTIONS=--no-experimental-webstorage make check` once more after the final commit.
- [ ] Compare the implementation against every requirement and rejected alternative in the design spec.
