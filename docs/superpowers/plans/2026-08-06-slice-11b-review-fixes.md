# Slice 11b Review Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Устранить подтверждённые дефекты поверхности плагинов slice 11b и довести ветку до состояния, пригодного для мерджа.

**Architecture:** Сохраняем wire-контракт вклада `kind + id`; SDK и supervisor адресуют обработчик составным ключом, чтобы route и public-route с одинаковым id не смешивались. HTTP-диспетчер остаётся буферизующим, но связывает принятый маршрут с поколением загрузки и выбирает наиболее специфичный шаблон. Storage принимает только JSON values и явно возвращает ошибку записи.

**Tech Stack:** TypeScript, Node.js HTTP, Vitest, React, pnpm/workspace scripts.

## Global Constraints

- Публичный маршрут не требует cookie/session/form auth.
- Конфликтующие маршруты не публикуются и их статус должен быть виден через `/api/plugins`.
- Изменения сопровождаются регрессионными тестами и русской документацией.
- Не добавлять внешние зависимости.

### Task 1: SDK handler identity

**Files:** `packages/sdk/src/index.ts`, `packages/sdk/src/routes.ts`, SDK tests.

- [ ] Add failing test for same id route/public-route and verify separate calls.
- [ ] Include kind/visibility in handler and supervisor call key.
- [ ] Run targeted tests and commit `fix(sdk): keep route handlers distinct by kind`.

### Task 2: HTTP robustness and routing

**Files:** `apps/daemon/src/http/dispatcher.ts`, `apps/daemon/src/plugins/plugin-routes.ts`, related tests.

- [ ] Add abort body-read regression test.
- [ ] Add literal-vs-parameter and same-parameter-shape tests.
- [ ] Bind in-flight calls to the route registry generation and reject stale calls.
- [ ] Implement minimal fixes, run targeted daemon tests, commit `fix(daemon): harden plugin route dispatch`.

### Task 3: Strict storage JSON values

**Files:** `apps/daemon/src/plugins/plugin-storage.ts`, storage tests.

- [ ] Add failing tests for undefined/function/symbol/NaN/Infinity/nested invalid values.
- [ ] Validate complete JSON value before writing and preserve prior file.
- [ ] Run storage tests and commit `fix(daemon): reject non-json plugin storage values`.

### Task 4: Truthful plugin UI and docs

**Files:** `apps/daemon/src/plugins/plugins-snapshot.ts`, web plugin view/detail tests and components, `packages/ui-kit/src/i18n/messages/{en,ru}.ts`, docs.

- [ ] Expose route conflict status/effective routes in snapshot and filter UI to effective public routes.
- [ ] Show declared path alongside method and full URL in contribution details.
- [ ] Correct public-route localization wording and document conflict/generation/storage behavior.
- [ ] Run targeted web tests and commit `fix(web): show effective plugin routes accurately`.

### Task 5: Full verification

- [ ] Run `make check` in the linked worktree.
- [ ] Run `git diff --check main...HEAD` and inspect status/log.
- [ ] Ensure backlog/docs reflect intentionally deferred limitations.
