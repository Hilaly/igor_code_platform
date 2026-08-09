# Срез 12c-2: страницы плагина Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Плагин занимает целую страницу на `/p/<pluginId>/<pageId>/*` и строит внутри неё свою
навигацию с относительным путём и параметрами. Проектные решения и их обоснование —
[спека среза](../specs/2026-08-09-slice-12c2-plugin-pages-design.md).

**Architecture:** Новый вид вклада `page` с браузерным обработчиком по имени экспорта; разрешение
страницы теми же правилами контекста и ранга, что у команд. Маршрутизатор `apps/web` переезжает с пути
на полный адрес (`Location = { page, query }`), чем и снимается предпосылка, названная роадмапом.
Браузерный SDK получает хук `usePageNavigation`, а хостовая сторона — `HostPluginPage`, грузящую
бандл тем же кешем модулей по ревизии.

**Tech Stack:** TypeScript 5.9, React 19, Node 24, Vitest 3 + jsdom (браузерные пакеты), `node --test`
(демон и протокол), esbuild, pnpm workspaces.

## Global Constraints

- Новых runtime-зависимостей не добавлять: своим роутером вопрос библиотеки закрыт решением владельца.
- TDD: каждый шаг начинается с настоящего красного теста. Страж `everyKind` ломает сборку сам — это и
  есть красный для нового вида вклада.
- Перед **каждым** коммитом — `make check` (typecheck, lint, формат, тесты).
- Документация правится тем же коммитом, что и код, который делает её правдой.
- Публичные имена не переименовывать и не сужать: `Page`, `matchPage`, `pathOf`, `Navigation.navigate`
  (принимает `Location | Page`), `PlaceProps`, `hostModuleSpecifiers`.
- Тридцать существующих вызовов `navigation.navigate` в `App.tsx` остаются без правки — это признак
  того, что параметры не протекли в маршруты ядра.
- Документация на русском; код, идентификаторы и сообщения коммитов — на английском.

---

### Task 1: Протокол — вид вклада «страница»

**Files:**

- Modify: `packages/protocol/src/contribution.ts`
- Modify: `packages/protocol/src/places.ts`
- Modify: `packages/protocol/src/places.test.ts`
- Modify: `packages/protocol/src/contribution.test.ts`

**Interfaces:**

- `PageContributionRegistration = RegistrationCommon & { kind: "page"; title: string; export: string }`
- `resolvePluginPage(pluginId, pageId, contributions, context): PageContributionRegistration | undefined`

- [ ] **Step 1: Красный тест на разрешение страницы**

```ts
test("a page is addressed by its declared id and the plugin id", () => {
  const page = resolvePluginPage("placed", "log", [pageRegistration], {});
  assert.equal(page?.id, "placed.log");
});
test("a page contributed from a project folder does not take the window address", () => {
  assert.equal(resolvePluginPage("placed", "log", [projectPage], {}), undefined);
});
```

- [ ] **Step 2: Добавить вид и разрешение**

`page: true` в `everyKind`; `registrationsForContext` обобщается до union со страницей — она разрешается
теми же правилами ранга и контекста, что команда.

- [ ] **Step 3: `make check`**, коммит `feat(protocol): register page contributions`

---

### Task 2: Протокол — публичные адреса ядра

**Files:**

- Create: `packages/protocol/src/navigation.ts`
- Create: `packages/protocol/src/navigation.test.ts`
- Modify: `packages/protocol/src/index.ts`
- Modify: `apps/web/src/router.ts` (импорт вместо своей копии `settingsSections`)

**Interfaces:** `settingsSections`, `SettingsSection`, `CoreDestination`.

- [ ] **Step 1: Красный тест** — список разделов совпадает с именами мест `core.settings.<section>`:
      второй копии перечня в дереве не остаётся, и это проверяется, а не обещается.
- [ ] **Step 2: Завести модуль и увести `settingsSections` из `apps/web`**, реэкспортировав его из
      роутера, чтобы существующие импорты не переписывались.
- [ ] **Step 3: `make check`**, коммит `feat(protocol): publish core navigation destinations`

---

### Task 3: SDK воркера — `contribute.page`

**Files:**

- Modify: `packages/sdk/src/host.ts`
- Modify: `packages/sdk/src/index.ts`
- Modify: `packages/sdk/src/index.test.ts`

- [ ] **Step 1: Красный тест** — `contribute.page` отдаёт хосту `{ kind: "page", id, title, export }`.
- [ ] **Step 2: Реализовать** рядом с `contribute.command`.
- [ ] **Step 3: `make check`**, коммит `feat(sdk): let plugins declare pages`

---

### Task 4: Демон — проверка вклада-страницы

**Files:**

- Modify: `apps/daemon/src/plugins/contribution-registry.ts`
- Modify: `apps/daemon/src/plugins/contribution-registry.test.ts`

- [ ] **Step 1: Красные тесты** — по одному на каждый отказ: нет браузерного входа, пустой `title`,
      пустой `export`. Плюс тест, что валидный вклад доезжает с `declaredId` и namespace-ным `id`.
- [ ] **Step 2: Ветка `page`** в `programmaticRegistration` по образцу `command`. Комментарий о том,
      почему отдельной проверки URL-безопасности идентификатора не нужно.
- [ ] **Step 3: `make check`**, коммит `feat(daemon): validate page contributions`

---

### Task 5: Роутер — полный адрес вместо пути

**Files:**

- Modify: `apps/web/src/router.ts`
- Modify: `apps/web/src/router.test.ts`
- Modify: `apps/web/src/router-navigation.test.ts`
- Modify: `apps/web/src/App.tsx` (`current()` возвращает `Location`; эффект зовёт `dispose`)

**Interfaces:**

```ts
export type Location = { page: Page; query: Readonly<Record<string, string>> };
export function matchLocation(url: string): Location;
export function urlOf(location: Location): string;
export type Navigation = {
  current: () => Location;
  navigate: (target: Location | Page) => void;
  subscribe: (listener: (location: Location) => void) => () => void;
  dispose: () => void;
};
```

- [ ] **Step 1: Красные тесты**

```ts
test("navigating with different parameters is not silent", ...);
test("canonicalising a legacy path keeps the query and the hash", ...);
test("dispose stops the popstate listener", ...);
```

- [ ] **Step 2: Реализовать** `Location`, сравнение по `pathname + search`, канонизацию с переносом
      `search` и `hash`, `dispose`.
- [ ] **Step 3: `make check`**, коммит `refactor(web): route by the full address`

---

### Task 6: Браузерный SDK — фасад навигации

**Files:**

- Create: `packages/browser-sdk/src/page.tsx`
- Create: `packages/browser-sdk/src/page.test.tsx`
- Modify: `packages/browser-sdk/src/index.tsx`
- Modify: `packages/browser-sdk/src/host.tsx`
- Modify: `packages/browser-sdk/src/runtime-context.tsx`

**Interfaces:** `PageNavigation`, `usePageNavigation`, host-внутренняя `HostPluginPage`.

- [ ] **Step 1: Красные тесты (jsdom)** — относительный путь и параметры доезжают до страницы; переход
      внутри поддерева; `..` выше базы упирается в базу; `navigateCore` зовёт хост; хук вне страницы
      бросает; смена ревизии пересоздаёт экземпляр.
- [ ] **Step 2: Реализовать** контекст страницы, хук и `HostPluginPage` с `InstanceBoundary` и
      `boundaryKey`, включающим ревизию.
- [ ] **Step 3: `make check`**, коммит `feat(browser-sdk): give plugin pages a navigation facade`

---

### Task 7: apps/web — открытая страница плагина

**Files:**

- Create: `apps/web/src/places/plugin-page-view.tsx`
- Create: `apps/web/src/places/plugin-page-view.test.tsx`
- Create: `apps/web/src/navigation/core-destination.ts`
- Modify: `apps/web/src/shell/page.tsx`, `apps/web/src/App.tsx`
- Modify: `packages/ui-kit/src/i18n/messages/{en,ru}.ts`

- [ ] **Step 1: Красные тесты** — пять состояний таблицы спеки: страница, выключено, собирается, нет
      такой страницы, сборка упала. Плюс заголовок шапки из снимка.
- [ ] **Step 2: Реализовать** вью, перевод `CoreDestination → Location`, подключение к `PageView` и
      `describePage`, строки кита (`plugins.kind.page` — то самое четвёртое место, которое проверяет
      `i18n.test.ts`).
- [ ] **Step 3: `make check`**, коммит `feat(web): open plugin pages on their own address`

---

### Task 8: apps/web — страницы во вью плагина

**Files:**

- Modify: `apps/web/src/plugins/plugin-detail-view.tsx`
- Modify: `apps/web/src/plugins/plugin-detail-view.test.tsx`

- [ ] **Step 1: Красный тест** — объявленная страница показана ссылкой на свой адрес; выключенный
      вклад показан выключенным, а не спрятан.
- [ ] **Step 2: Реализовать** список страниц и строку вида `page` в технических данных.
- [ ] **Step 3: `make check`**, коммит `feat(web): list plugin pages in the plugin view`

---

### Task 9: Фикстура `placed` получает страницу

**Files:**

- Modify: `apps/daemon/src/plugins/fixtures/placed/src/worker.ts`
- Modify: `apps/daemon/src/plugins/fixtures/placed/src/browser.tsx`
- Modify: `apps/daemon/src/plugins/runbook-fixtures.ts` при необходимости (перечень выключенных вкладов)

- [ ] **Step 1: Красный тест** — снимок фикстуры содержит вклад-страницу.
- [ ] **Step 2: `LogPage`** на `usePageNavigation`: список на корне, вложенный `/entry/<n>`, фильтр в
      параметрах через `replace`, кнопка выхода через `navigateCore`.
- [ ] **Step 3: `make check`**, коммит `test(daemon): give the placed fixture a page`

---

### Task 10: Живая проверка и документы

**Files:** `docs/runbook.md`, `docs/ui-extension-model.md`, `docs/plugins.md`,
`docs/public-contract.md`, `docs/ui-kit.md`, `docs/backlog.md`, `docs/roadmap.md`, `docs/README.md`

- [ ] **Step 1: Живой прогон** по девяти наблюдаемым фактам спеки на собранном демоне из чистой
      временной директории данных.
- [ ] **Step 2: Записать** главу «Страницы плагина живьём» и привести документы в соответствие коду:
      снять пункт бэклога о страницах, закрыть вопрос библиотеки, завести пункт о повторяющихся
      ключах query, отметить срез в роадмапе.
- [ ] **Step 3: `make check`**, коммит `docs: record slice 12c-2 in the model and the runbook`

---

### Task 11: Сверка ветки

- [ ] **Step 1:** `git diff --check`, `make check`, `make build`.
- [ ] **Step 2:** повторный живой прогон на собранном артефакте.
- [ ] **Step 3:** отчёт владельцу. `push` и создание PR — только по явной просьбе.
