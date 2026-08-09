# Срез 12c-1: вкладки правой панели и команды Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Плагин приносит вкладку в правую панель оболочки и команду, вызываемую кнопкой, палитрой и
чужим плагином. Проектные решения и их обоснование —
[спека среза](../specs/2026-08-09-slice-12c1-tabs-and-commands-design.md).

**Architecture:** Четвёртая кардинальность места `tabs`; место базовой поставки `core.panel.tabs`;
новый вид вклада `command` с браузерным обработчиком по имени экспорта. Оболочка получает вкладки
хуком `useHostPlaceTabs` в опубликованный проп `tabs` и монтирует палитру команд, складывающую команды
ядра (данные `apps/web`) и команды плагинов (вклады из снимка) одним списком.

**Tech Stack:** TypeScript 5.9, React 19, Node 24, Vitest 3 + jsdom (браузерные пакеты), `node --test`
(демон и протокол), esbuild, pnpm workspaces.

## Global Constraints

- Новых runtime-зависимостей не добавлять; `@sovereign/browser-sdk` получает workspace-зависимость на
  `@sovereign/ui-kit` — единственное изменение графа.
- TDD: каждый шаг начинается с настоящего красного теста. Страж `everyKind` ломает сборку сам — это и
  есть красный для нового вида вклада.
- Перед **каждым** коммитом — `make check` (typecheck, lint, формат, тесты).
- Документация правится тем же коммитом, что и код, который делает её правдой.
- Публичные имена не переименовывать и не сужать: `ShellTabDescription`, проп `tabs`,
  `placeCardinalities`, `hostModuleSpecifiers`.
- Документация на русском; код, идентификаторы и сообщения коммитов — на английском.

---

### Task 1: Протокол — кардинальность `tabs` и место `core.panel.tabs`

**Files:**

- Modify: `packages/protocol/src/contribution.ts`
- Modify: `packages/protocol/src/places.ts`
- Modify: `packages/protocol/src/places.test.ts`
- Modify: `docs/ui-extension-model.md`

**Interfaces:**

- `placeCardinalities` = `["single", "collection", "action", "tabs"]`.
- `corePlaces` += `{ id: "core.panel.tabs", cardinality: "tabs", replaceable: false }`.

- [ ] **Step 1: Красный тест на место и кардинальность**

```ts
test("the shell publishes a tabs place for the right panel", () => {
  const place = corePlace("core.panel.tabs");
  assert.deepEqual(place, { id: "core.panel.tabs", cardinality: "tabs", replaceable: false });
  assert.ok(isPlaceCardinality("tabs"));
});
```

- [ ] **Step 2: Добавить значение и место**

Переписать комментарий у `placeCardinalities` («Вкладок здесь пока нет…» — уже неправда) и объяснить,
почему коллекции не хватило: у коллекции рисуются все экземпляры, у вкладок — один, остальные существуют
подписями.

- [ ] **Step 3: Зелёный + `make check`**, коммит `feat(protocol): add the tabs cardinality and core.panel.tabs`.

---

### Task 2: Протокол — регистрация команды и общий порядок размещённых вкладов

**Files:**

- Modify: `packages/protocol/src/contribution.ts`
- Modify: `packages/protocol/src/places.ts`
- Modify: `packages/protocol/src/index.ts`
- Modify: `packages/protocol/src/places.test.ts`

**Interfaces:**

- `CommandContributionRegistration = RegistrationCommon & { kind: "command"; title: string; export: string; placeId?: string; group?: string; order?: number }`.
- `PlacedContributionRegistration = ComponentContributionRegistration | CommandContributionRegistration`.
- `contributionsForPlace(placeId, contributions, context): PlacedContributionRegistration[]`.
- `orderPlaceContributions` возвращает `PlacedContributionRegistration[]`.

- [ ] **Step 1: Красный — страж `everyKind` ломает сборку**

Добавление `"command"` в `ContributionRegistration` без записи в `everyKind` роняет typecheck у всех
потребителей разом. Это запланированный красный: дописать `command: true` следующим шагом.

- [ ] **Step 2: Красный тест на смешанный порядок**

```ts
test("commands and components share one deterministic order in an action place", () => {
  const ordered = orderPlaceContributions("core.view.header.actions", registrations, {});
  assert.deepEqual(
    ordered.map((registration) => registration.id),
    ["placed.action", "placed.run", "placed.zeta"],
  );
});
```

Плюс тест: команда из папки чужого проекта отсеивается `contributionsForPlace`; команда, спорящая с
командой равного ранга за один идентификатор, снимает обе.

- [ ] **Step 3: Реализовать**

`componentsForPlace` оставить как есть — её потребитель `resolvePlaceProvider`, и команда не вправе
занять одиночное место. `registrationsForContext` и `registrationRank` расширить до общего типа.

- [ ] **Step 4: `make check`**, коммит `feat(protocol): register command contributions`.

---

### Task 3: SDK воркера — `contribute.command`

**Files:**

- Modify: `packages/sdk/src/host.ts`
- Modify: `packages/sdk/src/index.ts`
- Modify: `packages/sdk/src/sdk.test.ts`
- Modify: `docs/plugins.md`

**Interfaces:**

- `CommandContribution` (см. спеку), ветка `PluginContribution`, `contribute.command(contribution)`.
- Копия `placeCardinalities` в `packages/sdk/src/host.ts` получает `"tabs"`.

- [ ] **Step 1: Красный тест** — `contribute.command` доносит объявление до хоста без изменения формы;
      тест на совпадение двух копий `placeCardinalities`.
- [ ] **Step 2: Реализовать, `make check`**, коммит `feat(sdk): let plugins contribute commands`.

---

### Task 4: Демон — приём и отказы команды

**Files:**

- Modify: `apps/daemon/src/plugins/contribution-registry.ts`
- Modify: `apps/daemon/src/plugins/contribution-registry.test.ts`

**Interfaces:**

- Ветка `kind === "command"`: требует объявленной браузерной точки входа, непустых `title` и `export`;
  `placeId` — если задан — по `placeIdPattern`; `group` строка; `order` конечное число. Существование
  места **не** проверяется: вклад ждёт.

- [ ] **Step 1: Красные тесты на отказы** — без `title`, без `export`, у плагина без `sovereign.browser`,
      с `placeId` не по шаблону. Каждый отказ несёт внятную причину.
- [ ] **Step 2: Красные тесты на приём** — команда с несуществующим `placeId` регистрируется и ждёт;
      объявление места с `cardinality: "tabs"` принимается, а с `replaceable: true` — отвергается
      существующей проверкой (тест фиксирует, что новая кардинальность её не обошла).
- [ ] **Step 3: Реализовать, `make check`**, коммит `feat(daemon): validate command contributions`.

---

### Task 5: browser-sdk — вкладки

**Files:**

- Create: `packages/browser-sdk/src/tabs.tsx`
- Create: `packages/browser-sdk/src/tabs.test.tsx`
- Modify: `packages/browser-sdk/src/host.tsx`
- Modify: `packages/browser-sdk/src/index.tsx`

**Interfaces:**

- `export type HostPlaceTab = { id: string; label: string; content: ReactNode }`.
- `export function useHostPlaceTabs(props: PlaceProps): HostPlaceTab[]` — host-entrypoint.
- `export function PlaceTabs(props: PlaceProps): ReactNode` — сторона плагина, открытая вкладка в
  `useState`.

- [ ] **Step 1: Красные тесты**

```tsx
it("labels a tab from the snapshot without loading the bundle", () => {
  const { result } = renderHook(() => useHostPlaceTabs({ id: "core.panel.tabs", context: {} }), {
    wrapper,
  });
  expect(result.current.map((tab) => ({ id: tab.id, label: tab.label }))).toEqual([
    { id: "placed.board", label: "Board" },
  ]);
  expect(cache.loaded).toEqual([]);
});
```

Плюс: подпись падает на `declaredId`, когда `title` нет; порядок — по `group` → `order` → `id`; упавшая
вкладка не роняет соседей и жалуется в диагностику; `PlaceTabs` на месте другой кардинальности рисует
пусто; `PluginPlaceCollection` по-прежнему отвергает `tabs`.

- [ ] **Step 2: Реализовать.** `content` — созданный, но не смонтированный `PlaceInstance`.
- [ ] **Step 3: `make check`**, коммит `feat(browser-sdk): expose place tabs`.

---

### Task 6: browser-sdk — вызов команды

**Files:**

- Create: `packages/browser-sdk/src/commands.tsx`
- Create: `packages/browser-sdk/src/commands.test.tsx`
- Modify: `packages/browser-sdk/src/index.tsx`

**Interfaces:**

- `Command`, `CommandOutcome`, `useCommands(): { invoke(commandId, context?): Promise<CommandOutcome> }`.

- [ ] **Step 1: Красные тесты**

- `invoke` грузит бандл и зовёт `run` с переданным контекстом → `{ kind: "done" }`;
- `available → false` даёт `unavailable`, и `run` не зовётся;
- отсутствующий экспорт, провал загрузки и брошенное из `run` исключение дают `failed` с причиной и
  ровно одну запись в диагностике;
- неизвестный идентификатор → `unknown`;
- команда чужого проекта не видна в контексте другого проекта → `unknown`;
- **вызов, осиротевший размонтированием провайдера посреди загрузки, завершается `failed`, а не висит.**

- [ ] **Step 2: Реализовать.** `invoke` не бросает никогда.
- [ ] **Step 3: `make check`**, коммит `feat(browser-sdk): invoke plugin commands`.

---

### Task 7: browser-sdk — кнопка команды в месте «действие»

**Files:**

- Modify: `packages/browser-sdk/src/host.tsx`
- Modify: `packages/browser-sdk/src/commands.tsx`
- Modify: `packages/browser-sdk/package.json`
- Modify: `packages/browser-sdk/src/host.test.tsx`

**Interfaces:**

- `CommandButton` — внутренний; `CollectionPlace` разбирает `component` и `command`.
- `package.json` += workspace-зависимость `@sovereign/ui-kit`.

- [ ] **Step 1: Красные тесты** — кнопка нарисована по `title` до загрузки бандла; щелчок вызывает
      команду; после загрузки `available → false` выключает кнопку; кнопка команды и компонент стоят в
      одной полосе в общем порядке.
- [ ] **Step 2: Реализовать, `make check`**, коммит `feat(browser-sdk): render command buttons in action places`.

---

### Task 8: Оболочка — вкладки и ARIA полосы

**Files:**

- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/shell/shell.tsx`
- Modify: `apps/web/src/shell/shell.test.tsx`
- Modify: `apps/web/src/places/place-host.tsx`

**Interfaces:**

- `App.tsx:623` `tabs={[]}` → `tabs={useHostPlaceTabs({ id: "core.panel.tabs", context: pageContext })}`.
- Полоса вкладок перестаёт объявлять `role="tablist"`.

- [ ] **Step 1: Красные тесты**

- вклад-вкладка появляется в правой панели, открывается щелчком, повторный щелчок закрывает;
- `openTab`, указывающий на исчезнувший вклад, показывает заглушку и **не стирается** из раскладки —
  вернувшийся вклад открывает свою вкладку снова;
- полоса не объявляет себя `tablist` (`queryByRole("tablist")` → `null`), кнопки остаются переключателями.

- [ ] **Step 2: Реализовать.** Контекст — `pageContext`, без `project`.
- [ ] **Step 3: `make check`**, два коммита: `fix(web): stop announcing the tab strip as a tablist` и
      `feat(web): fill the right panel from core.panel.tabs`.

---

### Task 9: Команды ядра

**Files:**

- Create: `apps/web/src/commands/core-commands.ts`
- Create: `apps/web/src/commands/core-commands.test.ts`
- Modify: `packages/ui-kit/src/i18n/messages/en.ts`, `ru.ts`

**Interfaces:**

- `CoreCommand`, `CoreCommandHost`, `coreCommands: readonly CoreCommand[]`.

- [ ] **Step 1: Красные тесты** — у каждой команды есть строка в обоих каталогах; идентификаторы
      уникальны и начинаются с `core.`; `run` зовёт `navigate` или `onLayoutChange` и ничего больше;
      `available` у «скрыть правую панель» ложно, когда панель уже скрыта.
- [ ] **Step 2: Реализовать, `make check`**, коммит `feat(web): declare core commands`.

---

### Task 10: Палитра команд

**Files:**

- Create: `apps/web/src/commands/command-palette.tsx`
- Create: `apps/web/src/commands/command-palette.module.css`
- Create: `apps/web/src/commands/command-palette.test.tsx`
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/shell/shell.tsx`
- Modify: `packages/ui-kit/src/i18n/messages/en.ts`, `ru.ts`

**Interfaces:**

- Композиция из `Dialog`, `Input`, `ListRow`. Проп `onOpenCommandPalette` у `Shell` рисует кнопку.

- [ ] **Step 1: Красные тесты** — открытие кнопкой и аккордом Cmd/Ctrl+K (с `preventDefault`);
      подстрочный фильтр по заголовку; `Enter` вызывает выделенную; `Escape` закрывает; **без единого
      плагина список непуст**; команда плагина и команда ядра стоят одним списком; недоступная команда
      выключена.
- [ ] **Step 2: Реализовать, `make check`**, коммит `feat(web): add the command palette`.

---

### Task 11: Вью плагина

**Files:**

- Modify: `apps/web/src/plugins/plugin-detail-view.tsx`
- Modify: `apps/web/src/plugins/plugin-detail-view.test.tsx`
- Modify: `packages/ui-kit/src/i18n/messages/en.ts`, `ru.ts`

- [ ] **Step 1: Красные тесты** — команда показана видом и техническими данными; её размещение попадает
      в раздел мест исходом `added`; `plugins.kind.command` есть в обоих каталогах (существующий
      `i18n.test.ts` краснеет сам).
- [ ] **Step 2: Реализовать, `make check`**, коммит `feat(web): show command contributions in the plugin view`.

---

### Task 12: Фикстура, живая проверка, документы

**Files:**

- Modify: `apps/daemon/src/plugins/fixtures/placed/src/worker.ts`, `src/browser.tsx`
- Modify: `docs/runbook.md`, `docs/runtime-checks.md`, `docs/ui-extension-model.md`, `docs/ui-kit.md`,
  `docs/plugins.md`, `docs/public-contract.md`, `docs/backlog.md`, `docs/roadmap.md`, `docs/README.md`

- [ ] **Step 1: Фикстура** — `placed` получает вкладку в `core.panel.tabs` и команду с
      `placeId: "core.view.header.actions"`, плюс экспорты `BoardTab` и `RunCommand` в `browser.tsx`.
- [ ] **Step 2: Живая проверка** на собранном демоне из чистой временной директории данных по сценарию
      из спеки. Результат записать разделом «Вкладки и команды плагина живьём» в `docs/runbook.md`.
- [ ] **Step 3: Замер** — стоимость открытия палитры и отсутствие загрузки бандлов при этом —
      проверкой 37 в `docs/runtime-checks.md`.
- [ ] **Step 4: Документы.** Отдельно: снять из `docs/roadmap.md` устаревшее «в 12c набор кита
      объявляется стабильным» — он объявлен стабильным срезом 12b-2; исправить формулировку пункта
      бэклога про состояние экземпляра; вписать уехавшее (горячие клавиши, воркерный обработчик, вызов
      команды из воркера, несколько размещений, локализация заголовков, палитра как место).
- [ ] **Step 5: `make check`, `make build`**, коммиты по темам.

---

### Task 13: Сверка ветки и переписывание локальной истории

- [ ] **Step 1:** поставить `refs/backup/slice-12c1-before-history-rewrite`.
- [ ] **Step 2:** привести историю к атомарным коммитам; после — сверить дерево с бэкапом побайтово
      (`git diff --stat refs/backup/… HEAD` пусто) и прогнать `make check` на каждом коммите ветки.
- [ ] **Step 3:** `git diff --check`, повторный живой прогон. Backup-реф не удалять. `push` и PR — **не
      делать**: только по явной просьбе владельца продукта.
