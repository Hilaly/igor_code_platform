# Starter Session Authoring Skills Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Обновить встроенные starter-скилы так, чтобы агент умел создавать prompt templates, а автор плагина — корректно объявлять и реализовывать slash-команды среза 15.

**Architecture:** Добавить отдельный workflow-sкил `creating-prompt-templates` для плоских `commands/*.md`. Команду плагина не выделять в новый skill: worker-декларация остаётся в `plugin-backend`, браузерный `Command` и `core.session.slash` — в `plugin-frontend`. Статические проверки расширяют существующий `starter-skills.test.ts` и не дублируют нормативные документы.

**Tech Stack:** Markdown/YAML frontmatter, Node.js `node:test`, TypeScript `transpileModule`, Prettier, ESLint, pnpm workspace.

## Global Constraints

- Сохранить идентификаторы `creating-agents`, `creating-skills`, `plugin-backend`, `plugin-frontend`.
- Новый skill использовать lowercase hyphen-case: `creating-prompt-templates`.
- Все skill descriptions начинать с `Use when`.
- Язык тел starter-скилов — русский; frontmatter descriptions — английский.
- Локальные ссылки из skill должны вести только на существующие bundled references.
- Не менять parser, runtime, protocol и публичный SDK.
- Не создавать отдельный skill для plugin commands.

---

### Task 1: Add prompt-template authoring skill

**Files:**

- Create: `plugins/starter/skills/creating-prompt-templates/SKILL.md`
- Create: `plugins/starter/skills/creating-prompt-templates/references/file-format.md`
- Modify: `apps/daemon/src/plugins/starter-skills.test.ts`

**Interfaces:**

- Consumes: `docs/file-resources.md` prompt-template rules and existing starter skill quality helpers.
- Produces: model-invocable workflow for creating and verifying `commands/<name>.md`.

- [x] **Step 1: Extend the test inventory and add failing contract assertions**

Add `creating-prompt-templates` to `skillNames`, then assert the new skill mentions both roots,
project-over-user precedence, all supported argument placeholders, reserved core names, and the
distinction between a prompt template and `SKILL.md`.

Run:

```bash
pnpm --filter @sovereign/daemon exec node --test src/plugins/starter-skills.test.ts
```

Expected: FAIL because the new directory and skill do not exist.

- [x] **Step 2: Write the concise workflow and bundled reference**

Create a frontmatter-valid `SKILL.md` with a `Use when` description, workflow, minimal template
example, verification checklist, common mistakes, and a relative link to `references/file-format.md`.
Put exact roots, frontmatter, precedence, reserved names, placeholder semantics, and a Russian example
in the reference file. Do not link from the skill to repository-relative `docs/` paths.

- [x] **Step 3: Run the focused quality test**

Run the same starter-skills test and expect all assertions to pass.

- [x] **Step 4: Commit the skill**

```bash
git add plugins/starter/skills/creating-prompt-templates apps/daemon/src/plugins/starter-skills.test.ts
git commit -m "docs(starter): add prompt template authoring skill"
```

### Task 2: Teach existing plugin skills the slash-command split

**Files:**

- Modify: `plugins/starter/skills/plugin-backend/SKILL.md`
- Modify: `plugins/starter/skills/plugin-frontend/SKILL.md`
- Modify: `plugins/starter/skills/creating-skills/SKILL.md`
- Modify: `apps/daemon/src/plugins/starter-skills.test.ts`

**Interfaces:**

- Consumes: `contribute.command`, browser `Command`, and `core.session.slash` contracts.
- Produces: unambiguous authoring guidance for backend declaration, browser implementation, and the
  boundary between `SKILL.md` and prompt templates.

- [x] **Step 1: Add failing assertions for the new guidance**

Assert backend guidance contains `core.session.slash` and points to `starter.plugin-frontend`;
assert frontend guidance contains `Command`, `run(context)`, the slash place, plugin-qualified command
address, and session/project context; assert `creating-skills` points prompt-template requests to
`creating-prompt-templates`.

Run the focused test and expect failure before editing the skills.

- [x] **Step 2: Update `plugin-backend`**

Clarify that `contribute.command` registers metadata in the worker, requires `sovereign.browser`, and
does not itself implement the handler. Add a slash-command worker snippet using
`placeId: "core.session.slash"` and direct browser implementation work to `starter.plugin-frontend`.

- [x] **Step 3: Update `plugin-frontend`**

Explain palette versus slash placement, the generated `/<pluginId>.<id>` catalogue entry, action-place
cardinality, `Command` descriptor shape, and `run(context)` access to current session/project. Update
the example to use `core.session.slash` and a backend route without claiming that a command is a React
component.

- [x] **Step 4: Update `creating-skills`**

Add a short boundary section: `SKILL.md` is reusable model guidance, while `commands/<name>.md` is a
human-launched prompt. Point `/name`, `$ARGUMENTS`, and `commands/` authoring requests to the new skill.

- [x] **Step 5: Run focused quality, type, and format checks**

```bash
pnpm --filter @sovereign/daemon exec node --test src/plugins/starter-skills.test.ts
pnpm --filter @sovereign/plugin-starter typecheck
pnpm exec prettier --check plugins/starter/skills apps/daemon/src/plugins/starter-skills.test.ts
```

- [x] **Step 6: Commit the plugin-skill updates**

```bash
git add plugins/starter/skills/creating-skills plugins/starter/skills/plugin-backend plugins/starter/skills/plugin-frontend apps/daemon/src/plugins/starter-skills.test.ts
git commit -m "docs(starter): document plugin slash commands"
```

### Task 3: Update starter indexes and validate the full change

**Files:**

- Modify: `plugins/README.md`
- Modify: `docs/README.md`
- Modify: `docs/superpowers/specs/2026-08-13-starter-session-authoring-design.md`
- Modify: `docs/superpowers/plans/2026-08-13-starter-session-authoring.md`

**Interfaces:**

- Consumes: final starter skill inventory and the approved design.
- Produces: durable documentation with the fifth skill and the backend/frontend command split.

- [x] **Step 1: Update indexes and design status**

List `creating-prompt-templates` in `plugins/README.md`, add the design and plan to `docs/README.md`,
and mark the design as implemented while preserving its rationale.

- [x] **Step 2: Run the complete verification gate**

```bash
PATH=/Users/user/.nvm/versions/node/v24.18.0/bin:$PATH make check
PATH=/Users/user/.nvm/versions/node/v24.18.0/bin:$PATH make build
git diff --check
git status --short --branch
```

If the full lint gate scans ignored `.sovereign-dev` files, rerun tracked-source lint with that local
directory excluded and report the environmental issue without deleting user data.

- [x] **Step 3: Commit indexes and final documentation**

```bash
git add plugins/README.md docs/README.md docs/superpowers/specs/2026-08-13-starter-session-authoring-design.md docs/superpowers/plans/2026-08-13-starter-session-authoring.md
git commit -m "docs: record starter session authoring skills"
```
