# Slice 12b-2 Browser SDK Review Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Закрыть замечания ревью среза 12b-2 отдельным публичным
`@sovereign/browser-sdk`, настоящей отрисовкой plugin-owned places, безопасным жизненным циклом
browser modules и воспроизводимой живой проверкой.

**Architecture:** `@sovereign/browser-sdk` владеет публичными React-компонентами мест и host-only
runtime, а `apps/web` сохраняет сетевую политику: динамический `import()`, DOM stylesheet links и
реализацию кеша. Протокол сначала разрешает identity вклада в проектном контексте и только затем
фильтрует конкретное место. Один runtime обслуживает core и plugin-owned places, загружает owner
`builtIn`, изолирует каждый экземпляр и отдаёт диагностику хосту.

**Tech Stack:** TypeScript 5.9, React 19, Node.js 24, Vitest 3 + jsdom, `node:test`, esbuild,
pnpm workspaces, ESLint 9, Prettier, Make.

## Global Constraints

- Срез 12b-2 остаётся закрытым: plugin-owned place обязан реально отрисовываться и расширяться
  другим плагином.
- Основной entrypoint `@sovereign/browser-sdk` экспортирует только `PlaceContext`, `PlaceProps`,
  `Place` и `PlaceCollection` текущего среза.
- `@sovereign/browser-sdk/host` не входит в публичный контракт автора плагина.
- React остаётся peer dependency browser SDK; второй React в browser bundle недопустим.
- Публичные типы browser SDK объявляются внутри SDK, а не реэкспортируются из
  `@sovereign/protocol`.
- Динамический `import()`, DOM stylesheet links и реализация module cache остаются в `apps/web`.
- UI Kit не поглощает browser SDK и не реэкспортируется им; текущая поверхность
  `packages/ui-kit/src/index.ts` считается стабильной.
- Страницы, вкладки, команды и navigation facade остаются в срезе 12c.
- Host-сериализация instance state не реализуется; действующий state живёт только время React mount.
- Каждый дефект сначала получает падающий regression test, затем минимальное исправление.
- Документация меняется в том же логическом коммите, что и код, который делает её истинной.
- Push и PR не выполнять.

---

### Task 1: Разрешать identity до фильтрации места

**Files:**

- Modify: `packages/protocol/src/places.ts`
- Modify: `packages/protocol/src/places.test.ts`
- Modify: `docs/ui-extension-model.md`
- Modify: `docs/plugins.md`

**Interfaces:**

- Consumes: `projectOfContribution`, `pluginSourceRank`, `ContributionRegistration`,
  `PlaceContext`.
- Produces:

```ts
export function resolvePlaceDeclaration(
  placeId: string,
  contributions: readonly ContributionRegistration[],
  context: PlaceContext,
): PlaceContributionRegistration | undefined;

export function componentsForPlace(
  placeId: string,
  contributions: readonly ContributionRegistration[],
  context: PlaceContext,
): ComponentContributionRegistration[];
```

- Invariant: порядок всегда `project filter -> kind:id identity -> source rank -> placeId`.

- [ ] **Step 1: Write failing single-place identity tests**

Добавить data-копию компонента в старом месте и project-копию с тем же `kind:id` в новом месте:

```ts
const data = component("themed", "data", { placeId: "core.settings.plugins" });
const project = {
  ...data,
  pluginKey: "project:work:themed",
  source: "project:work" as const,
  placeId: "core.session.chat",
};

assert.deepEqual(
  resolvePlaceProvider("core.settings.plugins", [data, project], { project: "work" }),
  { kind: "built-in" },
);
assert.deepEqual(resolvePlaceProvider("core.session.chat", [data, project], { project: "work" }), {
  kind: "plugin",
  contribution: project,
});
assert.deepEqual(resolvePlaceProvider("core.settings.plugins", [data, project], {}), {
  kind: "plugin",
  contribution: data,
});
```

Добавить отдельную проверку, что project-копия `project:spare` не влияет на контекст `work`.

- [ ] **Step 2: Write failing collection/action identity tests**

Той же парой регистраций проверить `orderPlaceContributions`:

```ts
assert.deepEqual(
  orderPlaceContributions("core.settings.plugins", [data, project], { project: "work" }),
  [],
);
assert.deepEqual(
  orderPlaceContributions("core.session.chat", [data, project], { project: "work" }),
  [project],
);
assert.deepEqual(orderPlaceContributions("core.settings.plugins", [data, project], {}), [data]);
```

Добавить helper для `kind: "place"` и проверить тот же shadowing через
`resolvePlaceDeclaration`: browser SDK не должен заново изобретать алгоритм для владельца места.

- [ ] **Step 3: Run the protocol tests and observe the regression**

Run:

```bash
pnpm --filter @sovereign/protocol exec node --test src/places.test.ts
```

Expected: FAIL — data-копия остаётся применимой в старом месте, потому что текущий код фильтрует
`placeId` до identity.

- [ ] **Step 4: Implement one context/identity resolver**

В `places.ts` сначала оставить только непроектные вклады и вклады текущего проекта, затем
сгруппировать их по `${registration.kind}:${registration.id}`. В каждой группе оставить ровно одного
лидера максимального ранга; равный верхний ранг означает, что identity не применяется.

```ts
function registrationsForContext<
  T extends PlaceContributionRegistration | ComponentContributionRegistration,
>(registrations: readonly T[], context: PlaceContext): T[] {
  const applicable = registrations.filter((registration) => {
    const project = projectOfContribution(registration);
    return project === undefined || project === context.project;
  });
  const claims = new Map<string, T[]>();

  for (const registration of applicable) {
    const identity = `${registration.kind}:${registration.id}`;
    claims.set(identity, [...(claims.get(identity) ?? []), registration]);
  }

  return [...claims.values()].flatMap((claimants) => {
    const best = Math.max(...claimants.map(registrationRank));
    const leaders = claimants.filter((claimant) => registrationRank(claimant) === best);
    return leaders.length === 1 ? leaders : [];
  });
}
```

`componentsForPlace` и новый `resolvePlaceDeclaration` обязаны использовать этот helper до
`placeId`. Спор разных component ids за один single place остаётся в `resolvePlaceProvider` и не
смешивается со спором одной identity.

- [ ] **Step 5: Make protocol docs truthful**

В `ui-extension-model.md` заменить прежнюю последовательность «сначала `placeId`» на утверждённый
алгоритм identity-first. В `plugins.md` явно сказать, что browser snapshot — union результатов всех
контекстов, поэтому применяющий его браузер повторно разрешает identity для текущего проекта.

- [ ] **Step 6: Verify and commit**

Run:

```bash
pnpm --filter @sovereign/protocol exec node --test src/places.test.ts
pnpm --filter @sovereign/protocol run typecheck
pnpm exec prettier --check packages/protocol/src/places.ts packages/protocol/src/places.test.ts docs/ui-extension-model.md docs/plugins.md
git diff --check
```

Expected: all commands exit 0.

Commit: `fix(protocol): resolve place identities before filtering`

---

### Task 2: Сделать stylesheet revisions и dispose безопасными

**Files:**

- Modify: `apps/web/src/places/module-cache.ts`
- Modify: `apps/web/src/places/module-cache.test.ts`
- Modify: `docs/ui-extension-model.md`
- Modify: `docs/backlog.md`

**Interfaces:**

- Consumes: `PluginStatus.browser`, `LoadedPluginModule`, DOM `Document`.
- Produces:

```ts
export type PluginModuleCache = {
  moduleOf(status: PluginStatus): PluginModuleLoad;
  retain(statuses: readonly PluginStatus[]): void;
  subscribe(listener: () => void): () => void;
  dispose(): void;
};
```

- Invariant: callback старого или disposed cache может удалить только link, созданный тем же cache.

- [ ] **Step 1: Add precise link-event helpers to the cache test**

Вместо массового `finishStylesheets` получать конкретный link по ревизии:

```ts
const sheet = (target: Document, revision: string): HTMLLinkElement => {
  const found = target.head.querySelector<HTMLLinkElement>(
    `link[data-sovereign-plugin="data:themed@${revision}"]`,
  );
  expect(found).not.toBeNull();
  return found!;
};

const loadSheet = (link: HTMLLinkElement): void => link.dispatchEvent(new Event("load"));
const failSheet = (link: HTMLLinkElement): void => link.dispatchEvent(new Event("error"));
```

- [ ] **Step 2: Write failing revision-order tests**

Покрыть оба порядка завершения:

```ts
cache.moduleOf(running("r1", "/assets/r1.css"));
const r1 = sheet(target, "r1");
cache.moduleOf(running("r2", "/assets/r2.css"));
const r2 = sheet(target, "r2");

loadSheet(r2);
await settled();
loadSheet(r1);
await settled();
expect(sheets(target)).toEqual(["data:themed@r2"]);
```

Во втором тесте сначала завершить `r1`, убедиться, что устаревший link снят, затем завершить `r2` и
снова получить ровно `r2`.

- [ ] **Step 3: Write failing error-cleanup tests**

Добавить три случая:

```ts
failSheet(sheet(target, "r1"));
await settled();
expect(sheets(target)).toEqual([]);
expect(cache.moduleOf(styled).kind).toBe("failed");
```

Для JS import rejection сначала отправить `load`, затем отклонить deferred import и проверить, что
link неуспешной ревизии удалён. Для устаревшей ревизии проверить, что её поздний `error` не снимает
успешный link текущей ревизии.

- [ ] **Step 4: Write failing disposal and old-callback tests**

Проверить idempotent `dispose()`, очистку CSS и изоляцию нового cache:

```ts
const oldCache = createPluginModuleCache({ importModule: oldImport, document: target });
oldCache.moduleOf(running("r1", "/assets/r1.css"));
const oldLink = sheet(target, "r1");
oldCache.dispose();
oldCache.dispose();
expect(sheets(target)).toEqual([]);

const newCache = createPluginModuleCache({ importModule: newImport, document: target });
newCache.moduleOf(running("r2", "/assets/r2.css"));
const newLink = sheet(target, "r2");
loadSheet(oldLink);
failSheet(oldLink);
await settled();
expect(newLink.isConnected).toBe(true);
expect(newImport).not.toHaveBeenCalled();
```

Отдельно подписать listener старого cache и проверить, что позднее завершение import после dispose
его не вызывает.

- [ ] **Step 5: Run the focused tests and observe the failures**

Run:

```bash
pnpm --filter @sovereign/web exec vitest run src/places/module-cache.test.ts
```

Expected: FAIL — поздний `r1` снимает `r2`, error links остаются, а `dispose` отсутствует.

- [ ] **Step 6: Track stylesheet ownership inside one cache**

Хранить созданные links в локальном `Set<HTMLLinkElement>`, удалять их прямой ссылкой и никогда не
искать «чужие» links широким selector из позднего callback.

```ts
let disposed = false;
const ownedStylesheets = new Set<HTMLLinkElement>();

const removeStylesheet = (link: HTMLLinkElement): void => {
  ownedStylesheets.delete(link);
  link.remove();
};

const isCurrent = (pluginKey: string, revision: string): boolean =>
  !disposed && entries.get(pluginKey)?.revision === revision;
```

На `load` текущей ревизии удалить только принадлежащие этому cache старые links того же плагина.
Устаревшая ревизия удаляет собственный link и не начинает import. Stylesheet error и JS import error
удаляют link своей ревизии до `settle`. `settle`, `announce`, `retain`, `subscribe` и все callbacks
проверяют `disposed`.

- [ ] **Step 7: Implement `dispose()`**

```ts
dispose: () => {
  if (disposed) return;
  disposed = true;
  entries.clear();
  listeners.clear();
  for (const link of [...ownedStylesheets]) removeStylesheet(link);
},
```

`moduleOf` после dispose возвращает постоянный `pendingModule` и не начинает новых загрузок.

- [ ] **Step 8: Update lifecycle documentation**

В `ui-extension-model.md` описать current-revision guard, удаление links при stylesheet/import error,
provider-owned dispose и фактическое время жизни instance state только до unmount/reload. Из
`backlog.md` убрать обещание сериализации UI-state как уже существующее; оставить его отдельной
будущей задачей с формой API, которую ещё предстоит спроектировать.

- [ ] **Step 9: Verify and commit**

Run:

```bash
pnpm --filter @sovereign/web exec vitest run src/places/module-cache.test.ts
pnpm --filter @sovereign/web run typecheck
pnpm exec prettier --check apps/web/src/places/module-cache.ts apps/web/src/places/module-cache.test.ts docs/ui-extension-model.md docs/backlog.md
git diff --check
```

Commit: `fix(web): own plugin stylesheet revisions safely`

---

### Task 3: Создать публичный `@sovereign/browser-sdk`

**Files:**

- Create: `packages/browser-sdk/package.json`
- Create: `packages/browser-sdk/tsconfig.json`
- Create: `packages/browser-sdk/src/index.tsx`
- Create: `packages/browser-sdk/src/host.tsx`
- Create: `packages/browser-sdk/src/runtime-context.tsx`
- Create: `packages/browser-sdk/src/instance-boundary.tsx`
- Create: `packages/browser-sdk/src/browser-sdk.test.tsx`
- Create: `packages/browser-sdk/src/host.test.tsx`
- Modify: `apps/web/package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `docs/public-contract.md`
- Modify: `docs/repository-structure.md`
- Modify: `docs/ui-kit.md`

**Interfaces:**

- Public root produces exactly:

```ts
export type PlaceContext = {
  project?: string;
  subject?: Readonly<Record<string, string>>;
};

export type PlaceProps = {
  id: string;
  context: PlaceContext;
};

export function Place(props: PlaceProps): ReactNode;
export function PlaceCollection(props: PlaceProps): ReactNode;
```

- Host-only subpath produces:

```ts
export type LoadedPluginModule = Record<string, unknown>;
export type PluginModuleLoad =
  | { kind: "loading" }
  | { kind: "loaded"; module: LoadedPluginModule }
  | { kind: "failed"; reason: string };

export type PluginModuleCache = {
  moduleOf(status: PluginStatus): PluginModuleLoad;
  retain(statuses: readonly PluginStatus[]): void;
  subscribe(listener: () => void): () => void;
  dispose(): void;
};

export type BrowserRuntimeProviderProps = {
  contributions: readonly ContributionRegistration[];
  plugins: readonly PluginStatus[];
  onDiagnostic(text: string): void;
  createCache(): PluginModuleCache;
  cache?: PluginModuleCache;
  children: ReactNode;
};

export type HostPlaceProps = PlaceProps & { builtIn: ReactNode };

export function BrowserRuntimeProvider(props: BrowserRuntimeProviderProps): ReactNode;
export function HostPlace(props: HostPlaceProps): ReactNode;
export function HostPlaceCollection(props: PlaceProps): ReactNode;
```

- [ ] **Step 1: Add the package manifest and TypeScript boundary**

`package.json`:

```json
{
  "name": "@sovereign/browser-sdk",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.tsx",
    "./host": "./src/host.tsx"
  },
  "scripts": {
    "typecheck": "tsc -p tsconfig.json",
    "test": "vitest run"
  },
  "dependencies": {
    "@sovereign/protocol": "workspace:*"
  },
  "peerDependencies": {
    "react": "^19.0.0"
  },
  "devDependencies": {
    "@testing-library/react": "^16.3.2",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "jsdom": "^30.0.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "vite": "^7.0.0",
    "vitest": "^3.0.0"
  }
}
```

`tsconfig.json` повторяет browser-настройки UI Kit: `module: esnext`,
`moduleResolution: bundler`, `lib: [es2023, dom, dom.iterable]`, `jsx: react-jsx`,
`types: [vite/client]`, `include: [src]`.

- [ ] **Step 2: Write public-surface tests before components exist**

В `browser-sdk.test.tsx` проверить runtime exports и структурную совместимость контекста:

```ts
import * as browserSdk from "./index.tsx";
import type { PlaceContext as ProtocolPlaceContext } from "@sovereign/protocol";
import type { PlaceContext } from "./index.tsx";

expect(Object.keys(browserSdk).sort()).toEqual(["Place", "PlaceCollection"]);

const sdkContext: PlaceContext = { project: "work", subject: { sessionId: "s1" } };
const protocolContext: ProtocolPlaceContext = sdkContext;
const roundTrip: PlaceContext = protocolContext;
expect(roundTrip).toEqual(sdkContext);
```

Проверить, что `Place` и `PlaceCollection` вне provider возвращают пустой результат, а не бросают.

- [ ] **Step 3: Run the new package test and observe the missing package**

Run:

```bash
pnpm install
pnpm --filter @sovereign/browser-sdk exec vitest run src/browser-sdk.test.tsx
```

Expected: FAIL до создания entrypoints.

- [ ] **Step 4: Implement the public root without UI Kit exports**

`runtime-context.tsx` содержит только React context и внутреннюю форму runtime. `index.tsx` объявляет
свои public types и вызывает renderer из context. Никакой тип из протокола не реэкспортируется, UI
Kit не импортируется и не отдаётся наружу.

```tsx
export function Place(props: PlaceProps): ReactNode {
  const runtime = useContext(BrowserRuntimeContext);
  return runtime === undefined ? null : <runtime.Place {...props} />;
}

export function PlaceCollection(props: PlaceProps): ReactNode {
  const runtime = useContext(BrowserRuntimeContext);
  return runtime === undefined ? null : <runtime.PlaceCollection {...props} />;
}
```

- [ ] **Step 5: Define the host-only contracts and provider ownership rule**

`BrowserRuntimeProvider` принимает либо тестовый `cache`, либо создаёт cache переданной стабильной
`createCache`. Это сохраняет implementation в `apps/web`, но отдаёт provider владение lifecycle.

```tsx
const owned = useMemo(() => cache ?? createCache(), [cache, createCache]);

useEffect(() => {
  owned.retain(plugins);
}, [owned, plugins]);

useEffect(() => () => owned.dispose(), [owned]);
```

В `host.test.tsx` fake cache считает `retain` и `dispose`; unmount provider обязан вызвать dispose
ровно один раз. Повторный render с новым snapshot вызывает `retain`, но не dispose.

- [ ] **Step 6: Declare UI Kit stability and package boundaries**

В `public-contract.md` объявить стабильными основной browser SDK entrypoint и текущую поверхность
`@sovereign/ui-kit`. Host subpath явно назвать внутренним. В `repository-structure.md` добавить
`packages/browser-sdk` между protocol и apps/web. В `ui-kit.md` удалить формулировку о свободной
поломке текущих primitives и записать разделение: UI Kit отвечает за вид, browser SDK — за
взаимодействие UI плагина с платформой. Индекс `docs/README.md` уже обновлён вместе с созданием этого
плана и в feature-коммит не переносится.

- [ ] **Step 7: Verify and commit the package boundary**

Run:

```bash
pnpm install
pnpm --filter @sovereign/browser-sdk exec vitest run src/browser-sdk.test.tsx src/host.test.tsx
pnpm --filter @sovereign/browser-sdk run typecheck
pnpm --filter @sovereign/web run typecheck
pnpm exec prettier --check packages/browser-sdk apps/web/package.json pnpm-lock.yaml docs/public-contract.md docs/repository-structure.md docs/ui-kit.md
git diff --check
```

Commit: `feat(browser-sdk): publish the browser place contract`

---

### Task 4: Сделать browser SDK singleton host module

**Files:**

- Modify: `packages/protocol/src/plugin-browser.ts`
- Create: `packages/protocol/src/plugin-browser.test.ts`
- Modify: `apps/web/src/plugins/host-modules.ts`
- Modify: `apps/web/src/plugins/host-modules.test.ts`
- Modify: `apps/daemon/src/plugins/fixtures/browsered/src/browser.tsx`
- Modify: `apps/daemon/src/plugins/plugin-browser-build.test.ts`
- Modify: `docs/ui-extension-model.md`

**Interfaces:**

- Consumes: `hostModuleRegistryKey`, `hostModuleSpecifiers`, package root
  `@sovereign/browser-sdk`.
- Produces: external specifier `@sovereign/browser-sdk` backed by the exact module registered by
  `apps/web`.

- [ ] **Step 1: Write protocol and web registry tests**

`plugin-browser.test.ts`:

```ts
assert.equal(hostModuleSpecifiers.includes("@sovereign/browser-sdk"), true);
assert.equal(new Set(hostModuleSpecifiers).size, hostModuleSpecifiers.length);
```

`host-modules.test.ts`:

```ts
const browserSdk = await import("@sovereign/browser-sdk");
expect(registry()["@sovereign/browser-sdk"]).toBe(browserSdk);
expect(Object.keys(registry()).sort()).toEqual([...hostModuleSpecifiers].sort());
```

- [ ] **Step 2: Make the existing bundle fixture import the SDK**

В `fixtures/browsered/src/browser.tsx` добавить настоящий bare import:

```tsx
import { Place as BrowserPlace } from "@sovereign/browser-sdk";

export const browserPlace = BrowserPlace;
```

В execution test fake registry добавить:

```ts
const browserPlace = () => null;
registry[hostModuleRegistryKey] = {
  react: fakeReact,
  "react-dom": fakeReactDom,
  "react/jsx-runtime": fakeJsxRuntime,
  "@sovereign/ui-kit": fakeUiKit,
  "@sovereign/browser-sdk": { Place: browserPlace, PlaceCollection: () => null },
};
```

После импорта собранного bundle проверить `loaded.browserPlace === browserPlace`.

- [ ] **Step 3: Run tests and observe the missing external**

Run:

```bash
pnpm --filter @sovereign/protocol exec node --test src/plugin-browser.test.ts
pnpm --filter @sovereign/web exec vitest run src/plugins/host-modules.test.ts
pnpm --filter @sovereign/daemon exec node --test src/plugins/plugin-browser-build.test.ts
```

Expected: FAIL — specifier отсутствует в protocol list и web registry.

- [ ] **Step 4: Register the SDK in both halves**

Добавить строку в `hostModuleSpecifiers`, импортировать `* as browserSdk` в web registry и добавить
точно тот же specifier в `hostModules`. Не добавлять SDK в bundle самого плагина: esbuild plugin уже
строит filter из общего protocol list.

- [ ] **Step 5: Document the singleton reason**

В `ui-extension-model.md` добавить browser SDK к модулям хоста и объяснить, что общий React context
работает только потому, что host module отдаёт плагину тот же объект SDK, который использует shell.

- [ ] **Step 6: Verify and commit**

Run:

```bash
pnpm --filter @sovereign/protocol run test
pnpm --filter @sovereign/web exec vitest run src/plugins/host-modules.test.ts
pnpm --filter @sovereign/daemon exec node --test src/plugins/plugin-browser-build.test.ts
pnpm --filter @sovereign/daemon run typecheck
pnpm --filter @sovereign/web run typecheck
git diff --check
```

Commit: `feat(browser): register the browser SDK host module`

---

### Task 5: Перенести place runtime и отрисовать plugin-owned places

**Files:**

- Modify: `packages/browser-sdk/src/index.tsx`
- Modify: `packages/browser-sdk/src/host.tsx`
- Modify: `packages/browser-sdk/src/runtime-context.tsx`
- Modify: `packages/browser-sdk/src/instance-boundary.tsx`
- Modify: `packages/browser-sdk/src/browser-sdk.test.tsx`
- Modify: `packages/browser-sdk/src/host.test.tsx`
- Modify: `apps/web/src/places/place-host.tsx`
- Delete: `apps/web/src/places/instance-boundary.tsx`
- Modify: `apps/web/src/places/place-host.test.tsx`
- Modify: `apps/web/src/places/module-cache.ts`
- Modify: `apps/web/src/App.tsx`
- Modify: `docs/ui-extension-model.md`
- Modify: `docs/public-contract.md`

**Interfaces:**

- Consumes: `resolvePlaceDeclaration`, `resolvePlaceProvider`, `orderPlaceContributions`, plugin
  statuses and `PluginModuleCache` snapshots.
- Produces: one runtime for `HostPlace`, public `Place`, `HostPlaceCollection` and public
  `PlaceCollection`.
- Boundary key:

```ts
const boundaryKey = [pluginKey, contributionId, exportName, revision ?? ""].join("\u0000");
```

- [ ] **Step 1: Move the current core-place tests to the SDK host suite**

Сначала перенести без изменения ожиданий: built-in без claim, plugin replacement, window-wide
project rejection, equal-rank dispute, missing export, load failure, building wait, throwing
component, source rank, collection order and isolation. Подменить web cache маленьким fake cache,
который синхронно возвращает `PluginModuleLoad`.

После переноса заменить содержимое `apps/web/src/places/place-host.test.tsx` двумя adapter-тестами:
реальный web cache удаляет CSS при unmount SDK provider; поздний callback старого adapter не меняет
link нового mount.

- [ ] **Step 2: Add failing owner-builtIn tests**

Создать place declaration владельца:

```ts
const board: PlaceContributionRegistration = {
  ownership: "plugin",
  pluginKey: "data:placed",
  pluginId: "placed",
  source: "data",
  kind: "place",
  id: "placed.board",
  declaredId: "board",
  cardinality: "single",
  replaceable: true,
  builtIn: "Board",
};
```

Проверить последовательно:

1. `<Place id="placed.board">` рисует `Board` владельца.
2. claim `rival.board` заменяет owner `builtIn`.
3. два claims равного ранга возвращают owner `builtIn` и одну диагностику.
4. load/export/render failure replacement возвращает owner `builtIn`.
5. отсутствующее place declaration рисует пусто без диагностики.
6. `replaceable: false` игнорирует claims; без `builtIn` рисует пусто.

- [ ] **Step 3: Add failing plugin-owned collection/action tests**

Для declaration с `cardinality: "collection"` и затем `"action"` проверить group/order/id sorting,
пустой результат без declaration и независимую границу каждого экземпляра. Падение среднего
элемента не удаляет ранний и поздний элементы.

- [ ] **Step 4: Add failing boundary-key regressions**

Рендерить бросающий компонент, затем `rerender` исправного компонента и по одному менять поля tuple:

```ts
expect(boundaryKey("data:placed", "placed.panel", "Panel", "r1")).not.toBe(
  boundaryKey("data:rival", "placed.panel", "Panel", "r1"),
);
expect(boundaryKey("data:placed", "placed.panel", "Panel", "r1")).not.toBe(
  boundaryKey("data:placed", "placed.other", "Panel", "r1"),
);
expect(boundaryKey("data:placed", "placed.panel", "Panel", "r1")).not.toBe(
  boundaryKey("data:placed", "placed.panel", "Other", "r1"),
);
expect(boundaryKey("data:placed", "placed.panel", "Panel", "r1")).not.toBe(
  boundaryKey("data:placed", "placed.panel", "Panel", "r2"),
);
```

Поведенческий тест обязан доказать новую попытку для исправного export при той же browser revision.

- [ ] **Step 5: Run the SDK tests and observe missing plugin-owned rendering**

Run:

```bash
pnpm --filter @sovereign/browser-sdk exec vitest run src/browser-sdk.test.tsx src/host.test.tsx
```

Expected: FAIL — public `Place` ещё не разрешает declaration/builtIn, runtime остаётся в web.

- [ ] **Step 6: Implement one instance loader**

Вынести `InstanceBoundary`, diagnostic voice и `PlaceInstance` в browser SDK. `PlaceInstance`
принимает не только component registration, а явную ссылку:

```ts
type BrowserExportReference = {
  pluginKey: string;
  contributionId: string;
  exportName: string;
};
```

По `pluginKey` находится status, по status — cache snapshot, по `exportName` — React component.
Fallback передаётся узлом. Complaint остаётся deduplicated per text.

- [ ] **Step 7: Implement public and host renderers**

Public `Place`:

1. вызывает `resolvePlaceDeclaration`;
2. требует `cardinality === "single"`;
3. строит owner fallback из `builtIn` владельца declaration;
4. при `replaceable` применяет `resolvePlaceProvider`;
5. dispute/failure/absence возвращает owner fallback.

Public `PlaceCollection` требует declaration с `collection` или `action`, затем использует
`orderPlaceContributions`. `HostPlace` использует готовый `builtIn` node core view, но тот же
provider resolver и `PlaceInstance`. `HostPlaceCollection` использует тот же collection renderer.

- [ ] **Step 8: Leave only the web cache adapter in `apps/web`**

`module-cache.ts` импортирует `PluginModuleCache`, `PluginModuleLoad` и `LoadedPluginModule` из
`@sovereign/browser-sdk/host`. `place-host.tsx` становится тонким adapter:

```tsx
export function BrowserRuntimeProvider(props: WebBrowserRuntimeProviderProps) {
  return <SdkBrowserRuntimeProvider {...props} createCache={createPluginModuleCache} />;
}

export { HostPlace, HostPlaceCollection } from "@sovereign/browser-sdk/host";
```

В `App.tsx` заменить `PlaceRuntimeProvider`, `Place`, `PlaceCollection` на
`BrowserRuntimeProvider`, `HostPlace`, `HostPlaceCollection`; `children` core place заменить prop
`builtIn`.

- [ ] **Step 9: Prove provider unmount removes real web CSS**

В web-тесте adapter создать настоящий `createPluginModuleCache`, начать styled load, завершить его,
unmount provider и проверить `link[data-sovereign-plugin]` отсутствует. Поздний callback старого
cache после нового mount не меняет новый link.

- [ ] **Step 10: Update the extension contract**

В `ui-extension-model.md` описать public `Place`/`PlaceCollection`, owner `builtIn`, одинаковый runtime
core/plugin places, cardinality rules, fallback and boundary tuple. В `public-contract.md` перечислить
стабильные root exports; host subpath оставить внутренним.

- [ ] **Step 11: Verify and commit**

Run:

```bash
pnpm --filter @sovereign/browser-sdk run test
pnpm --filter @sovereign/browser-sdk run typecheck
pnpm --filter @sovereign/web exec vitest run src/places/module-cache.test.ts src/places/place-host.test.tsx
pnpm --filter @sovereign/web run typecheck
pnpm exec eslint packages/browser-sdk apps/web/src/places apps/web/src/App.tsx
git diff --check
```

Commit: `feat(browser-sdk): render plugin-owned places`

---

### Task 6: Сохранить проект на всём маршруте новой сессии

**Files:**

- Create: `apps/web/src/App.test.tsx`
- Modify: `apps/web/src/App.tsx`
- Verify: `apps/web/src/sessions/new-session-view.tsx`
- Modify: `apps/web/src/sessions/new-session-view.test.tsx`
- Modify: `docs/ui-extension-model.md`

**Interfaces:**

- Consumes: real `createNavigation`, App state `draftProjectId`, `sessions.selectProject`.
- Produces: one live project id shared by `PlaceContext.project`, `NewSessionView.initialProjectId`
  and the session controller.

- [ ] **Step 1: Build a narrow App-level harness**

В `App.test.tsx` оставить настоящими `App`, React state и `createNavigation`. Замокать только network
session functions, data hooks and heavy leaf views. `ProjectDetailView` возвращает кнопку, вызывающую
`onNewSession`; `NewSessionView` показывает `initialProjectId` и кнопку, вызывающую
`onSelectProject("p2")`; web `HostPlace` записывает последний `context` и возвращает `builtIn`.

```tsx
vi.mock("./projects/project-detail-view.tsx", () => ({
  ProjectDetailView: ({ onNewSession }: { onNewSession(): void }) => (
    <button onClick={onNewSession}>new in project</button>
  ),
}));

vi.mock("./sessions/new-session-view.tsx", () => ({
  NewSessionView: (props: { initialProjectId?: string; onSelectProject(id: string): void }) => (
    <>
      <output data-testid="draft-project">{props.initialProjectId ?? "none"}</output>
      <button onClick={() => props.onSelectProject("p2")}>select p2</button>
    </>
  ),
}));
```

Data hooks возвращают static ready state; `probeSession` возвращает `authenticated`; stream connector
не открывает сеть. Перед render установить `/settings/projects/p1` через `history.replaceState`.

- [ ] **Step 2: Write the failing route-lifetime regression**

```ts
render(<App />);
fireEvent.click(await screen.findByRole("button", { name: "new in project" }));

await waitFor(() => expect(window.location.pathname).toBe("/sessions/new"));
expect(screen.getByTestId("draft-project").textContent).toBe("p1");
expect(lastNewSessionContext).toEqual({ project: "p1" });

fireEvent.click(screen.getByRole("button", { name: "select p2" }));
expect(screen.getByTestId("draft-project").textContent).toBe("p2");
expect(lastNewSessionContext).toEqual({ project: "p2" });
expect(selectProject).toHaveBeenLastCalledWith("p2");
```

Добавить переход с маршрута и проверить, что следующий глобальный open новой сессии получает
`none`/пустой context.

- [ ] **Step 3: Run the App test and observe the immediate clear**

Run:

```bash
pnpm --filter @sovereign/web exec vitest run src/App.test.tsx
```

Expected: FAIL — effect на `page.kind === "new-session"` сразу очищает `draftProjectId`.

- [ ] **Step 4: Keep the id while the route is active**

Заменить effect на очистку при уходе:

```ts
useEffect(() => {
  if (page.kind !== "new-session") setDraftProjectId(undefined);
}, [page.kind]);
```

Обернуть callback формы:

```tsx
onSelectProject={(projectId) => {
  setDraftProjectId(projectId === "" ? undefined : projectId);
  sessions.selectProject(projectId);
}}
```

Глобальная кнопка продолжает явно ставить `undefined` до navigate. Project-detail и sidebar opens
продолжают ставить свой project id до navigate.

- [ ] **Step 5: Preserve isolated NewSessionView behavior**

В `new-session-view.test.tsx` оставить проверки preselection и ручной смены; добавить rerender
родителя после `onSelectProject`, чтобы убедиться, что форма не сбрасывает локальный выбор при
обновлении `initialProjectId` тем же значением.

- [ ] **Step 6: Document the live route context and commit**

В `ui-extension-model.md` записать, что проект `core.session.new` живёт до ухода с маршрута и одним
изменением обновляет place context, form and controller.

Run:

```bash
pnpm --filter @sovereign/web exec vitest run src/App.test.tsx src/sessions/new-session-view.test.tsx
pnpm --filter @sovereign/web run typecheck
pnpm exec prettier --check apps/web/src/App.tsx apps/web/src/App.test.tsx apps/web/src/sessions/new-session-view.tsx apps/web/src/sessions/new-session-view.test.tsx docs/ui-extension-model.md
git diff --check
```

Commit: `fix(web): keep the new-session project context`

---

### Task 7: Не терять `off` при объяснении place claims

**Files:**

- Modify: `apps/web/src/plugins/plugin-detail-view.tsx`
- Modify: `apps/web/src/plugins/plugin-detail-view.test.tsx`
- Modify: `packages/ui-kit/src/i18n/messages/en.ts`
- Modify: `packages/ui-kit/src/i18n/messages/ru.ts`
- Modify: `docs/ui-kit.md`

**Interfaces:**

- Consumes: active `snapshot.contributions`, metadata-only
  `snapshot.switchedOffContributions`, `ContributionEntry.off`.
- Produces: `PlaceClaimOutcome` with `"switchedOff"`; active resolution never sees off entries.

- [ ] **Step 1: Write failing switched-off claim tests**

Добавить три DOM-теста:

```ts
const showPlaces = (next: PluginsSnapshot): void => {
  render(
    <PluginDetailView
      state={{ snapshot: next, stale: false }}
      pluginKey="data:example"
      onBack={vi.fn()}
      onSwitch={vi.fn()}
      translator={translator}
    />,
  );
};

it("labels a switched-off core component claim as switched off", () => {
  const off = component("example", "core.settings.plugins");
  showPlaces({ ...withPlaces([]), switchedOffContributions: [off] });
  expect(screen.getByText("switched off")).toBeTruthy();
  expect(screen.queryByText("the place is free: the contribution is switched off")).toBeNull();
});
```

Второй тест: active component ссылается на plugin-owned collection, declaration которого лежит
только в `switchedOffContributions`; UI может определить cardinality и пишет `joins the row`.

Третий тест: сам collection component выключен; outcome всегда `switched off`, а не `joins the row`.

- [ ] **Step 2: Run the focused test and observe misclassification**

Run:

```bash
pnpm --filter @sovereign/web exec vitest run src/plugins/plugin-detail-view.test.tsx
```

Expected: FAIL — `placeClaims` отбрасывает `off` до классификации.

- [ ] **Step 3: Preserve `ContributionEntry` through classification**

```ts
type PlaceClaimOutcome =
  "switchedOff" | "taken" | "free" | "overridden" | "disputed" | "added" | "waiting" | "project";

function placeClaims(
  declared: ContributionEntry[],
  active: readonly ContributionRegistration[],
  known: readonly ContributionRegistration[],
): PlaceClaim[] {
  return declared
    .filter(
      (entry): entry is ContributionEntry & { registration: ComponentContributionRegistration } =>
        entry.registration.kind === "component",
    )
    .map(({ registration, off }) => {
      if (off) return { registration, outcome: "switchedOff" };
      // project/cardinality/provider checks follow here
    });
}
```

`known` равен active плюс switched-off declarations и используется только `cardinalityOf`.
`resolvePlaceProvider` получает только active. Выключенный place declaration не становится runtime
provider и не добавляет элементы коллекции.

- [ ] **Step 4: Add translations and update the UI contract**

Добавить:

```ts
"plugins.places.switchedOff": "switched off"
```

```ts
"plugins.places.switchedOff": "выключен"
```

В `ui-kit.md` уточнить, что карточка различает выключенный claim до объяснения rank/cardinality.

- [ ] **Step 5: Verify and commit**

Run:

```bash
pnpm --filter @sovereign/web exec vitest run src/plugins/plugin-detail-view.test.tsx
pnpm --filter @sovereign/ui-kit exec vitest run src/i18n/i18n.test.ts
pnpm --filter @sovereign/web run typecheck
pnpm --filter @sovereign/ui-kit run typecheck
git diff --check
```

Commit: `fix(web): explain switched-off place claims`

---

### Task 8: Добавить tracked fixtures и безопасный seed

**Files:**

- Create: `apps/daemon/src/plugins/fixtures/placed/package.json`
- Create: `apps/daemon/src/plugins/fixtures/placed/src/worker.ts`
- Create: `apps/daemon/src/plugins/fixtures/placed/src/browser.tsx`
- Create: `apps/daemon/src/plugins/fixtures/placed/src/browser.module.css`
- Create: `apps/daemon/src/plugins/fixtures/rival/package.json`
- Create: `apps/daemon/src/plugins/fixtures/rival/src/worker.ts`
- Create: `apps/daemon/src/plugins/fixtures/rival/src/browser.tsx`
- Create: `apps/daemon/src/plugins/fixtures/browserless/package.json`
- Create: `apps/daemon/src/plugins/fixtures/browserless/src/worker.ts`
- Modify: `apps/daemon/src/plugins/fixtures/README.md`
- Create: `apps/daemon/src/plugins/runbook-fixtures.ts`
- Create: `apps/daemon/src/plugins/runbook-fixtures.test.ts`
- Create: `apps/daemon/src/plugins/seed-runbook-fixtures.ts`
- Modify: `apps/daemon/package.json`
- Modify: `apps/daemon/src/plugins/plugin-browser-build.test.ts`
- Verify: `apps/daemon/src/plugins/plugin-supervisor.test.ts`
- Modify: `docs/repository-structure.md`
- Modify: `docs/runbook.md`
- Modify: `docs/roadmap.md`
- Modify: `docs/backlog.md`
- Modify: `docs/master-spec.md`
- Modify: `docs/README.md`

**Interfaces:**

- Produces:

```ts
export const runbookFixtureNames = ["placed", "rival", "browserless"] as const;

export type SeedRunbookFixturesOptions = {
  dataDirectory: string;
  fixturesDirectory?: string;
  sdkDirectory?: string;
};

export async function seedRunbookFixtures(options: SeedRunbookFixturesOptions): Promise<void>;
```

- CLI: `pnpm --filter @sovereign/daemon run seed-runbook -- <fresh-data-directory>`.
- Invariant: preflight happens before writes; existing preferences or target plugin directory causes
  refusal without partial overwrite.

- [ ] **Step 1: Turn the ignored live plugins into tracked fixtures**

`placed` сохраняет core claims и объявляет два своих места:

```ts
await contribute.place({
  id: "board",
  title: "Board of the placed plugin",
  cardinality: "single",
  replaceable: true,
  builtIn: "Board",
});
await contribute.place({
  id: "board-actions",
  title: "Actions of the placed board",
  cardinality: "action",
  replaceable: false,
});
```

Его `PluginsPanel` использует публичный SDK:

```tsx
import { Place, PlaceCollection, type PlaceContext } from "@sovereign/browser-sdk";

export function PluginsPanel({ context }: { context: PlaceContext }) {
  return (
    <div className={styles.panel}>
      <Place id="placed.board" context={context} />
      <PlaceCollection id="placed.board-actions" context={context} />
    </div>
  );
}

export function Board({ context }: { context: PlaceContext }) {
  return <Text>the built-in board for {context.project ?? "the window"}</Text>;
}
```

`rival` объявляет replacement для `placed.board`, action для `placed.board-actions` и равный claim
на `core.settings.plugins`. `browserless` оставляет component без `sovereign.browser`.

- [ ] **Step 2: Write seed tests before the helper**

На новом пути проверить:

1. три fixture directory скопированы в `<data>/plugins`;
2. `preferences.json` содержит entries для `data:placed`, `data:rival`, `data:browserless`;
3. начальные disabled contributions оставляют доступным встроенный список плагинов и позволяют
   включать owner/replacement/dispute по шагам runbook;
4. каждый worker fixture имеет локальный symlink `node_modules/@sovereign/sdk` на workspace package;
5. повторный seed отказывается и не меняет sentinel-файлы;
6. существующий `preferences.json` или одна plugin directory вызывает отказ до копирования остальных.

Начальные preferences зафиксировать тестом как данные:

```ts
{
  plugins: {
    "data:placed": {
      enabled: true,
      disabledContributions: ["placed.plugins", "placed.boom"],
    },
    "data:rival": {
      enabled: true,
      disabledContributions: ["rival.plugins", "rival.board", "rival.board-action"],
    },
    "data:browserless": { enabled: true, disabledContributions: [] },
  },
}
```

- [ ] **Step 3: Run the seed test and observe the missing helper**

Run:

```bash
pnpm --filter @sovereign/daemon exec node --test src/plugins/runbook-fixtures.test.ts
```

Expected: FAIL because the helper and tracked fixtures do not exist.

- [ ] **Step 4: Implement preflight, copy and symlinks**

`seedRunbookFixtures` resolves all source/target paths and checks every target plus
`preferences.json` before the first write. The data directory may be absent or may already exist but
must not contain any target path; create it with recursive `mkdir` only after preflight. Use
`fs/promises.cp` with `recursive: true, errorOnExist: true, force: false`; create
`node_modules/@sovereign` and a directory symlink named `sdk` inside each copied fixture. Write
preferences once after every copy and symlink succeeds.

CLI accepts exactly one positional argument, prints the seeded path, sets non-zero exit code with the
original reason on refusal, and contains no platform startup logic.

`apps/daemon/package.json`:

```json
"seed-runbook": "node src/plugins/seed-runbook-fixtures.ts"
```

- [ ] **Step 5: Build and execute the tracked fixture bundles**

Extend `plugin-browser-build.test.ts` so `placed` and `rival` build from tracked paths. Register
real/fake host modules and import the resulting ESM; this proves the public `Place` import survives
the daemon pipeline. Run the unchanged supervisor suite to catch fixture enumeration assumptions
introduced by three new directories; if it fails, fix only assertions whose old closed fixture list
is no longer true.

- [ ] **Step 6: Replace the prose-only runbook with reproducible commands**

Начало раздела:

```bash
RUNBOOK_DATA="$(mktemp -d)"
pnpm --filter @sovereign/daemon run seed-runbook -- "$RUNBOOK_DATA"
node apps/daemon/src/main.ts "$RUNBOOK_DATA" --port 8787
pnpm --filter @sovereign/web run dev -- --host localhost --port 5273
```

Далее дать команды создания account/login cookie и PUT preferences для последовательной проверки:
owner `builtIn` -> rival replacement/action -> equal-rank core dispute -> throwing sibling ->
browserless refusal -> CSS revision. Project-копию `placed` создавать отдельным шагом после создания
реального проекта; seed не угадывает project id и не пишет project preferences.

В cleanup явно остановить оба процесса и удалить только значение `RUNBOOK_DATA`, полученное от
`mktemp -d` в этом сценарии.

- [ ] **Step 7: Reconcile status documents**

В `repository-structure.md` назвать tracked fixture path и seed helper. В `roadmap.md` оставить
12b-2 в «Пройдено», но заменить прежнюю нерепродуцируемую проверку на новую. В `backlog.md` оставить
только действительно отложенные pages/tabs/commands, serialization and browser sandbox. В
`master-spec.md` и `docs/README.md` удалить формулировки, будто browser UI или plugin-owned places
ещё отсутствуют.

- [ ] **Step 8: Verify and commit**

Run:

```bash
pnpm --filter @sovereign/daemon exec node --test src/plugins/runbook-fixtures.test.ts src/plugins/plugin-browser-build.test.ts src/plugins/plugin-supervisor.test.ts
pnpm --filter @sovereign/daemon run typecheck
pnpm exec prettier --check apps/daemon/src/plugins/fixtures apps/daemon/src/plugins/runbook-fixtures.ts apps/daemon/src/plugins/runbook-fixtures.test.ts apps/daemon/src/plugins/seed-runbook-fixtures.ts apps/daemon/package.json docs/repository-structure.md docs/runbook.md docs/roadmap.md docs/backlog.md docs/master-spec.md docs/README.md
git diff --check
```

Commit: `test(daemon): seed reproducible browser plugin fixtures`

---

### Task 9: Проверить весь итог до переписывания истории

**Files:**

- Verify all changed files.
- Modify only when a failing check exposes a real regression or a stale statement.

**Interfaces:**

- Consumes: complete branch tree.
- Produces: one verified pre-rewrite tree and a backup ref pointing to it.

- [ ] **Step 1: Scan for stale contract claims**

Run:

```bash
rg -n "browser UI.*нет|браузерн.*ещ[её] нет|plugin-owned.*нет|свободно лом|host.*сериал|сериализац.*state" docs README.md
```

Expected: only explicit backlog/out-of-scope statements remain; active-contract documents do not
promise missing browser UI, free UI Kit breakage or implemented host serialization.

- [ ] **Step 2: Run every package-level focused suite once more**

Run:

```bash
pnpm --filter @sovereign/protocol run test
pnpm --filter @sovereign/browser-sdk run test
pnpm --filter @sovereign/web run test
pnpm --filter @sovereign/daemon run test
```

Expected: all pass.

- [ ] **Step 3: Run repository-wide verification**

Run:

```bash
make check
make build
git diff --check
git status --short --branch
```

Expected: exit 0 and clean worktree.

- [ ] **Step 4: Execute the tracked live runbook**

На fresh `RUNBOOK_DATA` пройти browser-сценарий из Task 8. Проверить глазами и DOM:

1. owner board;
2. rival replacement and action;
3. contribution toggles without reload;
4. CSS revision changes with exactly one `link[data-sovereign-plugin]`;
5. project copy does not take a window-wide core place;
6. equal-rank dispute returns core built-in and emits one diagnostic;
7. throwing component leaves its sibling alive;
8. browserless component shows the missing browser bundle reason.

Записать точные revisions и диагностические строки в отчёт сессии; не добавлять случайные значения в
нормативную документацию.

- [ ] **Step 5: Create the pre-rewrite backup ref**

Run:

```bash
git update-ref refs/backup/slice-12b2-before-history-rewrite HEAD
git show-ref refs/backup/slice-12b2-before-review-fixes refs/backup/slice-12b2-before-history-rewrite
```

Expected: старая ссылка остаётся на `227a1b3`, новая — на полностью проверенный HEAD с design,
plan and implementation.

---

### Task 10: Пересобрать локальную историю и проверить каждый коммит

**Files:**

- Rewrite local commits after `9f47f90` only.
- Preserve final tree byte-for-byte relative to
  `refs/backup/slice-12b2-before-history-rewrite`.

**Interfaces:**

- Consumes: unpublished local branch and both backup refs.
- Produces: atomic green commits with code and caused documentation together.

- [ ] **Step 1: Confirm destructive scope before rebase**

Run:

```bash
git status --short --branch
git log --oneline --reverse 9f47f90..HEAD
git show-ref refs/backup/slice-12b2-before-history-rewrite
```

Expected: worktree clean, current branch `fix/slice-12b2-browser-sdk-review`, backup ref present. Do
not continue if any commit has been pushed or the worktree is dirty.

- [ ] **Step 2: Rebase the unpublished range and distribute documentation**

Run:

```bash
git rebase -i --rebase-merges 9f47f90
```

Use `edit`, `fixup` and commit splitting so `227a1b3 docs: record the extension model of slice 12b-2`
disappears as a warehouse commit. Target logical history, preserving design/plan as documentation
artifacts:

```text
docs: design the browser SDK review fixes
docs: plan the browser SDK review fixes
feat(protocol): declare places and component contributions
feat(web): load plugin browser bundles safely
feat(browser-sdk): publish the browser place contract
feat(browser-sdk): render plugin-owned places
feat(web): make base delivery views replaceable
feat(web): publish sidebar and header places
fix(web): keep the new-session project context
feat(web): explain plugin place claims accurately
fix(web): hand diagnostics subscribers recorded entries
test(daemon): seed reproducible browser plugin fixtures
```

Design and plan stay before implementation. Every code commit must compile and carry its own
thematic documentation.

- [ ] **Step 3: Compare the rewritten tree with the verified backup**

Run:

```bash
git diff --exit-code refs/backup/slice-12b2-before-history-rewrite HEAD
git diff --check 9f47f90..HEAD
```

Expected: no tree difference and no whitespace errors.

- [ ] **Step 4: Verify every rewritten commit**

Use the current clean worktree and restore the branch through a trap:

```bash
VERIFY_BRANCH="fix/slice-12b2-browser-sdk-review"
trap 'git switch "$VERIFY_BRANCH"' EXIT
while IFS= read -r VERIFY_COMMIT; do
  git switch --detach "$VERIFY_COMMIT"
  make check
done < <(git rev-list --reverse 9f47f90..HEAD)
git switch "$VERIFY_BRANCH"
trap - EXIT
```

Expected: `make check` exits 0 at every commit, not only at HEAD. If a commit fails, return to the
branch, amend/split the responsible commit and restart the loop from the first rewritten commit.

- [ ] **Step 5: Run final build and live smoke after rewrite**

Run:

```bash
make check
make build
git diff --check 9f47f90..HEAD
git status --short --branch
git log --oneline --reverse 9f47f90..HEAD
```

Repeat the tracked seed smoke at least through owner board, rival replacement, one CSS reload and
browserless diagnostic. Expected: clean branch and the same behavior as the pre-rewrite run.

- [ ] **Step 6: Keep the safety refs and stop**

Do not delete either backup ref in this task. Report their targets, the final commit list and all
verification commands. Do not push and do not open a PR.
