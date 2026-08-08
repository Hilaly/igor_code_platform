# Slice 12a Review Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Исправить потерю неизвестных полей при `PUT /api/config`, преобразовать ошибки чтения
настроек в именованные ответы и слить актуальный `main` без UI-регрессий.

**Architecture:** HTTP-маршрут валидирует известный `Config`, но передаёт хранилищу исходный объект
для совместимой записи документа. Хранилище объединяет чтение и атомарную запись в одной границе
ошибок. Интеграция выполняется обычным merge-коммитом с ручным объединением независимых UI-функций.

**Tech Stack:** TypeScript 5.9, Node.js 24 `node:test`, React 19, pnpm workspaces, ESLint 9,
Prettier, Make.

## Global Constraints

- Не расширять строгий тип `Config` неизвестными полями.
- Ответ PUT содержит только известный применяемый `Config`.
- Невалидный документ даёт `refused`/409; системная ошибка чтения или записи — `failed`/500.
- Историю среза сохраняет обычный merge-коммит из `main`, без rebase.
- В конфликте Daemon одновременно сохраняются `ConfigForm` и `DurationTimer`.

---

### Task 1: Сохранить неизвестные поля PUT

**Files:**

- Modify: `apps/daemon/src/settings/config-api.test.ts`
- Modify: `apps/daemon/src/settings/config-api.ts`
- Modify: `apps/daemon/src/settings/settings.ts`

**Interfaces:**

- Consumes: `parseConfigUpdate(raw: unknown): SettingsParseResult<Config>`.
- Produces: `SettingsStore.writeConfig(document: Record<string, unknown>): WriteOutcome`.

- [ ] **Step 1: Write the failing test**

Добавить HTTP-тест, который отправляет `{ ...defaultConfig, futureKey: "keep me" }`, ожидает 200 с
`defaultConfig` и ожидает неизвестный ключ в сохранённом файле.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @sovereign/daemon exec node --test src/settings/config-api.test.ts`

Expected: FAIL — `futureKey` отсутствует в сохранённом документе.

- [ ] **Step 3: Write minimal implementation**

После успешной валидации передать в `writeConfig` исходный объект тела. Изменить сигнатуру
`writeConfig` на `Record<string, unknown>`; объект гарантирован проверкой `parseConfigUpdate`.
Сохранить ответ как `parsed.value`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @sovereign/daemon exec node --test src/settings/config-api.test.ts`

Expected: PASS.

### Task 2: Именовать ошибку чтения существующего файла

**Files:**

- Modify: `apps/daemon/src/settings/settings.test.ts`
- Modify: `apps/daemon/src/settings/settings.ts`

**Interfaces:**

- Consumes: `readStoredDocument(path, parse): StoredDocument`.
- Produces: `patchFile(...): WriteOutcome`, включая `failed` с причиной чтения.

- [ ] **Step 1: Write the failing test**

На не-root создать валидный `config.json`, запустить store, убрать права чтения файла и вызвать
`writeConfig`. Проверить, что вызов не бросает исключение, возвращает `failed`, а причина начинается
с `config.json was not written:`. В `finally` восстановить права.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @sovereign/daemon exec node --test src/settings/settings.test.ts`

Expected: FAIL с выброшенным `EACCES` из чтения.

- [ ] **Step 3: Write minimal implementation**

Переместить `readStoredDocument` и проверку `refused` внутрь `try` функции `patchFile`, чтобы один
`catch` преобразовывал системные отказы чтения и записи в `failed`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @sovereign/daemon exec node --test src/settings/settings.test.ts`

Expected: PASS.

- [ ] **Step 5: Verify and commit both review fixes**

Run: `pnpm --filter @sovereign/daemon run typecheck && pnpm --filter @sovereign/daemon run test`

Commit: `fix(settings): preserve compatible config writes`

### Task 3: Merge main and preserve both sides

**Files:**

- Merge: `main`
- Resolve: `apps/web/src/settings/daemon-section.tsx`
- Resolve: `docs/ui-kit.md`
- Update if needed: `docs/README.md`

**Interfaces:**

- Consumes: `ConfigForm`, `DurationTimer`, `UseConfigState`, `Translator`.
- Produces: Daemon section with live uptime and editable config.

- [ ] **Step 1: Merge main without committing automatically**

Run: `git merge --no-ff --no-commit main`

- [ ] **Step 2: Resolve conflicts by behavior**

В `daemon-section.tsx` оставить `DurationTimer` и доступную посекундную подпись из `main`, добавить
`ConfigForm` и его props из среза. В `docs/ui-kit.md` сохранить оба действующих контракта. Не менять
восстановленный композер, пришедший из `main`.

- [ ] **Step 3: Verify focused integration**

Run: `pnpm --filter @sovereign/web exec vitest run src/settings/daemon-section.test.tsx src/settings/config-form.test.tsx src/sessions/message-composer.test.tsx`

Expected: PASS.

- [ ] **Step 4: Create merge commit**

Commit: `merge: update slice 12a from main`

### Task 4: Full verification

**Files:**

- Verify only; modify only if a real integration regression is exposed.

**Interfaces:**

- Consumes: repository-wide checks.
- Produces: clean, buildable slice branch.

- [ ] **Step 1: Run complete checks**

Run: `make check && make build`

Expected: exit 0 with typecheck, lint, format, all tests and builds passing.

- [ ] **Step 2: Inspect repository state**

Run: `git diff --check main...HEAD && git status --short --branch && git log --oneline -6`

Expected: no whitespace errors, clean worktree, merge commit at HEAD.
