# Slice 9a Review Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Устранить подтверждённые дефекты среза 9a, не расширяя его до отложенного полного
управления сессиями.

**Architecture:** Сохранённая JSONL-сессия остаётся читаемой независимо от доступности агента и
модели; live harness создаётся только для запуска turn. Очередь атомарно резервирует не более одной
работы на session id. Видимость сессий следует состоянию проекта, а удаление проекта до появления
полного session delete безопасно отклоняется при наличии сессий.

**Tech Stack:** TypeScript, Node.js test runner, pnpm workspace, Pi agent runtime.

## Global Constraints

- Работать только в worktree ветки `feat/slice-9a-sessions`.
- Каждый production change начинается с теста, который сначала падает по ожидаемой причине.
- Не реализовывать fork, compaction, отдельные archive/delete routes сессии и filesystem sandbox.
- Не добавлять внешние зависимости.
- Документация остаётся на русском; код, идентификаторы и сообщения коммитов — на английском.
- Каждый логический блок заканчивается атомарным коммитом с требуемым Co-Authored-By trailer.

---

### Task 1: Atomic turn admission and live summaries

**Files:**

- Modify: `apps/daemon/src/turn-queue.ts`
- Modify: `apps/daemon/src/turn-queue.test.ts`
- Modify: `apps/daemon/src/sessions.ts`
- Modify: `apps/daemon/src/sessions.test.ts`

**Interfaces:**

- `TurnQueue.submit` must return a named refusal when the same `sessionId` is already queued or
  running; it must never replace the active place for that session.
- `GET /api/sessions` and `GET /api/sessions/:id` must reflect model/thinking overrides immediately.

- [ ] Add a queue test that submits the same `sessionId` twice and observes one admitted job.
- [ ] Run the focused queue test and confirm RED.
- [ ] Add an HTTP regression test that issues concurrent overridden prompts and observes one accepted
      200 response and one busy refusal; add a summary override regression test.
- [ ] Run the focused daemon tests and confirm RED.
- [ ] Implement atomic duplicate rejection in the queue and route handling; use live summaries as
      the source for open sessions.
- [ ] Run both focused suites and confirm GREEN.
- [ ] Commit as `fix(daemon): admit one turn per session atomically`.

### Task 2: Persisted session readability without runtime dependencies

**Files:**

- Modify: `packages/agent-runtime-pi/src/agent-session.ts`
- Modify: `packages/agent-runtime-pi/src/agent-session.test.ts`
- Modify: `apps/daemon/src/sessions.ts`
- Modify: `apps/daemon/src/sessions.test.ts`

**Interfaces:**

- Entries and summaries are read from JSONL without resolving the current model or agent.
- Prompting a session whose agent or model disappeared returns a named 409 refusal and leaves the
  persisted session readable for retry after the dependency returns.

- [ ] Add runtime tests proving an existing session can be listed/read after its model disappears.
- [ ] Add daemon tests proving entries remain readable and prompt is refused when the agent is gone.
- [ ] Run focused tests and confirm RED.
- [ ] Separate persisted access from live harness construction, resolving agent/model at prompt time.
- [ ] Run focused tests and confirm GREEN.
- [ ] Commit as `fix(sessions): keep persisted sessions readable`.

### Task 3: Project/session lifecycle and startup ordering

**Files:**

- Modify: `apps/daemon/src/projects.ts`
- Modify: `apps/daemon/src/projects.test.ts`
- Modify: `apps/daemon/src/sessions.ts`
- Modify: `apps/daemon/src/sessions.test.ts`
- Modify: `apps/daemon/src/main.ts`
- Create or modify a focused bootstrap test if extraction is required.

**Interfaces:**

- Archived projects hide their sessions from list, entries and prompt; restoring makes them visible.
- Until the full session deletion surface exists, project deletion with `sessionCount > 0` returns
  409 before mutating the project store.
- The daemon does not listen until the first plugin application and session refresh complete.

- [ ] Add route regressions for archive visibility and deletion refusal.
- [ ] Add a focused startup ordering test around an extracted async bootstrap boundary if needed.
- [ ] Run focused tests and confirm RED.
- [ ] Gate session routes on current project state, reject unsafe project removal, and await initial
      async state before listening.
- [ ] Run focused tests and confirm GREEN.
- [ ] Commit as `fix(daemon): align projects with session lifecycle`.

### Task 4: Diagnostics and documentation consistency

**Files:**

- Modify: `packages/agent-runtime-pi/src/agent-session.ts`
- Modify: `packages/agent-runtime-pi/src/agent-session.test.ts`
- Modify: `docs/web-api.md`
- Modify: `docs/backlog.md` only if the filesystem confinement decision is not already recorded.

**Interfaces:**

- `problems()` reports only the latest storage scan, without duplicate/stale transient failures.
- Project `sessionCount` documentation describes the implemented JSONL-backed count.
- Filesystem confinement remains an explicit product decision, not an implicit behavior change.

- [ ] Add a failing regression test for diagnostics replacement across scans.
- [ ] Implement per-scan diagnostics and confirm the focused test passes.
- [ ] Correct `docs/web-api.md`; record the sandbox decision in the backlog if absent.
- [ ] Run formatting checks for changed documentation.
- [ ] Commit as `fix(agent-runtime-pi): refresh session diagnostics`.

### Task 5: Whole-branch verification

**Files:**

- Verify all files changed since `32c9ccb`.

- [ ] Dispatch a broad final code review against this plan and the existing slice 9a specification.
- [ ] Address load-bearing findings with regression tests and a scoped re-review.
- [ ] Run `make check` and confirm zero failures.
- [ ] Run `make build` and confirm exit code 0.
- [ ] Verify `git status --short`, commit history, and documentation consistency.
