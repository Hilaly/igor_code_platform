# Финальные исправления среза 12c-2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Закрыть четыре замечания финального ревью страниц плагина и повторно доказать готовность
ветки к merge и началу разработки продуктовых плагинов.

**Architecture:** Один нормализатор хвоста plugin-owned страницы применяется и внутри
`usePageNavigation`, и при переводе `CoreDestination` в адрес web-хоста. Навигационные типы принадлежат
публичному browser SDK, а состояние открытой страницы связывается с точным `pluginKey` победившей
регистрации. После кода весь `docs/` сверяется с фактическим состоянием платформы.

**Tech Stack:** TypeScript 5.9, React 19, Node 24, Vitest 3 + jsdom, `node --test`, pnpm workspaces.

## Global Constraints

- Работа идёт только в `.claude/worktrees/slice-12c2-plugin-pages` на
  `feat/slice-12c2-plugin-pages`; `main` не изменяется.
- Новых runtime-зависимостей нет.
- Каждый bugfix проходит RED → GREEN: тест сначала падает по причине дефекта, затем проходит.
- `navigate(path)` не покидает выбранную страницу; выход в ядро или другую страницу выражается
  только `navigateCore(destination)`.
- Публичный browser-плагин не импортирует `@sovereign/protocol` ради навигационных типов.
- Перед каждым коммитом выполняется `NODE_OPTIONS=--no-experimental-webstorage make check`.
- Документация на русском; код, идентификаторы и сообщения коммитов — на английском.
- Push, PR и переписывание существующей истории не выполняются.

---

### Task 1: Нормализация хвоста страницы

**Files:**

- Create: `packages/browser-sdk/src/page-path.ts`
- Create: `packages/browser-sdk/src/page-path.test.ts`
- Modify: `packages/browser-sdk/src/page.tsx`
- Modify: `packages/browser-sdk/src/host.tsx`
- Modify: `apps/web/src/navigation/core-destination.ts`
- Modify: `apps/web/src/navigation/core-destination.test.ts`

**Interfaces:**

- Produces: `normalizePagePath(path: string): string` — percent-кодированная строка с ведущим
  `/`; корень равен `/`; пустые сегменты и dot-сегменты удалены; `..` не поднимается выше корня.
- `@sovereign/browser-sdk/host` реэкспортирует нормализатор только для web-хоста.

- [ ] **Step 1: Написать красные тесты нормализатора**

```ts
it.each([
  ["/entry/../log", "/log"],
  ["/%2e%2e/%2e%2e/settings", "/settings"],
  ["/.%2e/%2E./settings", "/settings"],
  ["/%252e%252e/settings", "/%252e%252e/settings"],
])("normalizes %s to %s without leaving the page root", (path, expected) => {
  expect(normalizePagePath(path)).toBe(expected);
});
```

- [ ] **Step 2: Запустить browser SDK тест и увидеть ожидаемый RED**

Run: `pnpm --filter @sovereign/browser-sdk test -- src/page-path.test.ts`

Expected: FAIL, потому что `normalizePagePath` ещё не существует.

- [ ] **Step 3: Реализовать минимальный нормализатор и подключить его к `page.tsx`**

Сегмент считается `.` или `..`, если `decodeURIComponent(segment)` даёт ровно это значение;
невалидное percent-кодирование остаётся непрозрачным сегментом. Исходное написание обычного
сегмента сохраняется.

- [ ] **Step 4: Запустить browser SDK тесты и увидеть GREEN**

Run: `pnpm --filter @sovereign/browser-sdk test`

Expected: все тесты пакета проходят.

- [ ] **Step 5: Написать красный web-тест обхода через `plugin-page.path`**

```ts
it.each(["../../../settings/plugins", "/%2e%2e/%2e%2e/settings/plugins"])(
  "keeps another plugin page path inside its page for %s",
  (path) => {
    const url = urlOf(
      locationOfDestination({
        kind: "plugin-page",
        pluginId: "rival",
        pageId: "board",
        path,
      }),
    );
    expect(url).toBe("/p/rival/board/settings/plugins");
  },
);
```

- [ ] **Step 6: Запустить web-тест и увидеть ожидаемый RED**

Run: `pnpm --filter @sovereign/web test -- src/navigation/core-destination.test.ts`

Expected: FAIL с адресом вне `/p/rival/board` или с ненормализованным хвостом.

- [ ] **Step 7: Применить `normalizePagePath` при переводе `plugin-page` и увидеть GREEN**

Run: `pnpm --filter @sovereign/web test -- src/navigation/core-destination.test.ts`

Expected: все тесты файла проходят, query остаётся без изменений.

- [ ] **Step 8: Полная проверка и коммит**

Run: `NODE_OPTIONS=--no-experimental-webstorage make check`

Commit: `fix(navigation): keep page paths inside their subtree`

---

### Task 2: Публичные навигационные типы browser SDK

**Files:**

- Create: `packages/browser-sdk/src/navigation.ts`
- Create: `packages/browser-sdk/src/navigation.test.ts`
- Modify: `packages/browser-sdk/src/index.tsx`
- Modify: `packages/browser-sdk/src/host.tsx`
- Modify: `packages/browser-sdk/src/page.tsx`
- Modify: `packages/browser-sdk/src/browser-sdk.test.tsx`
- Delete: `packages/protocol/src/navigation.ts`
- Delete: `packages/protocol/src/navigation.test.ts`
- Modify: `packages/protocol/src/index.ts`
- Modify: `apps/web/src/router.ts`
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/navigation/core-destination.ts`
- Modify: `apps/web/src/places/plugin-page-view.tsx`

**Interfaces:**

- Produces from `@sovereign/browser-sdk`: `settingsSections`, `SettingsSection`, `CoreDestination`.
- Produces from `@sovereign/browser-sdk/host`: `isSettingsSection` for internal host parsing.
- Removes these names from `@sovereign/protocol`.

- [ ] **Step 1: Написать красную проверку публичного импорта**

В `browser-sdk.test.tsx` импортировать `settingsSections`, `CoreDestination` и `SettingsSection`
только из `./index.tsx`; проверить runtime-список и присваивание всех вариантов закрытого union.

- [ ] **Step 2: Запустить тест и увидеть ожидаемый RED**

Run: `pnpm --filter @sovereign/browser-sdk test -- src/browser-sdk.test.tsx`

Expected: FAIL typecheck/сборки теста, потому что корень SDK не экспортирует эти имена.

- [ ] **Step 3: Перенести объявления в browser SDK**

`navigation.ts` содержит тот же закрытый union и список из семи разделов. Корень экспортирует
публичные типы и `settingsSections`, а host-подпуть — `isSettingsSection`. `page.tsx` больше не
импортирует `CoreDestination` из протокола.

- [ ] **Step 4: Перевести web-хост на тип browser SDK и удалить модуль протокола**

Все потребители `CoreDestination` и парсер разделов используют browser SDK. Тест
`navigation.test.ts` проверяет, что `settingsSections` один к одному совпадает с
`core.settings.*` из внутреннего `corePlaces`.

- [ ] **Step 5: Запустить проверки пакетов и увидеть GREEN**

Run:
`pnpm --filter @sovereign/protocol typecheck && pnpm --filter @sovereign/browser-sdk test && pnpm --filter @sovereign/web typecheck`

Expected: команды завершаются с кодом 0; поиск production-импортов `CoreDestination` из протокола
не находит совпадений.

- [ ] **Step 6: Полная проверка и коммит**

Run: `NODE_OPTIONS=--no-experimental-webstorage make check`

Commit: `refactor(browser-sdk): own public navigation types`

---

### Task 3: Lifecycle-статус победившей страницы

**Files:**

- Modify: `apps/web/src/places/plugin-page.test.ts`
- Modify: `apps/web/src/places/plugin-page.ts`

**Interfaces:**

- Открытая страница получает `PluginStatus` только по `registration.pluginKey`.
- Состояния без активной регистрации продолжают искать оконный статус по `pluginId`.

- [ ] **Step 1: Написать красный тест перекрытия builtin → data**

```ts
it("uses the status of the registration that won source resolution", () => {
  const builtin = { ...placed, key: "builtin:placed", source: "builtin" as const };
  const dataPage = log;
  const builtinPage = { ...log, pluginKey: builtin.key, source: builtin.source };

  expect(
    resolvePluginPageState(
      snapshot({
        plugins: [builtin, placed],
        contributions: [builtinPage, dataPage],
      }),
      "placed",
      "log",
    ),
  ).toEqual({
    kind: "open",
    registration: dataPage,
    status: placed,
  });
});
```

- [ ] **Step 2: Запустить тест и увидеть ожидаемый RED**

Run: `pnpm --filter @sovereign/web test -- src/places/plugin-page.test.ts`

Expected: FAIL: возвращён статус `builtin:placed` при регистрации `data:placed`.

- [ ] **Step 3: Искать статус активной страницы по точному ключу**

После разрешения регистрации использовать `snapshot.plugins.find(({ key }) => key ===
registration.pluginKey)`. Существующий `windowWideStatus(pluginId)` вызывается только в ветках без
активной регистрации.

- [ ] **Step 4: Запустить тесты и увидеть GREEN**

Run: `pnpm --filter @sovereign/web test -- src/places/plugin-page.test.ts`

Expected: все тесты файла проходят.

- [ ] **Step 5: Полная проверка и коммит**

Run: `NODE_OPTIONS=--no-experimental-webstorage make check`

Commit: `fix(web): use the page owner's lifecycle status`

---

### Task 4: Полная сверка долговременной документации

**Files:**

- Modify: `docs/master-spec.md`
- Modify: `docs/ui-extension-model.md`
- Modify: `docs/public-contract.md`
- Modify: `docs/roadmap.md`
- Modify: остальные нормативные файлы `docs/*.md`, только если сверка находит фактическое
  противоречие коду или текущему статусу.
- Modify: `docs/README.md`, если меняется описание существующего документа.

**Interfaces:**

- Документы называют публичным источником навигации `@sovereign/browser-sdk`.
- `master-spec.md` отражает завершение 12c, стабильность UI kit после 12b-2 и единственный оставшийся
  платформенный срез 13.
- Контракт URL явно отличает типизированный выход от границы доверия.

- [ ] **Step 1: Сверить весь `docs/` с кодом и историей**

Проверить статусы срезов, число видов вкладов, стабильность API/UI kit, публичные пакеты и импорты,
маршруты страницы, lifecycle-состояния, оставшиеся пункты roadmap/backlog. Исторические планы не
переписывать как нормативные документы, но исправить ссылки на актуальный публичный импорт в
спецификации 12c-2.

- [ ] **Step 2: Исправить каждое найденное противоречие**

Не менять продуктовые решения и не закрывать бэклог без кода. В «Почему так» записать, что
поддерево — граница API владения адресом, а не security sandbox.

- [ ] **Step 3: Механическая проверка документации**

Run:
`rg -n 'CoreDestination.*@sovereign/protocol|страницы, вкладки, команды.*предстоит|примитивы.*не стабиль' docs`

Expected: в нормативной документации нет устаревших утверждений; историческое описание исходного
плана допускается только рядом с явным последующим уточнением.

- [ ] **Step 4: Полная проверка и коммит**

Run: `NODE_OPTIONS=--no-experimental-webstorage make check`

Commit: `docs: reconcile the platform after plugin pages`

---

### Task 5: Финальная проверка ветки

**Files:** none.

**Interfaces:** ветка готова к merge только при чистом worktree и зелёных полных проверках.

- [ ] **Step 1: Проверить дифф и историю**

Run: `git diff --check main...HEAD && git status --short && git log --oneline main..HEAD`

Expected: нет whitespace-ошибок и незакоммиченных файлов; новые коммиты атомарны.

- [ ] **Step 2: Запустить полные проверки**

Run: `NODE_OPTIONS=--no-experimental-webstorage make check`

Expected: typecheck, ESLint, Prettier и все тесты проходят.

- [ ] **Step 3: Собрать production-артефакты текущего toolchain**

Run: `NODE_OPTIONS=--no-experimental-webstorage make build`

Expected: сборка завершается с кодом 0; существующее предупреждение Vite о размере UI kit отдельно
сверяется с `main` и не приписывается ветке.

- [ ] **Step 4: Повторить живую проверку навигации**

На свободных портах и временной data directory открыть фикстуру `placed`: внутренний переход,
параметры, кнопка назад, `navigateCore` в настройки и возврат после выключения. Дополнительно
убедиться в консоли, что encoded dot-сегмент не выводит URL из `/p/placed/log`.

- [ ] **Step 5: Запросить финальное ревью всей ветки**

Reviewer сравнивает `main...HEAD` с утверждённой спецификацией, продуктовой моделью и критериями
готовности к merge; Critical и Important замечания закрываются до итогового отчёта.

---

### Task 6: Закрыть оставшиеся обходы владения URL

**Files:**

- Modify: `packages/browser-sdk/src/page-path.ts`
- Modify: `packages/browser-sdk/src/page-path.test.ts`
- Modify: `packages/browser-sdk/src/page.test.tsx`
- Modify: `apps/web/src/router.ts`
- Modify: `apps/web/src/router.test.ts`
- Modify: `apps/web/src/navigation/core-destination.test.ts`
- Modify: `docs/ui-extension-model.md`
- Modify: `docs/public-contract.md`
- Modify: `docs/superpowers/specs/2026-08-09-slice-12c2-plugin-pages-design.md`

**Interfaces:**

- Raw `\\` behaves as a URL path separator before dot-segment folding; encoded `%5C` remains data.
- `pathOf({ kind: "plugin" })` encodes `pluginId` and `pageId` with the router's existing opaque
  segment codec; `matchPage` decodes both with the inverse codec.
- Valid registered identifiers keep their existing URL spelling.

- [ ] **Step 1: Write RED tests for raw backslash escapes**

Cover literal and mixed encoded-dot/backslash inputs in `normalizePagePath`, the page-local
`navigate` facade, and `locationOfDestination({ kind: "plugin-page" })`. Assert that encoded `%5C`
is not treated as a separator.

- [ ] **Step 2: Run focused tests and observe the expected RED**

Run:
`pnpm --filter @sovereign/browser-sdk exec vitest run src/page-path.test.ts src/page.test.tsx && pnpm --filter @sovereign/web exec vitest run src/navigation/core-destination.test.ts`

Expected: raw-backslash cases escape or remain unnormalised before production changes.

- [ ] **Step 3: Fold raw backslashes before page-path normalisation**

Split on both `/` and raw `\\`, while leaving percent-encoded backslashes inside their segment.

- [ ] **Step 4: Write RED router tests for hostile destination identifiers**

Exercise `.`, `..`, encoded-dot-looking text, `/`, and raw `\\` in `pluginId/pageId`. Assert that
`urlOf(locationOfDestination(destination))` stays below `/p/` and round-trips through
`matchLocation` without opening a core route.

- [ ] **Step 5: Run router tests and observe the expected RED**

Run: `pnpm --filter @sovereign/web exec vitest run src/router.test.ts src/navigation/core-destination.test.ts`

Expected: at least the `..` or separator case changes route structure before opaque encoding.

- [ ] **Step 6: Reuse the router opaque-segment codec for plugin page identifiers**

Do not publish a second grammar or duplicate daemon regexes. Existing valid IDs remain unchanged;
invalid author input becomes a safely encoded, unresolved page address.

- [ ] **Step 7: Update the three normative explanations**

State that raw backslash follows browser URL separator semantics, encoded backslash is data, and
plugin/page identifiers are opaque URL segments. Keep the boundary explicitly an API ownership
contract, not a security sandbox.

- [ ] **Step 8: Focused GREEN, full check, and commit**

Run the focused commands above, then
`NODE_OPTIONS=--no-experimental-webstorage make check`.

Commit: `fix(navigation): close remaining page URL escapes`

---

### Task 7: Повторить финальный merge gate

- [ ] **Step 1:** `git diff --check main...HEAD` and clean `git status --short`.
- [ ] **Step 2:** fresh `NODE_OPTIONS=--no-experimental-webstorage make check`.
- [ ] **Step 3:** fresh `NODE_OPTIONS=--no-experimental-webstorage make build`.
- [ ] **Step 4:** scoped review of Task 6 and broad read-only review of `main...HEAD` with no open
      Critical or Important findings.
- [ ] **Step 5:** record whether browser UI repetition remains externally blocked; do not turn the
      unavailable browser backend into a code defect or a false passed claim.
