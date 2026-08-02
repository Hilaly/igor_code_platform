# Daemon Module Boundaries Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Разнести `apps/daemon/src` по предметным областям и сделать глубокие и обратные импорты между ними ошибкой ESLint без изменения поведения демона.

**Architecture:** Восемь внутренних областей получают явные `public.ts`; код внутри области импортирует соседние файлы напрямую, а между областями проходит только через фасад и только в направлении утверждённой матрицы. `main.ts` остаётся единственной точкой композиции, а настоящий корневой ESLint проверяется через `lintText` отдельным архитектурным тестом.

**Tech Stack:** TypeScript 5.9, Node.js 24 `node:test`, ESLint 9 flat config, pnpm workspaces, Prettier.

## Global Constraints

- Работать в `/Users/user/repos/sovereign_platform_node/.worktrees/daemon-module-boundaries` на ветке `refactor/daemon-module-boundaries`.
- Не менять HTTP-маршруты, протокол, состояние, порядок запуска, обработку сигналов, формат файлов или API SDK.
- Не дробить содержимое крупных модулей; эта работа меняет только расположение, импорты, фасады и архитектурные правила.
- Между областями разрешён только импорт `../<area>/public.ts`; `main.ts` импортирует только `./<area>/public.ts`.
- `public.ts` содержит явные именованные реэкспорты; `export *` запрещён.
- Не добавлять path aliases, workspace-пакеты или новые runtime-зависимости.
- Выполненные планы и спецификации в `docs/superpowers/` не переписывать под новые пути.
- Актуальную документацию менять в том же коммите, где перемещается описанный ею модуль.
- Существующее нарушение Prettier в `docs/superpowers/plans/2026-08-02-compact-menu-trigger.md` принято владельцем и не входит в задачу.

---

### Task 1: Исполняемая граница ESLint

**Files:**

- Create: `apps/daemon/src/import-boundary.test.ts`
- Modify: `apps/daemon/package.json`
- Modify: `eslint.config.js`

**Interfaces:**

- Consumes: существующие `noApplicationImports`, `noAgentRuntimeImports` и настоящий корневой flat config.
- Produces: функция конфигурации `daemonAreaBoundary(area, allowedAreas)`, восемь blocks ESLint и тест разрешённых/запрещённых импортов.

- [ ] **Step 1: Добавить dev-зависимость теста**

В `apps/daemon/package.json` добавить:

```json
"devDependencies": {
  "eslint": "^9.0.0"
}
```

Запустить `pnpm install`, чтобы `pnpm-lock.yaml` отразил доступность ESLint внутри пакета демона.

- [ ] **Step 2: Написать падающий тест настоящей конфигурации**

Создать `apps/daemon/src/import-boundary.test.ts` по образцу
`packages/agent-runtime-pi/src/import-boundary.test.ts`. Тест должен использовать:

```ts
const repositoryRoot = join(import.meta.dirname, "..", "..", "..");
const linter = new ESLint({ cwd: repositoryRoot });

async function messagesFor(relativePath: string, source: string): Promise<string[]> {
  const [result] = await linter.lintText(source, { filePath: join(repositoryRoot, relativePath) });
  assert.ok(result, `линтер ничего не сказал про ${relativePath}`);

  return result.messages
    .filter((message) => message.ruleId === "no-restricted-imports")
    .map((message) => message.message);
}
```

Проверить следующие случаи отдельными `it`:

```ts
assert.deepEqual(
  await messagesFor(
    "apps/daemon/src/sessions/example.ts",
    'import type { ProjectStore } from "../projects/public.ts";\n',
  ),
  [],
);

assert.equal(
  (
    await messagesFor(
      "apps/daemon/src/sessions/example.ts",
      'import type { ProjectStore } from "../projects/project-store.ts";\n',
    )
  ).length,
  1,
);

assert.equal(
  (
    await messagesFor(
      "apps/daemon/src/projects/example.ts",
      'import type { SessionService } from "../sessions/public.ts";\n',
    )
  ).length,
  1,
);

assert.deepEqual(
  await messagesFor(
    "apps/daemon/src/main.ts",
    [
      'import { createEventBus } from "./platform/public.ts";',
      'import { createDaemonServer } from "./http/public.ts";',
      'import { createSessionService } from "./sessions/public.ts";',
    ].join("\n"),
  ),
  [],
);

assert.equal(
  (
    await messagesFor(
      "apps/daemon/src/providers/example.ts",
      'import type { Models } from "@earendil-works/pi-ai";\n',
    )
  ).length,
  1,
);
```

- [ ] **Step 3: Запустить тест и подтвердить RED**

Run: `node --test apps/daemon/src/import-boundary.test.ts`

Expected: FAIL — глубокий импорт и обратная зависимость пока не дают сообщений ESLint.

- [ ] **Step 4: Добавить матрицу областей в ESLint**

В `eslint.config.js` добавить данные:

```js
const daemonAreas = [
  "platform",
  "http",
  "authentication",
  "settings",
  "projects",
  "providers",
  "sessions",
  "plugins",
];

const daemonAreaDependencies = {
  platform: [],
  http: ["platform"],
  authentication: ["http", "platform"],
  settings: ["http", "platform"],
  projects: ["http", "platform"],
  providers: ["http", "platform"],
  sessions: ["projects", "http", "platform"],
  plugins: ["settings", "providers", "sessions", "http", "platform"],
};
```

Добавить `daemonAreaBoundary(area, allowedAreas)`, который возвращает block для
`apps/daemon/src/<area>/**/*.ts`. В его `no-restricted-imports` повторить
`noApplicationImports` и `noAgentRuntimeImports`, затем:

```js
{
  regex: String.raw`^\.\./[^/]+/(?!public\.ts$).+`,
  message: "Области демона обращаются к соседям только через public.ts.",
},
{
  group: daemonAreas
    .filter((candidate) => candidate !== area && !allowedAreas.includes(candidate))
    .map((candidate) => `../${candidate}/public.ts`),
  message: "Направление зависимостей областей задано в docs/repository-structure.md.",
}
```

Для `main.ts` добавить отдельный block, повторяющий старые запреты и запрещающий глубокие импорты
регулярным выражением `^\./[^/]+/(?!public\.ts$).+`. Включить восемь blocks через:

```js
...Object.entries(daemonAreaDependencies).map(([area, dependencies]) =>
  daemonAreaBoundary(area, dependencies),
),
```

Если ESLint отвергнет пустой `group`, не создавать второй pattern для области без запрещённых
соседей; вычислять patterns условно.

- [ ] **Step 5: Запустить тест и проверки конфигурации**

Run: `node --test apps/daemon/src/import-boundary.test.ts`

Expected: PASS.

Run: `pnpm exec eslint eslint.config.js apps/daemon/src/import-boundary.test.ts`

Expected: PASS.

- [ ] **Step 6: Закоммитить архитектурную защиту**

```bash
git add apps/daemon/package.json apps/daemon/src/import-boundary.test.ts eslint.config.js pnpm-lock.yaml
git commit -m "test(daemon): enforce internal module boundaries"
```

### Task 2: Низкоуровневые области `platform` и `http`

**Files:**

- Create: `apps/daemon/src/platform/public.ts`
- Create: `apps/daemon/src/http/public.ts`
- Move: `apps/daemon/src/{arguments,atomic-file,data-directory,event-bus,instance-lock,logger}.{ts,test.ts}` → `apps/daemon/src/platform/`
- Move: `apps/daemon/src/{dispatcher,event-stream,filesystem,health}.{ts,test.ts}` and `server.ts` → `apps/daemon/src/http/`
- Modify: все оставшиеся модули демона, импортирующие перемещённые файлы
- Modify: `apps/daemon/src/main.ts`

**Interfaces:**

- Consumes: правила Task 1.
- Produces: фасады `platform/public.ts` и `http/public.ts`, от которых зависят последующие области.

- [ ] **Step 1: Переместить platform-модули и их тесты**

Создать `platform/`, выполнить `git mv` для перечисленных файлов и исправить только относительные
импорты внутри области. Создать явный фасад:

```ts
export { parseArguments } from "./arguments.ts";
export { writeFileAtomically } from "./atomic-file.ts";
export {
  archivedSessionsDirectoryName,
  ensureDataDirectory,
  sessionsDirectoryName,
  workDirectoryName,
} from "./data-directory.ts";
export { createEventBus, type EventBus } from "./event-bus.ts";
export { acquireInstanceLock, InstanceLockError } from "./instance-lock.ts";
export { createLogger, type Logger } from "./logger.ts";
```

Оставшиеся корневые модули и `main.ts` переводить на `./platform/public.ts`; после их будущего
перемещения путь станет `../platform/public.ts`.

- [ ] **Step 2: Проверить platform-перенос**

Run: `pnpm --filter @sovereign/daemon typecheck`

Expected: PASS.

Run: `pnpm --filter @sovereign/daemon test`

Expected: PASS.

- [ ] **Step 3: Переместить http-модули и их тесты**

Создать `http/`, выполнить `git mv`, перевести их зависимости от логгера на
`../platform/public.ts` и создать фасад:

```ts
export {
  createDispatcher,
  respondWithError,
  respondWithJson,
  type Authentication,
  type AuthenticatedSession,
  type CreateDispatcherOptions,
  type Route,
} from "./dispatcher.ts";
export { createEventStream, type EventStream } from "./event-stream.ts";
export { filesystemRoutes } from "./filesystem.ts";
export { healthRoute } from "./health.ts";
export { createDaemonServer } from "./server.ts";
```

Оставшиеся области используют `./http/public.ts` до своего перемещения; `main.ts` использует
`./http/public.ts`.

- [ ] **Step 4: Проверить и закоммитить низкоуровневые области**

Run: `pnpm --filter @sovereign/daemon typecheck && pnpm --filter @sovereign/daemon test`

Expected: PASS.

Run: `pnpm exec eslint apps/daemon/src/platform apps/daemon/src/http apps/daemon/src/main.ts`

Expected: PASS.

```bash
git add apps/daemon/src
git commit -m "refactor(daemon): group platform and HTTP modules"
```

### Task 3: Области `authentication` и `settings`

**Files:**

- Create: `apps/daemon/src/authentication/public.ts`
- Create: `apps/daemon/src/settings/public.ts`
- Move: `account`, `authentication`, `login-sessions` implementation and tests → `authentication/`
- Move: `appearance-preferences`, `settings` implementation and tests → `settings/`
- Modify: `apps/daemon/src/main.ts`
- Modify: plugin files that consume settings before Task 6
- Modify: `docs/backlog.md`

**Interfaces:**

- Consumes: `platform/public.ts`, `http/public.ts`.
- Produces: account/session-check API for `main.ts`; settings API for `main.ts` and plugins.

- [ ] **Step 1: Переместить authentication и создать фасад**

После `git mv` заменить внешние импорты на `../platform/public.ts` и `../http/public.ts`.
Создать:

```ts
export { createAccountStore, type AccountStore } from "./account.ts";
export { authenticationRoutes, createSessionCheck } from "./authentication.ts";
export { createLoginSessionStore, type LoginSessionStore } from "./login-sessions.ts";
```

`main.ts` импортирует только `./authentication/public.ts`. Обновить актуальные ссылки на
`account.ts` и `login-sessions.ts` в `docs/backlog.md`.

- [ ] **Step 2: Проверить authentication**

Run: `pnpm --filter @sovereign/daemon typecheck && node --test "apps/daemon/src/authentication/**/*.test.ts"`

Expected: PASS.

- [ ] **Step 3: Переместить settings и создать фасад**

После `git mv` создать:

```ts
export { appearancePreferencesRoutes, publishAppearanceChanges } from "./appearance-preferences.ts";
export { createSettingsStore, type SettingsSnapshot, type SettingsStore } from "./settings.ts";
```

До перемещения plugins их корневые файлы импортируют `./settings/public.ts`; `main.ts` делает то
же самое. Внутри settings разрешены только `../http/public.ts` и `../platform/public.ts`.

- [ ] **Step 4: Проверить и закоммитить области**

Run: `pnpm --filter @sovereign/daemon typecheck && pnpm --filter @sovereign/daemon test`

Expected: PASS.

Run: `pnpm exec eslint apps/daemon/src/authentication apps/daemon/src/settings apps/daemon/src/main.ts`

Expected: PASS.

```bash
git add apps/daemon/src docs/backlog.md
git commit -m "refactor(daemon): group authentication and settings"
```

### Task 4: Области `projects` и `providers`

**Files:**

- Create: `apps/daemon/src/projects/public.ts`
- Create: `apps/daemon/src/providers/public.ts`
- Move: все `project-*`, `projects.ts` and tests → `projects/`
- Move: `credential-store`, `model-catalog-store`, `provider-*`, `providers.ts` and tests → `providers/`
- Modify: `apps/daemon/src/main.ts`
- Modify: session and plugin consumers before their later moves
- Modify: `docs/models-and-providers.md`

**Interfaces:**

- Consumes: `platform/public.ts`, `http/public.ts`.
- Produces: project API for sessions/main and provider API for plugins/main.

- [ ] **Step 1: Переместить projects и создать фасад**

Создать явные экспорты, необходимые `main.ts` и sessions:

```ts
export {
  createProjectAvailabilityWatcher,
  probeProjectFolder,
  type ProjectAvailabilityWatcher,
} from "./project-availability.ts";
export { createProjectLifecycle, type ProjectLifecycle } from "./project-lifecycle.ts";
export { createProjectPathNormalizer, normalizeProjectPath } from "./project-path.ts";
export {
  createProjectStore,
  ephemeralProjectId,
  type ProjectStore,
  type StoredProject,
} from "./project-store.ts";
export { projectsRoutes, publishProjectChanges } from "./projects.ts";
```

Внутри projects использовать только `../platform/public.ts` и `../http/public.ts`. Корневой
`sessions.ts` временно импортирует `./projects/public.ts`; `main.ts` — тот же фасад.

- [ ] **Step 2: Проверить projects**

Run: `pnpm --filter @sovereign/daemon typecheck && node --test "apps/daemon/src/projects/**/*.test.ts"`

Expected: PASS.

- [ ] **Step 3: Переместить providers и создать фасад**

Создать:

```ts
export { createCredentialStore, type CredentialStore } from "./credential-store.ts";
export { createModelCatalogStore } from "./model-catalog-store.ts";
export {
  carryLoginSteps,
  providerLoginRoutes,
  publishLoginOutcomes,
} from "./provider-login-routes.ts";
export { createProviderLogins, type ProviderLogins } from "./provider-logins.ts";
export { providersRoutes } from "./providers.ts";
```

`main.ts` и пока ещё корневой `plugin-providers.ts` импортируют фасад. Обновить актуальные пути
`credential-store.ts` и `plugin-providers.ts` в `docs/models-and-providers.md`; путь
`plugin-providers.ts` окончательно сменится в Task 6, поэтому в этой задаче менять только ссылку на
уже перемещённый `credential-store.ts`.

- [ ] **Step 4: Проверить и закоммитить области**

Run: `pnpm --filter @sovereign/daemon typecheck && pnpm --filter @sovereign/daemon test`

Expected: PASS.

Run: `pnpm exec eslint apps/daemon/src/projects apps/daemon/src/providers apps/daemon/src/main.ts`

Expected: PASS.

```bash
git add apps/daemon/src docs/models-and-providers.md
git commit -m "refactor(daemon): group projects and providers"
```

### Task 5: Область `sessions`

**Files:**

- Create: `apps/daemon/src/sessions/public.ts`
- Move: `core-tools.ts`, `sessions.{ts,test.ts}`, `tool-collection.{ts,test.ts}`, `turn-queue.{ts,test.ts}` → `sessions/`
- Modify: `apps/daemon/src/main.ts`
- Modify: plugin session consumers before Task 6
- Modify: `docs/architecture.md`
- Modify: `docs/hooks.md`

**Interfaces:**

- Consumes: `projects/public.ts`, `http/public.ts`, `platform/public.ts`.
- Produces: session service, tool collector, queue and core tool source for main/plugins.

- [ ] **Step 1: Переместить session-модули и исправить импорты**

Внутренние связи `core-tools` → `tool-collection` оставить прямыми внутри области. Внешние связи
`sessions.ts` направить на `../projects/public.ts`, `../http/public.ts` и
`../platform/public.ts`.

- [ ] **Step 2: Создать явный фасад sessions**

```ts
export { coreToolSource } from "./core-tools.ts";
export { createSessionService, type SessionService } from "./sessions.ts";
export { createToolCollector, type ToolCollector } from "./tool-collection.ts";
export { createTurnQueue, type TurnQueue } from "./turn-queue.ts";
```

`main.ts`, `plugin-sessions.ts` и другие внешние потребители импортируют только этот фасад.

- [ ] **Step 3: Обновить тематическую документацию**

В `docs/architecture.md` заменить актуальную ссылку на `turn-queue.ts` новым путём
`apps/daemon/src/sessions/turn-queue.ts`. В `docs/hooks.md` заменить ссылку на
`apps/daemon/src/sessions/tool-collection.ts`. Не менять выполненные планы.

- [ ] **Step 4: Проверить и закоммитить sessions**

Run: `pnpm --filter @sovereign/daemon typecheck`

Expected: PASS.

Run: `node --test "apps/daemon/src/sessions/**/*.test.ts" && pnpm --filter @sovereign/daemon test`

Expected: PASS.

Run: `pnpm exec eslint apps/daemon/src/sessions apps/daemon/src/main.ts`

Expected: PASS.

```bash
git add apps/daemon/src docs/architecture.md docs/hooks.md
git commit -m "refactor(daemon): group session modules"
```

### Task 6: Область `plugins` и фикстуры

**Files:**

- Create: `apps/daemon/src/plugins/public.ts`
- Move: `contribution-registry.*`, all `plugin-*`, `plugins-snapshot.*` → `plugins/`
- Move: `apps/daemon/src/plugin-fixtures/` → `apps/daemon/src/plugins/fixtures/`
- Modify: `apps/daemon/tsconfig.json`
- Modify: `apps/daemon/src/main.ts`
- Modify: `docs/public-contract.md`
- Modify: `docs/models-and-providers.md`
- Modify: `docs/backlog.md`

**Interfaces:**

- Consumes: `settings/public.ts`, `providers/public.ts`, `sessions/public.ts`, `http/public.ts`, `platform/public.ts`.
- Produces: единый plugin-фасад для `main.ts`; финальная раскладка всех рабочих модулей демона.

- [ ] **Step 1: Переместить plugin-модули и фикстуры**

Выполнить `git mv` всех перечисленных файлов. Обновить относительные пути фикстур в тестах и
исключение TypeScript:

```json
"exclude": ["src/plugins/fixtures"]
```

Внутри plugins оставить прямые импорты соседних plugin-файлов. Импорты других областей заменить
только на их `public.ts`.

- [ ] **Step 2: Создать plugin-фасад для composition root**

Фасад экспортирует только имена, которые использует `main.ts`:

```ts
export { createContributionRegistry } from "./contribution-registry.ts";
export { createPluginProviders } from "./plugin-providers.ts";
export { createPluginSessions, isSessionRequest, type PluginSessions } from "./plugin-sessions.ts";
export {
  defaultPluginRoots,
  discoverPlugins,
  projectPluginRoots,
  type PluginRoot,
} from "./plugin-sources.ts";
export { createPluginSupervisor } from "./plugin-supervisor.ts";
export { createPluginWatcher } from "./plugin-watcher.ts";
export { pluginPreferencesRoute } from "./plugin-preferences.ts";
export { pluginsRoute } from "./plugins-snapshot.ts";
```

Свести импорты `main.ts` к одному `./plugins/public.ts`.

- [ ] **Step 3: Обновить актуальные тематические ссылки**

- `docs/public-contract.md`: `apps/daemon/src/plugins/plugin-wire.ts`;
- `docs/models-and-providers.md`: `apps/daemon/src/plugins/plugin-providers.ts` во всех актуальных
  местах;
- `docs/backlog.md`: `apps/daemon/src/plugins/plugin-worker.ts`.

Исторические документы `docs/superpowers/**` не менять.

- [ ] **Step 4: Проверить и закоммитить plugins**

Run: `pnpm --filter @sovereign/daemon typecheck`

Expected: PASS; фикстуры не проверяются ограниченным синтаксисом платформы.

Run: `node --test "apps/daemon/src/plugins/**/*.test.ts" && pnpm --filter @sovereign/daemon test`

Expected: PASS.

Run: `pnpm exec eslint apps/daemon/src/plugins apps/daemon/src/main.ts`

Expected: PASS.

```bash
git add apps/daemon/src apps/daemon/tsconfig.json docs/public-contract.md docs/models-and-providers.md docs/backlog.md
git commit -m "refactor(daemon): group plugin modules"
```

### Task 7: Карта репозитория и полная проверка

**Files:**

- Modify: `docs/repository-structure.md`
- Modify: любые актуальные документы вне `docs/superpowers/`, найденные финальным поиском старых путей
- Verify: all files changed by Tasks 1–6

**Interfaces:**

- Consumes: завершённую раскладку и реально работающие правила ESLint.
- Produces: актуальное долговременное описание границ и полностью проверенную ветку.

- [ ] **Step 1: Описать внутреннюю раскладку демона**

В `docs/repository-structure.md` после корневой раскладки добавить раздел со следующими правилами:

- восемь областей и ответственность каждой;
- таблица разрешённых зависимостей из design spec;
- прямые импорты внутри области и только `public.ts` между областями;
- `main.ts` как composition root;
- `public.ts` как внутренний, не совместимый публичный контракт;
- ESLint как текущий механизм защиты и архитектурный тест настоящего flat config.

В разделе «Почему так» зафиксировать отклонённые варианты: только папки без правил, немедленные
workspace-пакеты и общий `shared`; указать цену выбранного решения и критерии будущего выделения
пакета.

- [ ] **Step 2: Найти устаревшие актуальные ссылки**

Run:

```bash
rg -n 'apps/daemon/src/(account|appearance-preferences|arguments|atomic-file|authentication|contribution-registry|core-tools|credential-store|data-directory|dispatcher|event-bus|event-stream|filesystem|health|instance-lock|logger|login-sessions|model-catalog-store|plugin-|plugins-snapshot|project-|projects|provider-|providers|server|sessions|settings|tool-collection|turn-queue)\.ts' docs --glob '!superpowers/**'
```

Expected: no matches. Если есть совпадения, заменить их на фактические новые пути и повторить поиск.

- [ ] **Step 3: Проверить отсутствие файлов вне областей**

Run:

```bash
find apps/daemon/src -maxdepth 1 -type f -print | sort
```

Expected: только `apps/daemon/src/main.ts` и `apps/daemon/src/import-boundary.test.ts`.

Run:

```bash
rg -n 'from "\.\./[^/"]+/[^/"]+\.ts"' apps/daemon/src/{platform,http,authentication,settings,projects,providers,sessions,plugins} --glob '*.ts'
```

Expected: no matches; внешние импорты идут через `public.ts`.

- [ ] **Step 4: Запустить полный набор проверок**

Run: `make typecheck && make lint && make test && make build`

Expected: PASS.

Run:

```bash
pnpm exec prettier --check . \
  2>&1 | tee /tmp/daemon-module-boundaries-prettier.log
```

Expected: единственное предупреждение — заранее существующий
`docs/superpowers/plans/2026-08-02-compact-menu-trigger.md`. Все изменённые файлы проверить отдельно:

```bash
git diff --name-only main...HEAD --diff-filter=ACMR \
  | xargs pnpm exec prettier --check
```

Expected: PASS.

- [ ] **Step 5: Проверить дифф и закоммитить документацию**

Run: `git diff --check && git status --short`

Проверить, что нет изменений поведения и незапланированных файлов.

```bash
git add docs/repository-structure.md docs
git commit -m "docs(daemon): document internal module boundaries"
```

- [ ] **Step 6: Подтвердить чистое состояние после коммита**

Run: `git status --short`

Expected: no output.

Run: `git log --oneline --decorate -8`

Expected: отдельные атомарные коммиты для защиты ESLint, перемещения областей и итоговой
документации поверх design/plan commits.
