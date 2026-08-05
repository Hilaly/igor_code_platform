# Message Date Metadata Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Показывать у сохранённой реплики локальные дату и время в формате `DD.MM.YYYY, HH:MM`.

**Architecture:** Существующий `SessionEntry.time` остаётся единственным источником значения. Внутренний форматтер `SessionMessageList` расширяется с времени до даты и времени; разметка, API и поведение панели действий не меняются.

**Tech Stack:** React 19, TypeScript, `Intl.DateTimeFormat`, Vitest, Testing Library.

## Global Constraints

- Подпись имеет точный вид `DD.MM.YYYY, HH:MM` в локальном часовом поясе браузера.
- Исходное ISO-значение сохраняется в атрибуте `dateTime`.
- Невалидное значение по-прежнему не отображается.

---

### Task 1: Compact message date and time

**Files:**

- Modify: `apps/web/src/sessions/session-message-list.tsx`
- Test: `apps/web/src/sessions/session-message-list.test.tsx`

**Interfaces:**

- Consumes: `SessionEntry.time: string`
- Produces: отображаемая подпись `DD.MM.YYYY, HH:MM` внутри существующего `<time>`

- [ ] **Step 1: Write the failing test**

Изменить существующую проверку метаданных реплики так, чтобы для локального значения
`2026-07-29T07:02:00` ожидалась буквальная строка `29.07.2026, 07:02`, а `datetime` оставался
исходным значением.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @sovereign/web exec vitest run src/sessions/session-message-list.test.tsx`

Expected: FAIL, потому что компонент пока выводит только `07:02`.

- [ ] **Step 3: Write minimal implementation**

Заменить `formatEntryTime` на форматирование через `Intl.DateTimeFormat("ru-RU", ...)` с
двузначными днём, месяцем, часом и минутой, четырёхзначным годом и `hourCycle: "h23"`.

- [ ] **Step 4: Run verification**

Run:

```bash
pnpm --filter @sovereign/web exec vitest run src/sessions/session-message-list.test.tsx
make check
make build
```

Expected: все команды завершаются с кодом `0`.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/sessions/session-message-list.tsx apps/web/src/sessions/session-message-list.test.tsx
git commit -m "feat(web): show message date with time"
```
