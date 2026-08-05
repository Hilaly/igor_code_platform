# Settings Projects Section Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Поместить список и деталь проектов в тот же SettingsFrame, что и остальные окна настроек, и удалить старые маршруты `/projects*`.

**Architecture:** `router.ts` добавляет закрытый раздел `projects` и отдельную страницу его детали. `SettingsView` остаётся единым композитором шести разделов и вложенных деталей; существующие ProjectsView и ProjectDetailView сохраняют предметное поведение, но принимают уровень заголовка для вложенной композиции. Публичный SettingsFrame отвечает только за общую геометрию и больше не содержит отдельного действия выхода в Projects.

**Tech Stack:** React 19, TypeScript, Vitest, Testing Library, CSS Modules, pnpm workspace.

## Global Constraints

- Работать в `/Users/user/repos/sovereign_platform_node/.worktrees/settings-plugin-detail` на `feat/settings-plugin-detail`.
- Все шесть разделов, список проекта и детали проекта/провайдера/плагина используют один SettingsFrame.
- Старые `/projects` и `/projects/:projectId` становятся unknown без редиректов.
- Глобальная левая панель проектов и сессий остаётся видимой.
- Не добавлять зависимости и не менять API демона.
- Каждый production-срез проходит RED/GREEN и завершается атомарным Conventional Commit.

---

### Task 1: Канонические маршруты Projects внутри Settings

**Files:**

- Modify: `apps/web/src/router.ts`
- Modify: `apps/web/src/router.test.ts`
- Modify: `apps/web/src/router-navigation.test.ts`

**Interfaces:**

- Produces: `SettingsSection` с `projects`.
- Produces: `Page` variant `{ kind: "settings-project"; projectId: string }`.
- Produces: `/settings/projects` и `/settings/projects/:projectId`.

- [ ] Написать тесты, которые требуют новые round-trip маршруты и `unknown` для обоих старых адресов.
- [ ] Запустить `pnpm --filter @sovereign/web test -- router.test.ts router-navigation.test.ts` и увидеть RED из-за отсутствующего раздела и старого разбора.
- [ ] Добавить `projects` в `settingsSections`, разобрать detail раньше общей settings-ветки, удалить `projectsPagePath` и variants `projects`/`project`.
- [ ] Повторить focused tests и `pnpm --filter @sovereign/web typecheck`, получить GREEN.
- [ ] Закоммитить `refactor(web): move project routes into settings`.

### Task 2: Общий SettingsFrame без отдельной кнопки Projects

**Files:**

- Modify: `packages/ui-kit/src/components/settings-frame.tsx`
- Modify: `packages/ui-kit/src/components/settings-frame.module.css`
- Modify: `packages/ui-kit/src/components/rendering.test.tsx`
- Modify: `packages/ui-kit/src/styles/styles.test.ts`
- Modify: `packages/ui-kit/src/index.ts`

**Interfaces:**

- Produces: `SettingsFrameProps` только с `context`, `settingsLabel`, `navigationLabel`, `navigation`, `children`.
- Preserves: горизонтальную прокрутку прямого `ul` в узком контейнере.

- [ ] Изменить markup-тест: шесть пунктов могут быть содержимым navigation, отдельной кнопки Projects в frame нет.
- [ ] Запустить UI-kit tests и увидеть RED из-за существующих `projectsLabel`/`onProjects` и кнопки.
- [ ] Удалить escape-hatch props, markup и CSS `.projects`; сохранить context/sidebar/content и narrow row.
- [ ] Запустить `pnpm --filter @sovereign/ui-kit test`, получить GREEN.
- [ ] Закоммитить `feat(ui-kit): add shared settings frame`.

### Task 3: Все разделы и обе Projects-страницы в SettingsView

**Files:**

- Modify: `apps/web/src/settings/settings-view.tsx`
- Modify: `apps/web/src/settings/settings-view.test.tsx`
- Modify: `apps/web/src/projects/projects-view.tsx`
- Modify: `apps/web/src/projects/projects-view.test.tsx`
- Modify: `apps/web/src/projects/project-detail-view.tsx`
- Modify: `apps/web/src/projects/project-detail-view.test.tsx`
- Modify: `packages/ui-kit/src/i18n/en.ts`
- Modify: `packages/ui-kit/src/i18n/ru.ts`

**Interfaces:**

- Produces: `ProjectsViewProps.headingLevel?: 1 | 2`, default `1`.
- Produces: `ProjectDetailViewProps.headingLevel?: 1 | 2`, default `1`.
- Produces: `SettingsViewProps.projects`, плюс `detailTitle` для project/plugin details.

- [ ] Добавить тесты SettingsView: шестой выбранный пункт Projects, список и detail справа, один h1, соседние разделы отсутствуют.
- [ ] Добавить тесты Projects views на `headingLevel={2}` без потери самостоятельного default h1.
- [ ] Запустить три focused test-файла и увидеть RED.
- [ ] Добавить переводы `settings.section.projects` и description; внедрить оба ReactNode в закрытое отображение SettingsView.
- [ ] Добавить headingLevel в ProjectsView и ProjectDetailView и использовать его во всех loading/ready состояниях.
- [ ] Запустить focused tests и получить GREEN.
- [ ] Закоммитить `feat(web): add projects settings section`.

### Task 4: App-композиция и навигация

**Files:**

- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/shell/page.tsx`
- Modify: `apps/web/src/shell/page.test.tsx` если существует, иначе маршрутизаторные/component tests из предыдущих задач.

**Interfaces:**

- Consumes: `{ kind: "settings"; section: "projects" }` и `{ kind: "settings-project"; projectId }`.
- Produces: ProjectsView и ProjectDetailView только через SettingsView.

- [ ] Изменить тест/типовой контракт PageView так, чтобы старых projects/project slots больше не было, а оба маршрута передавали один settings node.
- [ ] Запустить web typecheck/tests и увидеть RED на старых Page variants или props.
- [ ] Удалить самостоятельные slots из PageView, передать ProjectsView/ProjectDetailView внутрь SettingsView, обновить open/back и file-resources projectId.
- [ ] Считать settings-project временно недоступным для правой панели и сохранить левую глобальную навигацию.
- [ ] Запустить web tests/typecheck/build и получить GREEN.
- [ ] Закоммитить `feat(web): compose project views inside settings`.

### Task 5: Документация и полная визуальная проверка

**Files:**

- Modify: `docs/ui-kit.md`
- Modify: `docs/ui-extension-model.md` при наличии старых публичных core routes.
- Modify: затронутые route/docs ссылки, найденные `rg`.

- [ ] Переписать действующий контракт на шесть разделов, новые маршруты и общий SettingsFrame; удалить утверждения о самостоятельном `/projects`.
- [ ] Запустить `rg` и убедиться, что `/projects` остался только в HTTP API и исторических specs/plans, но не как действующий web route.
- [ ] Запустить `pnpm -r test`, `pnpm -r typecheck`, `pnpm eslint .`, `pnpm prettier --check .`, web build, Ladle build и `git diff --check`.
- [ ] В браузере проверить все шесть разделов, обе detail pages, переходы, единственный h1, широкий и узкий layouts.
- [ ] Закоммитить `docs(ui): document unified settings window` и при необходимости отдельный `fix(web): address settings visual verification`.
