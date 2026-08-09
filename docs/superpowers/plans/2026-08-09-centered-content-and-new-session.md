# Центрированный контент и стартовый экран новой сессии — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Системно центрировать рабочий контент shell и заменить `/sessions/new` на центрированный стартовый экран с созданием сессии кнопкой отправки композера.

**Architecture:** `Shell` получает один нейтральный body-frame без собственной максимальной ширины; route-level view сами сохраняют размер. `NewSessionView` использует отдельную стартовую композицию на читательской ширине и тонкий локальный адаптер существующих контролов композера, не меняя API создания сессии.

**Tech Stack:** React 19, TypeScript, CSS Modules/CSS, Vitest, Testing Library, pnpm.

## Global Constraints

- Работать только в `/Users/user/repos/sovereign_platform_node/.worktrees/centered-content-frame` на ветке `fix/centered-content-frame`.
- Shell центрирует только body: header остаётся на всю ширину, body-frame не имеет `max-width`.
- Открытая сессия сохраняет `contentMode="contained"`, один owner скролла ленты и нижнюю рабочую зону.
- `/sessions/new`: приветствие → проект и агент → композер; ширина `--sovereign-reading-width`; при нехватке высоты вертикальное центрирование не обрезает содержимое.
- Нет кнопки «Создать», резервного места или поведения быстрых действий.
- Единственная отправка новой сессии требует текста, проекта и агента; выполняет `create → navigate → submit` и сохраняет черновик при отказе.
- Model/reasoning defaults агента, ленивые каталоги и отказ модели без reasoning сохраняют прежнее поведение.
- Новый/изменённый пользовательский текст локализуется в English и Russian каталогах.
- Каждый task идёт TDD: сперва новый тест и подтверждённый RED, затем минимальный GREEN; отдельный Conventional Commit.

---

### Task 1: Content frame оболочки

**Files:**

- Modify: `apps/web/src/shell/shell.tsx`
- Modify: `apps/web/src/shell/shell.css`
- Modify: `apps/web/src/shell/shell.test.tsx`
- Modify: `apps/web/src/shell/styles.test.ts`

**Interfaces:**

- Consumes: `ShellProps.contentMode`, `ShellHeaderProvider`, route-level `children`.
- Produces: один `.shell-content-frame` между `.shell-body` и route-level `children`.

- [ ] **Step 1: Write failing DOM tests**

Добавить в `shell.test.tsx` проверку, что route-level child находится внутри единственного элемента с
`data-testid="shell-content-frame"` и что frame наследует `data-content-mode="page"` и
`"contained"` при обоих режимах Shell.

- [ ] **Step 2: Verify RED**

Run: `pnpm --filter @sovereign/web test -- shell/shell.test.tsx`

Expected: FAIL, потому что `shell-content-frame` ещё не существует.

- [ ] **Step 3: Write failing CSS contract test**

В `styles.test.ts` добавить проверки для `.shell-content-frame`: flex/container, `width: 100%`,
`margin-inline: auto`, отсутствие `max-width`; для contained режима — frame растягивается и не
создаёт второй scroll owner.

- [ ] **Step 4: Verify CSS RED**

Run: `pnpm --filter @sovereign/web test -- shell/styles.test.ts`

Expected: FAIL, потому что CSS-правила frame ещё не существуют.

- [ ] **Step 5: Implement the minimal frame**

В `Shell` обернуть `{children}` в `<div className="shell-content-frame" data-testid="shell-content-frame" data-content-mode={contentMode}>`.
В CSS добавить full-width flex frame c `margin-inline: auto`, `min-width: 0`, `min-height: 0`; в
contained режиме сделать frame растягиваемым без `overflow`, сохранив существующие `.shell-body`
scroll rules.

- [ ] **Step 6: Verify GREEN**

Run: `pnpm --filter @sovereign/web test -- shell/shell.test.tsx shell/styles.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/shell/shell.tsx apps/web/src/shell/shell.css apps/web/src/shell/shell.test.tsx apps/web/src/shell/styles.test.ts
git commit -m "feat(shell): center route content systematically"
```

### Task 2: Стартовая композиция новой сессии

**Files:**

- Modify: `apps/web/src/sessions/new-session-view.tsx`
- Modify: `apps/web/src/sessions/new-session-view.test.tsx`
- Modify: `apps/web/src/sessions/sessions.css`
- Modify: `packages/ui-kit/src/i18n/messages/en.ts`
- Modify: `packages/ui-kit/src/i18n/messages/ru.ts`
- Modify: `packages/ui-kit/src/i18n/i18n.test.ts`

**Interfaces:**

- Consumes: `NewSessionViewProps.onCreate`, `onNavigate`, `onSubmit`, `modelPickerGroups`, `selectedModel`, `thinkingLevels`.
- Produces: submit handler requiring `{ projectId, agentId, text }`, preserving `onCreate(draft) → onNavigate(sessionId) → onSubmit(sessionId, { text })`.

- [ ] **Step 1: Write failing behavior tests**

Replace the obsolete tests for the old field/button with tests that assert: greeting precedes project
and agent controls, controls precede textarea; no button named `Создать`; send is disabled until
project, agent, and non-whitespace text are present; clicking send calls create, then navigate, then
submit with the typed text; a refused creation keeps textarea value and renders refusal.

- [ ] **Step 2: Verify RED**

Run: `pnpm --filter @sovereign/web test -- sessions/new-session-view.test.tsx`

Expected: FAIL, because old form exposes the Create button and lacks the send-driven flow.

- [ ] **Step 3: Write failing style contracts**

Extend the existing web style test covering `sessions.css` to require `.new-session` reader width,
horizontal/vertical centering and a narrow/short-height fallback; require a project-agent row that
collapses at narrow container width.

- [ ] **Step 4: Verify CSS RED**

Run: `pnpm --filter @sovereign/web test -- sessions/styles.test.ts`

Expected: FAIL, because the start-screen classes and rules do not yet exist.

- [ ] **Step 5: Implement the minimal start screen**

Replace the old `Form`, `Field`, first-message textarea and Create action with greeting, compact
project/agent controls, and a composer surface with textarea, `NextTurnPicker` and `SplitButton`
using `SendIcon`. Keep the old selection/default effects. Send creates only when text, project and
agent exist, then invokes existing callbacks in create → navigate → submit order. Add deterministic
hour-based greeting helper and all English/Russian messages. Do not add quick actions or a blank
slot for them.

- [ ] **Step 6: Verify GREEN**

Run: `pnpm --filter @sovereign/web test -- sessions/new-session-view.test.tsx sessions/styles.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/sessions/new-session-view.tsx apps/web/src/sessions/new-session-view.test.tsx apps/web/src/sessions/sessions.css packages/ui-kit/src/i18n/messages/en.ts packages/ui-kit/src/i18n/messages/ru.ts packages/ui-kit/src/i18n/i18n.test.ts
git commit -m "feat(sessions): redesign new session start screen"
```

### Task 3: Интеграционная проверка и документация

**Files:**

- Modify: `docs/ui-kit.md`
- Modify: `docs/README.md` only if the existing entry needs its status updated
- Test: `apps/web/src/App.test.tsx` only if current route composition needs a regression assertion

**Interfaces:**

- Consumes: Tasks 1–2 and their public rendered contracts.
- Produces: documented Shell content-frame and new session start-screen geometry.

- [ ] **Step 1: Write failing integration regression if route composition lacks coverage**

Add a focused App/Shell assertion only if no existing test proves `/sessions/new` is rendered in
ordinary page mode while open sessions stay `contained`; otherwise record why existing shell tests
already cover this behavior in the task report.

- [ ] **Step 2: Verify RED when a test was added**

Run: `pnpm --filter @sovereign/web test -- App.test.tsx`

Expected: FAIL before the corresponding minimal integration adjustment, or skip only with the
documented existing-test evidence from Step 1.

- [ ] **Step 3: Document final UI contract**

Update the relevant shell/session section of `docs/ui-kit.md`: Shell centers route content but does
not impose its width; `/sessions/new` is a vertically centered reader-width starter with greeting,
project/agent controls and send-driven creation; quick actions are deliberately absent.

- [ ] **Step 4: Run focused verification**

Run: `pnpm --filter @sovereign/web test -- App.test.tsx shell/shell.test.tsx sessions/new-session-view.test.tsx`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add docs/ui-kit.md docs/README.md apps/web/src/App.test.tsx
git commit -m "docs(ui): describe centered start screen"
```
