# Изоляция рендера композера агентской сессии Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans (recommended) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Исключить повторный render и Markdown parse истории при наборе текста в композере, сохранив submit, смену сессии и подстановку текста из дерева.

**Architecture:** `MessageComposer` владеет draft и принимает типизированный одноразовый запрос замены текста от `ChatView`. `SessionMessageList` получает memo-границу со стабильными слотами и callback-ами; внутри ленты дорогие селекторы и `Markdown` кэшируются только по неизменяемым данным.

**Tech Stack:** React 19, TypeScript, Vitest, Testing Library, Vite, pnpm workspace.

## Global Constraints

- Работать только в `/Users/user/repos/sovereign_platform_node/.worktrees/composer-render-isolation` на ветке `codex/composer-render-isolation`.
- Не менять поведение Enter/Shift+Enter, режимов доставки, модели и уровня reasoning.
- Сохранять защиту `operationToken` и `currentSessionId` для устаревших async-результатов.
- Документация репозитория ведётся на русском, идентификаторы и commit messages — на английском.
- Перед завершением выполнить тесты, typecheck, lint, формат и production build.

### Task 1: Перенести владение draft в MessageComposer

**Files:**

- Modify: `apps/web/src/sessions/message-composer.tsx`
- Modify: `apps/web/src/sessions/chat-view.tsx`
- Test: `apps/web/src/sessions/message-composer.test.tsx`
- Test: `apps/web/src/sessions/chat-view.test.tsx`

**Interfaces:**

- Produces `ComposerDraftReplacement` with `sessionId`, monotonic `sequence`, and `text`.
- `MessageComposer` consumes the replacement request and no longer consumes `draft`/`onDraftChange`.

- [ ] **Step 1: Write failing composer tests**

Add tests proving local typing is submitted, accepted submit clears the field, rejected submit preserves it, and a replacement request for the current session replaces the field.

- [ ] **Step 2: Run the focused tests and verify RED**

Run:

```bash
pnpm --filter @sovereign/web test -- src/sessions/message-composer.test.tsx src/sessions/chat-view.test.tsx
```

Expected: FAIL because the current composer still requires the parent-controlled `draft` props and has no replacement-request interface.

- [ ] **Step 3: Implement local draft state**

Add `useState("")` to `MessageComposer`, wire `Textarea` to the local setter, replace `onDraftChange("")` with the local setter, clear on `sessionId` change, and apply only replacement requests whose `sessionId` matches.

- [ ] **Step 4: Update ChatView handoff**

Replace the parent draft string with a replacement-request state and a monotonic sequence. Pass the request to `MessageComposer`; wire `EntryTreeDrawer.onEditorText` to create a request for `open.id`.

- [ ] **Step 5: Run focused tests and verify GREEN**

Run the same focused command. Expected: PASS, including the existing session isolation and tree-editor behavior.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/sessions/message-composer.tsx apps/web/src/sessions/chat-view.tsx apps/web/src/sessions/message-composer.test.tsx apps/web/src/sessions/chat-view.test.tsx
git commit -m "perf(web): keep composer draft local"
```

### Task 2: Add memo boundaries for the session history

**Files:**

- Modify: `apps/web/src/sessions/chat-view.tsx`
- Modify: `apps/web/src/sessions/session-message-list.tsx`
- Modify: `packages/ui-kit/src/components/markdown.tsx`
- Test: `apps/web/src/sessions/chat-view.test.tsx`
- Test: `apps/web/src/sessions/session-message-list.test.tsx`
- Test: `packages/ui-kit/src/components/rendering.test.tsx`

**Interfaces:**

- `SessionMessageList` remains behaviorally identical but skips renders when its data and slots are referentially unchanged.
- `Markdown` remains behaviorally identical but skips renders when `text` is unchanged.

- [ ] **Step 1: Write failing render-isolation tests**

Use real `ChatView`, `SessionMessageList`, and `Markdown` behavior. Assert that changing the composer input does not rerender the saved conversation, while changing `open.entries` does update visible history. Add a Markdown memo characterization test with a parent rerender and unchanged `text`.

- [ ] **Step 2: Run focused tests and verify RED**

Run:

```bash
pnpm --filter @sovereign/web test -- src/sessions/chat-view.test.tsx src/sessions/session-message-list.test.tsx
pnpm --filter @sovereign/ui-kit test -- src/components/rendering.test.tsx
```

Expected: the render-isolation assertions fail against the current un-memoized components.

- [ ] **Step 3: Stabilize ChatView history props**

Memoize notices and queue badges by their actual inputs. Replace the inline refusal callback with `useCallback`. Wrap `SessionMessageList` with `memo`.

- [ ] **Step 4: Memoize list selectors**

Use `useMemo` for `outcomes`, active/shown entries, and live order with dependencies matching the source snapshots. Preserve duplicate-user suppression and all ordering rules.

- [ ] **Step 5: Memoize Markdown**

Export `Markdown` through `memo` while keeping `MarkdownProps` and the existing sanitization/rendering tree unchanged.

- [ ] **Step 6: Run focused tests and verify GREEN**

Run the focused commands from Step 2. Expected: PASS with no changes to existing accessibility or content assertions.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/sessions/chat-view.tsx apps/web/src/sessions/session-message-list.tsx packages/ui-kit/src/components/markdown.tsx apps/web/src/sessions/chat-view.test.tsx apps/web/src/sessions/session-message-list.test.tsx packages/ui-kit/src/components/rendering.test.tsx
git commit -m "perf(web): isolate session history renders"
```

### Task 3: Full verification and browser profile

**Files:**

- Modify: `docs/README.md`
- Modify: `docs/superpowers/specs/2026-08-09-composer-render-isolation-design.md`

- [ ] **Step 1: Run repository verification**

Run:

```bash
make check
make build
```

Expected: typecheck, lint, format check, all tests, and production build pass.

- [ ] **Step 2: Reproduce the original browser scenario**

Open the existing long session, type a representative Russian sentence one character at a time, and capture React Profiler evidence around the history and composer.

- [ ] **Step 3: Verify the performance contract**

Expected: typing updates the composer without `SessionMessageList` update commits. A real session/live update still renders the changed history. Record measured before/after values in the final report; do not claim a speedup without the trace.

- [ ] **Step 4: Update docs and commit**

Record the final implementation details and measured result in the approved design document, update `docs/README.md` if names or links changed, then commit:

```bash
git add docs/README.md docs/superpowers/specs/2026-08-09-composer-render-isolation-design.md
git commit -m "docs(web): record composer performance verification"
```
