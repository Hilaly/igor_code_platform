# Starter Skills Quality Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Сделать четыре встроенных starter-скила корректными, самодостаточными, удобными для
автоактивации и проверяемыми тестами.

**Architecture:** Короткие `SKILL.md` содержат workflow, минимальный пример, проверку и ошибки;
полный формат и API лежат в соседних `references/`. Тесты читают реальные Markdown-файлы,
пропускают их через parser и TypeScript и проверяют обнаруженные контрактные риски.

**Tech Stack:** Markdown, YAML 1.2, Node.js test runner, TypeScript compiler API,
`parseSkillFile`.

## Global Constraints

- Сохранить идентификаторы `creating-agents`, `creating-skills`, `plugin-backend`,
  `plugin-frontend`.
- Не менять parser, runtime-контракты и публичный SDK.
- Язык проектной документации и тел скилов — русский; frontmatter descriptions — английский.
- Все локальные ссылки должны разрешаться относительно директории скила.
- Примеры TypeScript и TSX должны синтаксически компилироваться.

---

### Task 1: Регрессионные проверки starter-скилов

**Files:**

- Create: `apps/daemon/src/plugins/starter-skills.test.ts`

**Interfaces:**

- Consumes: `parseSkillFile(FileResourceInput)` из daemon parser и TypeScript `transpileModule`.
- Produces: статический quality gate для четырёх `SKILL.md`.

- [x] **Step 1: Написать тесты текущих дефектов**

Добавить проверки parser diagnostics, trigger descriptions, локальных ссылок, code fences,
`code-review`, `Command`, порядка публикации события и `invalid-model`.

- [x] **Step 2: Запустить тест и подтвердить RED**

Run: `pnpm --filter @sovereign/plugin-starter test`

Expected: FAIL на текущих descriptions, имени `code_review`, форме `ClearLogCommand`, публикации
события, отсутствующей ссылке `docs/ui-kit.md` и пропущенном `invalid-model`.

- [x] **Step 3: Оставить минимальные тестовые helpers**

Helpers читают skill directories, разбирают frontmatter, собирают локальные ссылки и fenced code.
Тест не содержит копию production-текста кроме обязательных контрактных маркеров.

- [x] **Step 4: Зафиксировать RED-коммит**

```bash
git add apps/daemon/src/plugins/starter-skills.test.ts
git commit -m "test(starter): guard built-in skill quality"
```

### Task 2: Создание скилов и агентов

**Files:**

- Modify: `plugins/starter/skills/creating-skills/SKILL.md`
- Create: `plugins/starter/skills/creating-skills/references/file-format.md`
- Modify: `plugins/starter/skills/creating-agents/SKILL.md`
- Create: `plugins/starter/skills/creating-agents/references/file-format.md`

**Interfaces:**

- Consumes: действующие форматы `SKILL.md` и `AGENT.md`.
- Produces: workflow авторинга и полные reference-файлы.

- [x] **Step 1: Переписать descriptions как условия применения**
- [x] **Step 2: Добавить workflow, степень свободы, least privilege и verification**
- [x] **Step 3: Перенести поля, roots, ограничения и диагностику в references**
- [x] **Step 4: Исправить пример на `code-review` и добавить `invalid-model`**
- [x] **Step 5: Запустить starter tests**

Run: `pnpm --filter @sovereign/plugin-starter test`

Expected: связанные проверки PASS; plugin-скилы ещё могут оставлять общий набор красным.

- [x] **Step 6: Закоммитить результат**

```bash
git add plugins/starter/skills/creating-agents plugins/starter/skills/creating-skills
git commit -m "docs(starter): teach effective skill and agent authoring"
```

### Task 3: Backend и frontend плагины

**Files:**

- Modify: `plugins/starter/skills/plugin-backend/SKILL.md`
- Create: `plugins/starter/skills/plugin-backend/references/sdk-reference.md`
- Modify: `plugins/starter/skills/plugin-frontend/SKILL.md`
- Create: `plugins/starter/skills/plugin-frontend/references/browser-reference.md`

**Interfaces:**

- Consumes: действующие SDK contributions и browser `Command`.
- Produces: короткие plugin workflows и точные reference-контракты.

- [x] **Step 1: Сократить main skills до рабочего процесса и минимального примера**
- [x] **Step 2: Перенести полный SDK и core places в references**
- [x] **Step 3: Публиковать событие только из обработчика после activation**
- [x] **Step 4: Экспортировать browser command как `Command` с `run`**
- [x] **Step 5: Заменить псевдокод `items: [...]` валидным TypeScript**
- [x] **Step 6: Запустить starter tests и typecheck**

Run:

```bash
pnpm --filter @sovereign/plugin-starter test
pnpm --filter @sovereign/plugin-starter typecheck
```

Expected: PASS.

- [x] **Step 7: Закоммитить результат**

```bash
git add plugins/starter/skills/plugin-backend plugins/starter/skills/plugin-frontend
git commit -m "docs(starter): make plugin skills executable and progressive"
```

### Task 4: Документация и полная проверка

**Files:**

- Modify: `plugins/README.md`
- Modify: `docs/README.md`
- Create: `docs/superpowers/specs/2026-08-10-starter-skills-quality-design.md`
- Create: `docs/superpowers/plans/2026-08-10-starter-skills-quality.md`

**Interfaces:**

- Consumes: окончательная структура starter-скилов.
- Produces: долговременное описание решения и актуальный индекс документации.

- [x] **Step 1: Обновить описание starter-плагина и индекс docs**
- [x] **Step 2: Запустить format, lint, tests и typecheck**

Run:

```bash
pnpm exec prettier --check plugins/starter docs plugins/README.md
pnpm exec eslint plugins/starter
pnpm --filter @sovereign/plugin-starter test
pnpm --filter @sovereign/plugin-starter typecheck
pnpm exec node --test apps/daemon/src/plugins/file-resource-parser.test.ts
pnpm exec node --test packages/agent-runtime-pi/src/skills.test.ts
git diff --check
```

Expected: все команды завершаются с кодом 0.

- [x] **Step 3: Проверить diff и отсутствие незапланированных изменений**
- [x] **Step 4: Закоммитить документацию**

```bash
git add docs plugins/README.md
git commit -m "docs: record starter skill quality rules"
```
