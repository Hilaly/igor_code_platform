# Slice 12c-1 Review Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Исправить контрактные дефекты вкладок и команд среза 12c-1 и объединить feature-ветку с
актуальным `main` без потери поведения обеих веток.

**Architecture:** Внутренний module cache разделяет запуск загрузки и пассивное чтение уже известного
состояния. Host-only слой команд наблюдает стабильную версию кеша, одинаково вычисляет доступность для
кнопки и палитры, а `invoke` следует за актуальным runtime до завершения вызова. Рендерер места получает
кардинальность явно; namespace `core` резервируется на входе в систему.

**Tech Stack:** TypeScript 5.9, React 19, Node.js 24, Vitest 3 + jsdom, `node:test`, pnpm workspaces,
ESLint 9, Prettier, Make.

## Global Constraints

- Утверждённая публичная поверхность `Command`, `CommandOutcome`, `useCommands`, `useCommandCatalog`,
  `PlaceTabs` и `useHostPlaceTabs` не сужается и не переименовывается.
- Показ кнопки, открытие палитры и чтение `available` не начинают `import()`.
- До первой загрузки бандла команда видима и доступна; после загрузки кнопка и палитра одинаково
  учитывают `available`.
- Любое исключение плагинного дескриптора преобразуется в значение и диагностику; rejected Promise из
  `invoke` не выходит.
- Команда с `placeId` рисуется только в месте кардинальности `action`; неизвестное место продолжает
  ждать.
- Старую ревизию после её исчезновения из snapshot не запускать и не возобновлять.
- Plugin id `core` недопустим для любого источника плагина.
- Каждый продуктовый дефект сначала получает падающий regression test, затем минимальное исправление.
- Документация меняется в том же логическом коммите, что и поведение, которое она описывает.
- Работа идёт в существующей linked worktree ветки `feat/slice-12c1-tabs-and-commands`.
- Историю не переписывать, push и PR не выполнять.
- В окружении Codex команды с web-тестами запускать с
  `NODE_OPTIONS=--no-experimental-webstorage`, чтобы отключить пустой experimental Node webstorage.

---

### Task 1: Объединить актуальный `main`

**Files:**

- Merge and resolve: `apps/web/src/App.tsx`
- Merge and resolve: `apps/web/src/App.test.tsx`
- Merge and resolve: `docs/README.md`
- Merge and resolve: `docs/public-contract.md`
- Merge and resolve: `docs/roadmap.md`
- Merge and resolve: `docs/ui-extension-model.md`
- Merge and resolve: `docs/ui-kit.md`
- Merge and resolve: `packages/protocol/src/places.ts`
- Merge and resolve: `packages/protocol/src/places.test.ts`
- Merge and resolve: `packages/sdk/src/index.ts`
- Merge and resolve: `packages/sdk/src/index.test.ts`
- Merge and resolve: `packages/ui-kit/src/i18n/messages/en.ts`
- Merge and resolve: `packages/ui-kit/src/i18n/messages/ru.ts`

**Interfaces:**

- Consumes: текущий локальный `main` и feature HEAD.
- Produces: merge commit `merge: bring main into slice 12c-1`.
- Invariant: каждый конфликт сохраняет независимые additions обеих веток; код палитры/вкладок не
  заменяет более новые session/UI-kit изменения из `main`.

- [x] **Step 1: Зафиксировать входное состояние**

Run:

```bash
git status --short --branch
git rev-parse HEAD
git rev-parse main
git merge-base HEAD main
```

Expected: feature worktree clean; branch is `feat/slice-12c1-tabs-and-commands`.

- [x] **Step 2: Начать merge и получить точный список конфликтов**

Run:

```bash
git merge --no-ff main
git diff --name-only --diff-filter=U
```

Expected: merge stops only on files modified by both branches; no unrelated file is deleted.

- [x] **Step 3: Разрешить конфликты по поведению**

Для каждого файла удалить conflict markers и сохранить обе стороны:

- в `App.tsx`/`App.test.tsx` оставить новые session/composer изменения `main` и подключение
  `useHostPlaceTabs`, CommandPalette, кнопки и shortcut из 12c-1;
- в `places.ts`/`places.test.ts` оставить новые core/dynamic places из `main` и
  `core.panel.tabs`, command helpers и их тесты из 12c-1;
- в `sdk/index.ts` и тесте оставить новые SDK additions `main` и `contribute.command`;
- в i18n-каталогах оставить все ключи обеих веток без дубликатов;
- документационные списки объединить по темам, не выбирая одну версию файла целиком.

Run:

```bash
rg -n '^(<<<<<<<|=======|>>>>>>>)' apps packages docs
git diff --check
```

Expected: no conflict markers and no whitespace errors.

- [x] **Step 4: Проверить объединённую базу и завершить merge**

Run:

```bash
NODE_OPTIONS=--no-experimental-webstorage make check
NODE_OPTIONS=--no-experimental-webstorage make build
git add apps packages docs pnpm-lock.yaml
git commit -m "merge: bring main into slice 12c-1"
```

Expected: checks and build exit 0 before merge commit.

---

### Task 2: Зарезервировать plugin id `core`

**Files:**

- Modify: `packages/protocol/src/plugin.ts`
- Modify: `packages/protocol/src/plugin.test.ts`
- Modify: `docs/plugins.md`
- Modify: `docs/public-contract.md`

**Interfaces:**

- Consumes: `parsePluginManifest`, `pluginIdPattern`.
- Produces: `reservedPluginIds` and a refused parse result for id `core`.

- [x] **Step 1: Write the failing manifest test**

Добавить в `plugin.test.ts`:

```ts
it("reserves the core namespace for the host", () => {
  const result = parsePluginManifest(validManifest({ id: "core" }));

  assert.equal(result.kind, "refused");
  assert.equal(
    result.kind === "refused" ? result.reason : "",
    "sovereign.id core is reserved for the host",
  );
});
```

- [x] **Step 2: Verify RED**

Run:

```bash
pnpm --filter @sovereign/protocol exec node --test src/plugin.test.ts
```

Expected: FAIL because `core` currently parses successfully.

- [x] **Step 3: Implement the reservation and document it**

В `plugin.ts` после pattern validation отказать идентификаторам из
`const reservedPluginIds = new Set(["core"])`. В `plugins.md` и `public-contract.md` записать, что
`core` принадлежит хосту и не является допустимым plugin id.

- [x] **Step 4: Verify GREEN and commit**

Run:

```bash
pnpm --filter @sovereign/protocol exec node --test src/plugin.test.ts
pnpm --filter @sovereign/protocol run typecheck
pnpm exec prettier --check packages/protocol/src/plugin.ts packages/protocol/src/plugin.test.ts docs/plugins.md docs/public-contract.md
git diff --check
```

Commit: `fix(protocol): reserve the core plugin namespace`

---

### Task 3: Разделить загрузку и пассивное чтение module cache

**Files:**

- Modify: `packages/browser-sdk/src/host.tsx`
- Modify: `packages/browser-sdk/src/host.test.tsx`
- Modify: `packages/browser-sdk/src/commands.test.tsx`
- Modify: `apps/web/src/places/module-cache.ts`
- Modify: `apps/web/src/places/module-cache.test.ts`
- Modify: `apps/web/src/places/place-host.test.tsx`
- Modify: `apps/web/src/commands/command-palette.test.tsx`
- Modify: `docs/ui-extension-model.md`

**Interfaces:**

- Produces:

```ts
export type PluginModuleCache = {
  load(status: PluginStatus): PluginModuleLoad;
  peek(status: PluginStatus): PluginModuleLoad | undefined;
  version(): number;
  retain(statuses: readonly PluginStatus[]): void;
  subscribe(listener: () => void): () => void;
  dispose(): void;
};
```

- `load` is the only operation allowed to call `begin`.
- `peek` returns an existing entry only when its revision matches `status.browser.revision`.
- `version()` returns the same number until `announce()` publishes a real state change.

- [x] **Step 1: Write failing passive-read and version tests**

В `module-cache.test.ts` проверить:

```ts
expect(cache.peek(running("r1"))).toBeUndefined();
expect(importModule).not.toHaveBeenCalled();
const before = cache.version();
cache.load(running("r1"));
expect(cache.version()).toBe(before);
await settled();
expect(cache.version()).toBeGreaterThan(before);
expect(cache.peek(running("r1"))).toEqual({ kind: "loaded", module });
```

Добавить проверку, что `retain([])` после существующей записи увеличивает version и уведомляет
подписчика, а `peek` старой ревизии после удаления возвращает `undefined` и не перезапускает import.

- [x] **Step 2: Verify RED**

Run:

```bash
NODE_OPTIONS=--no-experimental-webstorage pnpm --filter @sovereign/web exec vitest run src/places/module-cache.test.ts
```

Expected: type/test failure because `peek`, `load` and `version` do not exist.

- [x] **Step 3: Implement the cache split**

Переименовать `moduleOf` в `load`. Добавить чистый `peek`, числовую `version`, increment внутри
`announce`, и `announce()` после фактического удаления entries в `retain`. Не объявлять изменение,
если `retain` ничего не удалил. `dispose` не уведомляет уже удалённых listeners.

Обновить `PlaceInstance` на `cache.load(status)`, а все test fakes — на полный новый интерфейс.

- [x] **Step 4: Verify GREEN and commit**

Run:

```bash
NODE_OPTIONS=--no-experimental-webstorage pnpm --filter @sovereign/web exec vitest run src/places/module-cache.test.ts src/places/place-host.test.tsx
pnpm --filter @sovereign/browser-sdk exec vitest run src/host.test.tsx src/commands.test.tsx
pnpm --filter @sovereign/browser-sdk run typecheck
pnpm --filter @sovereign/web run typecheck
git diff --check
```

Commit: `refactor(browser-sdk): separate module cache reads from loads`

---

### Task 4: Следовать актуальному runtime во время `invoke`

**Files:**

- Modify: `packages/browser-sdk/src/commands.tsx`
- Modify: `packages/browser-sdk/src/commands.test.tsx`
- Modify: `docs/ui-extension-model.md`

**Interfaces:**

- `useCommands().invoke` keeps its public signature.
- An in-flight invocation re-resolves command registration and plugin status from the latest runtime.
- A waiter subscribes to the current cache, re-subscribes when cache identity changes, and is woken by
  both runtime changes and cache announcements.

- [x] **Step 1: Write failing revision-transition tests**

Добавить provider probe, который перерисовывается с последовательностью:

```ts
r1 loading -> same plugin building without browser -> r2 loading -> r2 loaded
```

Проверить, что Promise не завершается до r2, `r1` handler не вызывается, `r2` handler вызывается один
раз и outcome равен `{ kind: "done" }`. Отдельно проверить, что исчезновение plugin status и
исчезновение command registration во время ожидания завершают вызов `failed`, а не оставляют Promise.

- [x] **Step 2: Verify RED**

Run:

```bash
pnpm --filter @sovereign/browser-sdk exec vitest run src/commands.test.tsx
```

Expected: stale-revision test remains pending or invokes r1 under the current captured runtime.

- [x] **Step 3: Implement latest-runtime waiting**

Хранить текущий runtime в ref и заменить `waiting` на набор проверяющих функций. Эффект изменения
runtime будит каждую проверку. Внутри ожидателя заново выполнить `resolveCommand`, найти plugin status,
переподписаться при смене cache identity и вызвать `cache.load` только для текущего статуса. Статус без
browser assets продолжает ждать; отсутствующая команда/плагин завершает `failed`.

- [x] **Step 4: Put `available` and `run` behind one error boundary**

После получения текущего loaded module заново взять текущую registration. В одном `try/catch` проверить
форму export, вызвать `available`, затем `await run`. Любая причина нормализуется через
`cause instanceof Error ? cause.message : String(cause)`.

- [x] **Step 5: Verify GREEN and commit**

Run:

```bash
pnpm --filter @sovereign/browser-sdk exec vitest run src/commands.test.tsx
pnpm --filter @sovereign/browser-sdk run typecheck
git diff --check
```

Commit: `fix(browser-sdk): keep command calls on the current revision`

---

### Task 5: Унифицировать доступность кнопки и палитры без eager load

**Files:**

- Modify: `packages/browser-sdk/src/commands.tsx`
- Modify: `packages/browser-sdk/src/commands.test.tsx`
- Modify: `packages/browser-sdk/src/host.tsx`
- Modify: `packages/browser-sdk/src/index.tsx`
- Modify: `apps/web/src/commands/command-palette.tsx`
- Modify: `apps/web/src/commands/command-palette.test.tsx`
- Modify: `docs/ui-extension-model.md`

**Interfaces:**

- Public `useCommandCatalog(context)` remains registrations-only.
- Host entrypoint produces:

```ts
export type HostCommandCatalogEntry = {
  registration: CommandContributionRegistration;
  disabled: boolean;
};

export function useHostCommandCatalog(context: PlaceContext): HostCommandCatalogEntry[];
```

- `CommandButton` and `useHostCommandCatalog` use the same safe cached-descriptor evaluator.

- [x] **Step 1: Write failing `available` exception tests**

В `commands.test.tsx` проверить, что `invoke` с `available: () => { throw new Error("availability broke") }`
возвращает `{ kind: "failed", reason: "availability broke" }`, пишет одну диагностику и не создаёт
unhandled rejection. Для action strip проверить, что тот же export не ломает render и оставляет кнопку
disabled.

- [x] **Step 2: Write failing no-load and palette availability tests**

В browser-sdk проверить, что рендер `CommandButton` вызывает `peek`, но ни разу не вызывает `load`.
В web palette проверить два состояния:

```ts
peek -> undefined: row is enabled and load was not called
peek -> loaded available false: row remains visible but has no selectable button
```

Добавить случай throwing `available`: палитра остаётся открытой, строка disabled, диагностика записана.

- [x] **Step 3: Verify RED**

Run:

```bash
pnpm --filter @sovereign/browser-sdk exec vitest run src/commands.test.tsx
NODE_OPTIONS=--no-experimental-webstorage pnpm --filter @sovereign/web exec vitest run src/commands/command-palette.test.tsx
```

Expected: button invokes `load`; palette never disables the plugin row; throwing predicate escapes.

- [x] **Step 4: Implement one cached availability evaluator**

В `commands.tsx` безопасно преобразовать `cache.peek(status)` в `{ disabled, complaint? }`. Missing
module/loading means enabled; missing/malformed export, false or throwing `available` means disabled.
`CommandButton` subscribes to `cache.version()` and emits complaint through `useDiagnosticVoice` in an
effect, outside render.

`useHostCommandCatalog` делает одну subscription на version, вычисляет состояние всех registrations и
тем же голосом публикует complaints. Экспортировать hook только через `@sovereign/browser-sdk/host`.
Палитра использует host catalog вместо registrations-only `useCommandCatalog`.

- [x] **Step 5: Verify GREEN and commit**

Run:

```bash
pnpm --filter @sovereign/browser-sdk exec vitest run src/commands.test.tsx src/browser-sdk.test.tsx
NODE_OPTIONS=--no-experimental-webstorage pnpm --filter @sovereign/web exec vitest run src/commands/command-palette.test.tsx
pnpm --filter @sovereign/browser-sdk run typecheck
pnpm --filter @sovereign/web run typecheck
git diff --check
```

Commit: `fix(web): share lazy command availability`

---

### Task 6: Ограничить команды местами `action` и исправить keys

**Files:**

- Modify: `packages/browser-sdk/src/host.tsx`
- Modify: `packages/browser-sdk/src/host.test.tsx`
- Modify: `packages/browser-sdk/src/commands.test.tsx`
- Modify: `docs/ui-extension-model.md`

**Interfaces:**

- `CollectionPlace` receives `cardinality: "collection" | "action"`.
- Core host reads cardinality through `corePlace(id)`; plugin host uses `resolvePlaceDeclaration`.
- Mixed-row key is `${registration.kind}:${registration.id}`.

- [x] **Step 1: Write failing cardinality tests**

Добавить command contribution с `placeId: "core.sidebar.sections"` и проверить, что
`HostPlaceCollection` не рисует кнопку в `collection`. Добавить plugin-owned `collection` с командой и
проверить то же. Контрольный `action` обязан продолжать рисовать кнопку и компонент.

- [x] **Step 2: Write the failing duplicate-key test**

Передать component и command с одинаковым namespaced id в action place, перехватить `console.error` и
проверить, что оба элемента отрисованы без React warning `Encountered two children with the same key`.

- [x] **Step 3: Verify RED**

Run:

```bash
pnpm --filter @sovereign/browser-sdk exec vitest run src/host.test.tsx src/commands.test.tsx
```

Expected: command appears in collection and React reports duplicate key.

- [x] **Step 4: Implement cardinality-aware rendering and typed keys**

`HostPlaceCollection` возвращает `null`, если core place не `collection`/`action`. Plugin variant
сохраняет текущую проверку и передаёт resolved cardinality. В `CollectionPlace` отфильтровать commands
для `collection`; для `action` сохранить общий `orderPlaceContributions`. Оба вида используют
`kind:id` key.

- [x] **Step 5: Verify GREEN and commit**

Run:

```bash
pnpm --filter @sovereign/browser-sdk exec vitest run src/host.test.tsx src/commands.test.tsx
pnpm --filter @sovereign/browser-sdk run typecheck
git diff --check
```

Commit: `fix(browser-sdk): render commands only in action places`

---

### Task 7: Показывать несовместимое размещение в Plugin Detail

**Files:**

- Modify: `apps/web/src/plugins/plugin-detail-view.tsx`
- Modify: `apps/web/src/plugins/plugin-detail-view.test.tsx`
- Modify: `packages/ui-kit/src/i18n/messages/en.ts`
- Modify: `packages/ui-kit/src/i18n/messages/ru.ts`
- Modify: `docs/plugins.md`

**Interfaces:**

- `PlaceClaimOutcome` adds `incompatible`.
- `plugins.places.incompatible` exists in both core catalogs.

- [x] **Step 1: Write the failing detail test**

Показать command с `placeId: "core.sidebar.sections"` и проверить английскую строку
`not applied: commands require an action place`. Контрольный command в
`core.view.header.actions` сохраняет `joins the row`.

- [x] **Step 2: Verify RED**

Run:

```bash
NODE_OPTIONS=--no-experimental-webstorage pnpm --filter @sovereign/web exec vitest run src/plugins/plugin-detail-view.test.tsx
```

Expected: current view reports `joins the row` for the collection place.

- [x] **Step 3: Implement and document the incompatible outcome**

В `placeClaims`, после получения известной cardinality и до общего `added`, вернуть `incompatible`,
если registration is command and cardinality is not `action`. Tone is `warning`. Добавить строки:

```ts
"plugins.places.incompatible": "not applied: commands require an action place"
"plugins.places.incompatible": "не применён: команде требуется место-действие"
```

В `plugins.md` описать, что неизвестное место ждёт, а известное место другой кардинальности видно как
несовместимое и не рисуется.

- [x] **Step 4: Verify GREEN and commit**

Run:

```bash
NODE_OPTIONS=--no-experimental-webstorage pnpm --filter @sovereign/web exec vitest run src/plugins/plugin-detail-view.test.tsx
pnpm --filter @sovereign/ui-kit run test
pnpm --filter @sovereign/web run typecheck
git diff --check
```

Commit: `fix(web): report incompatible command placements`

---

### Task 8: Привести документацию и план 12c-1 к факту

**Files:**

- Modify: `docs/public-contract.md`
- Modify: `docs/ui-extension-model.md`
- Modify: `docs/plugins.md`
- Modify: `docs/backlog.md`
- Modify: `docs/superpowers/plans/2026-08-09-slice-12c1-tabs-and-commands.md`
- Modify: `docs/superpowers/plans/2026-08-09-slice-12c1-review-fixes.md`

**Interfaces:**

- `PlaceCardinality` prose/type includes `tabs`.
- Original plan distinguishes completed work from explicitly cancelled history rewrite/runtime check.
- Backlog records the observed session rename flake as non-blocking evidence, not as a diagnosed cause.

- [x] **Step 1: Repair the public contract**

Change the stale snippet to:

```ts
type PlaceCardinality = "single" | "collection" | "action" | "tabs";
```

Ensure command prose says passive UI never loads a bundle merely to determine metadata; a loaded
descriptor may update enabled state.

- [x] **Step 2: Reconcile the original plan**

Mark Tasks 1–12 implementation steps `[x]` where the corresponding commit exists. Keep the runtime
measurement marked cancelled with its reason. Replace Task 13's unperformed rewrite steps with checked
statements that history was already atomic, therefore no backup ref or rewrite was needed; preserve the
rule that push/PR were not done.

- [x] **Step 3: Record the suspected flake without inventing a cause**

Add a backlog item naming `keeps a session rename dialog open when the write is refused`: one observed
failure, subsequent repeated passes, exact test path, and requirement to capture output/seed if it
recurs. State explicitly that it is not attributed to 12c-1.

- [x] **Step 4: Verify docs and commit**

Run:

```bash
pnpm exec prettier --check docs/public-contract.md docs/ui-extension-model.md docs/plugins.md docs/backlog.md docs/superpowers/plans/2026-08-09-slice-12c1-tabs-and-commands.md docs/superpowers/plans/2026-08-09-slice-12c1-review-fixes.md
git diff --check
```

Commit: `docs: reconcile slice 12c-1 with review fixes`

---

### Task 9: Полная верификация и повторный review

**Files:**

- Modify only if a verification failure proves a remaining in-scope defect; start a new RED–GREEN
  cycle and commit it separately.

**Interfaces:**

- Produces fresh evidence for tests, build, clean diff and merge readiness.

- [ ] **Step 1: Run the complete repository verification**

Run:

```bash
NODE_OPTIONS=--no-experimental-webstorage make check
NODE_OPTIONS=--no-experimental-webstorage make build
git diff --check main...HEAD
```

Expected: all commands exit 0; no new warnings beyond the pre-existing Vite chunk-size warning.

- [ ] **Step 2: Repeat the suspected flaky test**

Run ten times:

```bash
for run in {1..10}; do
  NODE_OPTIONS=--no-experimental-webstorage pnpm --filter @sovereign/web exec vitest run src/App.test.tsx -t "keeps a session rename dialog open when the write is refused" || break
done
```

Expected: ten passes. Any failure is captured verbatim and handled as a separate diagnosed defect.

- [ ] **Step 3: Audit requirements and the final diff**

Run:

```bash
git status --short --branch
git log --oneline --decorate main..HEAD
git diff --stat main...HEAD
git diff main...HEAD -- packages/browser-sdk/src/commands.tsx packages/browser-sdk/src/host.tsx apps/web/src/places/module-cache.ts apps/web/src/commands/command-palette.tsx apps/web/src/plugins/plugin-detail-view.tsx packages/protocol/src/plugin.ts docs/public-contract.md
```

Check each Global Constraint against code and tests. Ensure no conflict marker, temporary file,
generated build artifact or unrelated refactor remains.

- [ ] **Step 4: Mark this plan complete**

Change only completed checkboxes to `[x]`, run `git diff --check`, and commit:

```bash
git add docs/superpowers/plans/2026-08-09-slice-12c1-review-fixes.md
git commit -m "docs: complete slice 12c-1 review plan"
```

Do not push and do not create a PR.
