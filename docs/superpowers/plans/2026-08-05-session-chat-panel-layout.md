# Session Chat Panel Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Построить контейнерно-независимую панель агентской сессии с системным заголовком, единственной прокручиваемой лентой, постоянной нижней зоной и переопределениями модели и reasoning для следующего обычного турна.

**Architecture:** `ChatView` становится Grid-контейнером `auto / minmax(0, 1fr) / auto`; нейтральный `ViewHeader` живёт в UI-ките, а предметные действия и состояние остаются в `apps/web`. Контроллер сессий передаёт существующий `TurnRequest` и возвращает отказ вызывающему; модельные каталоги загружаются лениво, а состояние конкретного композера изолировано внутри экземпляра `ChatView`.

**Tech Stack:** TypeScript 5, React 19, CSS Modules в UI-ките, CSS приложения, Vitest, Testing Library, pnpm workspaces.

## Global Constraints

- Не добавлять новый HTTP-маршрут: демон и `@sovereign/protocol` уже принимают `TurnRequest { text, model?, thinkingLevel? }`.
- Не использовать `position: sticky`, абсолютное закрепление, viewport-высоты или вычисление высоты панелей в JavaScript.
- Только средняя область панели прокручивается; header и нижняя рабочая зона остаются в потоке Grid.
- Выбор модели и reasoning доступен во время занятого турна, но применяется только к следующему обычному турну.
- `steer`, `follow-up`, `next-turn` и `append` продолжают отправлять только `SessionMessage`.
- Состояние черновика, модели и reasoning принадлежит экземпляру `ChatView`; будущие панели не разделяют его.
- Каталоги моделей загружаются по одному провайдеру; все модели всех провайдеров заранее не запрашиваются.
- В этом плане на `ViewHeader` переезжает только чат; массовая миграция остальных вью остаётся отдельной задачей.
- Документация пишется по-русски, код и идентификаторы — по-английски, каждый срез завершается атомарным Conventional Commit.

---

## Карта файлов и ответственности

- `packages/ui-kit/src/components/view-header.tsx` и `.module.css` — системный контейнерный заголовок с действиями.
- `packages/ui-kit/src/components/rendering.test.tsx`, `primitives.stories.tsx`, `index.ts` — контракт, каталог и публичный экспорт `ViewHeader`.
- `apps/web/src/sessions/use-sessions.ts` — асинхронная отправка полного `TurnRequest` и подготовка провайдеров для композера.
- `apps/web/src/sessions/model-options.ts` — единственная сборка ленивых групп `ModelPicker` и поиск выбранной модели; используется формой создания и чатом.
- `apps/web/src/sessions/message-composer.tsx` — контролы следующей модели/reasoning и очистка текста только после принятой операции.
- `apps/web/src/sessions/session-usage.tsx` — раздельные метрики и семантический тон длинной шкалы.
- `apps/web/src/sessions/chat-view.tsx` — координация трёх Grid-областей и локального состояния конкретной панели.
- `apps/web/src/sessions/session-message-list.tsx` и UI-kit `MessageFeed` — единственный scroll-root средней области с предметными слотами до и после записей.
- `apps/web/src/sessions/sessions.css` и `apps/web/src/shell/shell.css` — цепочка доступной высоты и единственный scroll-контейнер.
- `apps/web/src/App.tsx` — передача провайдеров, каталогов и новых callbacks в открытую панель.
- `packages/ui-kit/src/i18n/messages/{en,ru}.ts` — новые подписи метрик и контролов.
- `docs/ui-kit.md`, `docs/sessions-and-projects.md`, `docs/backlog.md` — публичный примитив, поведение панели и отложенная миграция остальных заголовков.

---

### Task 1: Системный контейнерный `ViewHeader`

**Files:**

- Create: `packages/ui-kit/src/components/view-header.tsx`
- Create: `packages/ui-kit/src/components/view-header.module.css`
- Modify: `packages/ui-kit/src/index.ts`
- Modify: `packages/ui-kit/src/components/rendering.test.tsx`
- Modify: `packages/ui-kit/src/components/primitives.stories.tsx`
- Modify: `docs/ui-kit.md`

**Interfaces:**

- Consumes: существующий `Heading` и шкалы/роли UI-кита.
- Produces:

```ts
export type ViewHeaderProps = {
  title: ReactNode;
  level?: 1 | 2 | 3;
  actions?: ReactNode;
};

export function ViewHeader(props: ViewHeaderProps): React.JSX.Element;
```

- [ ] **Step 1: Написать падающий тест семантики**

В `rendering.test.tsx` импортировать `ViewHeader` и добавить:

```tsx
it("renders a container header with a heading and optional actions", () => {
  const markup = renderToStaticMarkup(
    <ViewHeader title="Новая сессия" level={2} actions={<button>Дерево</button>} />,
  );

  expect(markup).toContain("<header");
  expect(markup).toContain("<h2");
  expect(markup).toContain("Новая сессия");
  expect(markup).toContain("Дерево");
});
```

- [ ] **Step 2: Запустить тест и увидеть ожидаемый отказ**

Run: `pnpm --filter @sovereign/ui-kit test -- src/components/rendering.test.tsx`

Expected: FAIL — `ViewHeader` ещё не экспортирован.

- [ ] **Step 3: Реализовать минимальный публичный примитив**

Создать компонент:

```tsx
import type { ReactNode } from "react";

import styles from "./view-header.module.css";
import { Heading } from "./text.tsx";

export type ViewHeaderProps = {
  title: ReactNode;
  level?: 1 | 2 | 3;
  actions?: ReactNode;
};

export function ViewHeader({ title, level = 1, actions }: ViewHeaderProps) {
  return (
    <header className={styles.header}>
      <div className={styles.title}>
        <Heading level={level}>{title}</Heading>
      </div>
      {actions === undefined ? undefined : <div className={styles.actions}>{actions}</div>}
    </header>
  );
}
```

CSS должен использовать `display: flex`, `flex-wrap: wrap`, `min-width: 0`, шкалы отступов и
`border-block-end` через `--sovereign-border-subtle`. Экспортировать модуль из `index.ts`.

- [ ] **Step 4: Добавить два состояния в каталог**

В `primitives.stories.tsx` показать широкий header с тремя действиями и тот же header внутри
контейнера `maxWidth: "22rem"`; не добавлять предметные классы или строки в production-компонент.

- [ ] **Step 5: Проверить UI-кит и документацию**

Run: `pnpm --filter @sovereign/ui-kit test -- src/components/rendering.test.tsx`

Expected: PASS.

Run: `pnpm --filter @sovereign/ui-kit typecheck`

Expected: PASS.

В `docs/ui-kit.md` добавить `ViewHeader` в набор композиционных примитивов и записать, что он
контейнерный, а не page-only.

- [ ] **Step 6: Закоммитить срез**

```bash
git add packages/ui-kit/src/components/view-header.tsx packages/ui-kit/src/components/view-header.module.css packages/ui-kit/src/components/rendering.test.tsx packages/ui-kit/src/components/primitives.stories.tsx packages/ui-kit/src/index.ts docs/ui-kit.md
git commit -m "feat(ui-kit): add container view header"
```

---

### Task 2: Асинхронный полный `TurnRequest` из контроллера

**Files:**

- Modify: `apps/web/src/sessions/use-sessions.ts`
- Modify: `apps/web/src/sessions/use-sessions.test.tsx`
- Modify: `apps/web/src/sessions/new-session-view.tsx`
- Modify: `apps/web/src/App.tsx`

**Interfaces:**

- Consumes: `TurnRequest`, существующий `submitTurn(sessionId, request)` из `api.ts`.
- Produces:

```ts
type SubmitTurn = (request: TurnRequest) => Promise<string | undefined>;
type SubmitTurnToSession = (sessionId: string, request: TurnRequest) => Promise<string | undefined>;
type PrepareModels = () => void;
```

- [ ] **Step 1: Написать падающие тесты полного тела и отказа**

В `use-sessions.test.tsx` заменить синхронные вызовы на `await act(...)` и добавить проверку:

```tsx
let reason: string | undefined;
await act(async () => {
  reason = await view.result.current.submitTurn({
    text: "привет",
    model: "openai/gpt-5",
    thinkingLevel: "high",
  });
});

expect(JSON.parse(asked(sessionTurnsPath("0199"), "POST")[0]!.body!)).toEqual({
  text: "привет",
  model: "openai/gpt-5",
  thinkingLevel: "high",
});
expect(reason).toBeUndefined();
```

Для ответа `409` ожидать возвращённую строку причины и сохранённый `open.failure`.

- [ ] **Step 2: Запустить focused-тест**

Run: `pnpm --filter @sovereign/web test -- src/sessions/use-sessions.test.tsx`

Expected: FAIL — контроллер принимает только строку и ничего не возвращает.

- [ ] **Step 3: Изменить контроллер без изменения API демона**

`submitTurnToSession` должен принимать `TurnRequest`, передавать его целиком в API, использовать
`request.text` для `pending` и возвращать `undefined` только при `accepted`; сетевой отказ и
`outcome.kind === "refused"` возвращают строку причины после существующего обновления диагностики и
`open.failure`. `submitTurn` делегирует запрос текущему `open.id` и тоже возвращает Promise.

Добавить `prepareModels`, который запрашивает только `fetchProvidersSnapshot()` и применяет
`applyProviders`; существующий `prepareDraft` вызывает `reloadDraftProjects()` и `prepareModels()`.

- [ ] **Step 4: Сохранить первый турн новой сессии**

Изменить `NewSessionViewProps.onSubmit` на `(sessionId: string, request: TurnRequest) => void` и при
создании отправлять `{ text: trimmed }`. В `App.tsx` временно адаптировать текущие вызовы к новым
сигнатурам; модельные props чата появятся в Task 5.

- [ ] **Step 5: Запустить тесты контроллера и формы**

Run: `pnpm --filter @sovereign/web test -- src/sessions/use-sessions.test.tsx src/sessions/new-session-view.test.tsx`

Expected: PASS.

Run: `pnpm --filter @sovereign/web typecheck`

Expected: PASS.

- [ ] **Step 6: Закоммитить срез**

```bash
git add apps/web/src/sessions/use-sessions.ts apps/web/src/sessions/use-sessions.test.tsx apps/web/src/sessions/new-session-view.tsx apps/web/src/sessions/new-session-view.test.tsx apps/web/src/App.tsx
git commit -m "feat(web): submit session turn overrides"
```

---

### Task 3: Локальные настройки модели и reasoning в композере

**Files:**

- Create: `apps/web/src/sessions/model-options.ts`
- Create: `apps/web/src/sessions/model-options.test.ts`
- Modify: `apps/web/src/sessions/new-session-view.tsx`
- Modify: `apps/web/src/sessions/message-composer.tsx`
- Modify: `apps/web/src/sessions/message-composer.test.tsx`
- Modify: `packages/ui-kit/src/i18n/messages/en.ts`
- Modify: `packages/ui-kit/src/i18n/messages/ru.ts`

**Interfaces:**

- Consumes: `ProviderSummary[]`, `Record<string, ModelsEntry>`, `ModelPicker`, `ThinkingLevel`.
- Produces:

```ts
export function modelPickerGroups(
  providers: ProviderSummary[] | undefined,
  models: Record<string, ModelsEntry>,
  selectedReference: string | undefined,
): ModelPickerGroup[];

export function selectedModel(
  reference: string | undefined,
  models: Record<string, ModelsEntry>,
): ModelSummary | undefined;

export type MessageComposerProps = {
  draft: string;
  onDraftChange: (draft: string) => void;
  busy: boolean;
  disabled?: boolean;
  model: string;
  modelGroups: ModelPickerGroup[];
  onModelChange: (model: string) => void;
  onExpandModelGroup: (providerId: string) => void;
  thinkingLevel: ThinkingLevel;
  reasoningSupported: boolean;
  onThinkingLevelChange: (level: ThinkingLevel) => void;
  onSubmit: (request: TurnRequest) => Promise<string | undefined>;
  onSendMessage: (message: SessionMessage) => Promise<string | undefined>;
  onInterrupt: () => void;
  translator: ScopedTranslator;
};
```

- [ ] **Step 1: Зафиксировать сборку групп с текущей моделью**

В `model-options.test.ts` проверить три случая: готовый каталог; ленивый незагруженный провайдер;
текущая модель, провайдер которой ещё отсутствует в снимке. В последних двух случаях выбранная
ссылка обязана присутствовать как synthetic option, чтобы триггер не показывал placeholder.

- [ ] **Step 2: Запустить тест helper-а**

Run: `pnpm --filter @sovereign/web test -- src/sessions/model-options.test.ts`

Expected: FAIL — модуля ещё нет.

- [ ] **Step 3: Реализовать helper и переиспользовать его в форме создания**

Использовать `parseModelReference`/`modelReference`; не дублировать inline-сборку из
`new-session-view.tsx`. `selectedModel` возвращает `undefined`, пока нужный каталог не готов.

- [ ] **Step 4: Написать падающие тесты композера**

Расширить harness контролируемыми `model` и `thinkingLevel`. Проверить:

```tsx
expect(screen.getByRole("combobox", { name: "Модель" })).toBeEnabled();
expect(screen.getByRole("combobox", { name: "Уровень рассуждений" })).toBeEnabled();
```

Даже при `busy` оба combobox доступны. После выбора и обычной отправки callback получает полный
`TurnRequest`. Для `follow-up` и `append` callback получает только прежний `SessionMessage`.
Deferred Promise доказывает: до `accepted` текст остаётся и повторная отправка выключена; при
`reason` текст остаётся; при `undefined` очищается.

- [ ] **Step 5: Реализовать контролы и асинхронную очистку**

Разместить `ModelPicker` и `Select` под textarea внутри поднятой поверхности. `Select` получает все
`thinkingLevels`, локализованные через `thinking.*`; при `reasoningSupported === false` значение
`off`, контрол выключен. Пока каталог выбранной модели не загружен, поддержка reasoning считается
неизвестной: текущий уровень сохраняется и контрол остаётся доступным. Отдельный `submitting`
блокирует операции отправки, но не выбор модели и reasoning.

Добавить ключи `chat.model`, `chat.thinking`, `chat.stats.tokens.label`,
`chat.stats.cost.label`, `chat.context.title`, `chat.context.value`,
`chat.context.window-unknown` в оба core-каталога.

- [ ] **Step 6: Проверить component boundary**

Run: `pnpm --filter @sovereign/web test -- src/sessions/model-options.test.ts src/sessions/message-composer.test.tsx src/sessions/new-session-view.test.tsx`

Expected: PASS.

Run: `pnpm --filter @sovereign/web typecheck`

Expected: PASS.

- [ ] **Step 7: Закоммитить срез**

```bash
git add apps/web/src/sessions/model-options.ts apps/web/src/sessions/model-options.test.ts apps/web/src/sessions/new-session-view.tsx apps/web/src/sessions/message-composer.tsx apps/web/src/sessions/message-composer.test.tsx packages/ui-kit/src/i18n/messages/en.ts packages/ui-kit/src/i18n/messages/ru.ts
git commit -m "feat(web): configure the next session turn"
```

---

### Task 4: Раздельная полоса использования сессии

**Files:**

- Create: `apps/web/src/sessions/session-usage.tsx`
- Create: `apps/web/src/sessions/session-usage.test.tsx`
- Modify: `apps/web/src/sessions/sessions.css`

**Interfaces:**

- Consumes: `SessionStats | undefined`, `SessionContextUsage | undefined`, UI-kit `Progress`.
- Produces:

```ts
export function contextTone(context: SessionContextUsage | undefined): ProgressTone;

export type SessionUsageProps = {
  stats: SessionStats | undefined;
  context: SessionContextUsage | undefined;
  translator: ScopedTranslator;
};

export function SessionUsage(props: SessionUsageProps): React.JSX.Element;
```

- [ ] **Step 1: Написать тесты порогов и независимых метрик**

Проверить `accent` ниже порога, `warning` на `threshold`, `danger` на 100%, fallback 80% при
`threshold === 0` и при `threshold >= 1`. DOM-тест отдельно проверяет три группы: контекст,
токены сессии и стоимость; отсутствующие значения показывают `—`, а неизвестное окно не создаёт
`progressbar` и процент.

- [ ] **Step 2: Запустить тест и увидеть отсутствие компонента**

Run: `pnpm --filter @sovereign/web test -- src/sessions/session-usage.test.tsx`

Expected: FAIL — `session-usage.tsx` ещё не существует.

- [ ] **Step 3: Реализовать чистый расчёт и представление**

Расчёт:

```ts
const share =
  context?.contextWindow === undefined || context.contextWindow <= 0
    ? undefined
    : context.tokens / context.contextWindow;
const warningAt =
  context !== undefined && context.threshold > 0 && context.threshold < 1 ? context.threshold : 0.8;
const tone =
  share !== undefined && share >= 1
    ? "danger"
    : share !== undefined && share >= warningAt
      ? "warning"
      : "accent";
```

Число и процент остаются рядом со шкалой; цвет не является единственным сигналом.

- [ ] **Step 4: Добавить контейнерно-адаптивную геометрию**

`.sessions-usage` использует Grid `minmax(0, 1fr) auto auto`; на узком container query контекст
занимает всю первую строку, токены и стоимость — вторую. Не задавать фиксированную ширину.

- [ ] **Step 5: Проверить компонент и CSS-дисциплину**

Run: `pnpm --filter @sovereign/web test -- src/sessions/session-usage.test.tsx src/shell/styles.test.ts`

Expected: PASS.

- [ ] **Step 6: Закоммитить срез**

```bash
git add apps/web/src/sessions/session-usage.tsx apps/web/src/sessions/session-usage.test.tsx apps/web/src/sessions/sessions.css
git commit -m "feat(web): show separated session usage"
```

---

### Task 5: Собрать трёхзонную самодостаточную панель

**Files:**

- Create: `apps/web/src/sessions/chat-view.test.tsx`
- Modify: `apps/web/src/sessions/chat-view.tsx`
- Modify: `apps/web/src/sessions/message-composer.tsx`
- Modify: `apps/web/src/sessions/session-message-list.tsx`
- Modify: `apps/web/src/sessions/session-message-list.test.tsx`
- Modify: `apps/web/src/sessions/sessions.css`
- Modify: `packages/ui-kit/src/components/message-feed.tsx`
- Modify: `packages/ui-kit/src/components/rendering.test.tsx`
- Modify: `apps/web/src/shell/shell.css`
- Modify: `apps/web/src/shell/shell.tsx`
- Modify: `apps/web/src/shell/shell.test.tsx`
- Modify: `apps/web/src/shell/styles.test.ts`
- Modify: `apps/web/src/App.tsx`
- Modify: `docs/sessions-and-projects.md`
- Modify: `docs/backlog.md`

**Interfaces:**

- Consumes: `ViewHeader`, `SessionUsage`, `modelPickerGroups`, `selectedModel`, controller Task 2.
- Produces: `ChatView` как изолированный Grid-компонент, готовый жить в произвольной ячейке.

```ts
export type ChatViewProps = {
  open: OpenSession;
  providers?: ProviderSummary[];
  models: Record<string, ModelsEntry>;
  onPrepareModels: () => void;
  onLoadModels: (providerId: string) => void;
  onSubmit: (request: TurnRequest) => Promise<string | undefined>;
  // остальные существующие callbacks сохраняются
};

export type SessionMessageListProps = {
  // существующие props
  className?: string;
  before?: ReactNode;
  after?: ReactNode;
};

export type ShellProps = {
  // существующие props
  contentMode?: "page" | "contained";
};

export type MessageFeedProps = {
  label: string;
  busy?: boolean;
  className?: string;
  before?: ReactNode;
  after?: ReactNode;
  children: ReactNode;
};
```

- [ ] **Step 1: Написать integration-тест заголовка и состояния панели**

Создать fixture `OpenSession` с summary, stats и context. Проверить:

- `h1` показывает `summary.title`, а без него — «Новая сессия»;
- форк, компакция и дерево находятся внутри `header`;
- старой нижней `.sessions-session-actions` нет;
- `onPrepareModels` вызывается при mount;
- два одновременно смонтированных `ChatView` сохраняют разные тексты, модели и reasoning;
- rerender с другим `open.id` сбрасывает значения к новой summary;
- изменение модели во время `busy` не вызывает `onSubmit`, а следующий idle-submit получает её.

- [ ] **Step 2: Запустить новый тест**

Run: `pnpm --filter @sovereign/web test -- src/sessions/chat-view.test.tsx`

Expected: FAIL — текущий `ChatView` не имеет заголовка, новых props и локальных override-состояний.

- [ ] **Step 3: Разделить JSX на три явные области**

Структура должна иметь ровно три Grid-строки:

```tsx
<section className="sessions-chat">
  <ViewHeader title={open.summary?.title ?? t("sessions.new.title")} actions={headerActions} />
  <SessionMessageList
    className="sessions-chat-scroll"
    before={notices}
    after={queues}
    {...messageListProps}
  />
  <div className="sessions-chat-bottom">
    <SessionUsage stats={open.stats} context={open.context} translator={translator} />
    {archived ? undefined : <MessageComposer ... />}
  </div>
  {drawersAndDialogs}
</section>
```

`ChatView` инициализирует `draft`, `model` и `thinkingLevel` из summary. Эффект с зависимостью
`open.id` сбрасывает их только при смене сессии; обновления той же summary не стирают подготовленный
выбор. Эффект mount вызывает `onPrepareModels` и загружает каталог провайдера текущей модели через
`parseModelReference`; раскрытие любой другой группы вызывает `onLoadModels`. Таким образом, чат
сразу узнаёт реальную reasoning-capability текущей модели, но остальные каталоги остаются ленивыми.

Расширить нейтральный `MessageFeed` необязательными `className`, `before` и `after`, которые
рендерятся внутри того же `role="log"` до и после `children`. `SessionMessageList` принимает те же
слоты и прокидывает их в `MessageFeed`. Даже loading и empty состояния остаются внутри
`MessageFeed`. Так средняя Grid-строка является прежним auto-stick scroll-root, а вложенного второго
`overflow: auto` не появляется.

- [ ] **Step 4: Проложить данные в `App.tsx`**

Передать `sessions.state.providers`, `sessions.state.models`, `sessions.prepareModels`,
`sessions.loadModels` и асинхронный `sessions.submitTurn`. Не брать каталоги из отдельного
`useProviders`: composer и форма создания используют один кэш `useSessions`.

Передать в `Shell` `contentMode={page.kind === "session" ? "contained" : "page"}`. `Shell` пишет
значение в `data-content-mode` элемента `.shell-page`; default `page` сохраняет нынешнюю прокрутку
всех остальных маршрутов, `contained` даёт единственному ребёнку доступную высоту и скрывает
глобальный scroll.

- [ ] **Step 5: Закрепить Grid и цепочку высоты CSS-тестом**

Расширить `styles.test.ts` ожиданиями:

```ts
expect(sessions).toMatch(
  /\.sessions-chat\s*\{[^}]*display:\s*grid;[^}]*grid-template-rows:\s*auto minmax\(0, 1fr\) auto;/s,
);
expect(sessions).toMatch(/\.sessions-chat-scroll\s*\{[^}]*min-height:\s*0;/s);
expect(sessions).not.toMatch(
  /\.sessions-chat[^}]*(?:position:\s*(?:sticky|absolute)|100vh|100dvh)/s,
);
```

Тест `Shell` проверяет `data-content-mode="contained"`; CSS-тест проверяет
`.shell-page[data-content-mode="contained"] { display: flex; overflow: hidden; min-height: 0; }` и
сохранённый `overflow: auto` default-страницы. `MessageFeed` остаётся единственным `overflow-y: auto`.

- [ ] **Step 6: Прогнать focused-набор и обновить документацию**

Run: `pnpm --filter @sovereign/ui-kit test -- src/components/rendering.test.tsx`

Expected: PASS.

Run: `pnpm --filter @sovereign/web test -- src/sessions/chat-view.test.tsx src/sessions/message-composer.test.tsx src/sessions/session-usage.test.tsx src/sessions/session-message-list.test.tsx src/sessions/session-route-view.test.tsx src/sessions/use-sessions.test.tsx src/shell/shell.test.tsx src/shell/styles.test.ts`

Expected: PASS.

В `docs/sessions-and-projects.md` описать три области, следующий-turn override и контейнерную
изоляцию. В `docs/backlog.md` записать отдельный будущий срез миграции остальных заголовков на
`ViewHeader` и отдельно — многопанельный контроллер/маршрут; не смешивать их с выполненной задачей.

- [ ] **Step 7: Проверить широкую и узкую панель в браузере**

Запустить `make dev`, открыть реальную сессию и проверить: длинную историю, textarea на 12 строк,
широкую центральную область и узкую ширину около половины экрана; header и footer видны, скроллится
только середина, popover модели не обрезан, семантические тона шкалы читаемы.

- [ ] **Step 8: Закоммитить интеграцию**

```bash
git add apps/web/src/sessions/chat-view.tsx apps/web/src/sessions/chat-view.test.tsx apps/web/src/sessions/message-composer.tsx apps/web/src/sessions/session-message-list.tsx apps/web/src/sessions/session-message-list.test.tsx apps/web/src/sessions/sessions.css packages/ui-kit/src/components/message-feed.tsx packages/ui-kit/src/components/rendering.test.tsx apps/web/src/shell/shell.tsx apps/web/src/shell/shell.test.tsx apps/web/src/shell/shell.css apps/web/src/shell/styles.test.ts apps/web/src/App.tsx docs/sessions-and-projects.md docs/backlog.md
git commit -m "feat(web): pin the session workspace around its feed"
```

---

### Task 6: Полная верификация и закрытие документации

**Files:**

- Modify when required by observed behavior: `docs/superpowers/plans/2026-08-05-session-chat-panel-layout.md`
- Modify when verified behavior differs: `docs/sessions-and-projects.md`
- Modify when shared primitive details differ: `docs/ui-kit.md`

**Interfaces:**

- Consumes: пять завершённых и отдельно закоммиченных срезов.
- Produces: полностью проверенная ветка без незакоммиченных изменений.

- [ ] **Step 1: Запустить форматирование только затронутых файлов**

Run: `pnpm exec prettier --write packages/ui-kit/src/components/view-header.tsx packages/ui-kit/src/components/view-header.module.css packages/ui-kit/src/components/rendering.test.tsx packages/ui-kit/src/components/primitives.stories.tsx packages/ui-kit/src/index.ts apps/web/src/sessions/model-options.ts apps/web/src/sessions/model-options.test.ts apps/web/src/sessions/message-composer.tsx apps/web/src/sessions/message-composer.test.tsx apps/web/src/sessions/session-usage.tsx apps/web/src/sessions/session-usage.test.tsx apps/web/src/sessions/chat-view.tsx apps/web/src/sessions/chat-view.test.tsx apps/web/src/sessions/use-sessions.ts apps/web/src/sessions/use-sessions.test.tsx apps/web/src/sessions/new-session-view.tsx apps/web/src/sessions/new-session-view.test.tsx apps/web/src/sessions/sessions.css apps/web/src/shell/shell.css apps/web/src/shell/styles.test.ts apps/web/src/App.tsx packages/ui-kit/src/i18n/messages/en.ts packages/ui-kit/src/i18n/messages/ru.ts docs/ui-kit.md docs/sessions-and-projects.md docs/backlog.md`

Expected: команда завершается успешно; если форматтер меняет уже закоммиченные файлы, оформить
отдельный `style`-коммит только с механическими изменениями.

- [ ] **Step 2: Запустить полную проверку репозитория**

Run: `make check`

Expected: typecheck, ESLint, Prettier и все тесты PASS без новых предупреждений.

- [ ] **Step 3: Проверить состояние Git и историю срезов**

Run: `git status --short && git log --oneline -8`

Expected: рабочее дерево чистое; видны отдельные коммиты UI-kit, контроллера, композера, usage и
Grid-интеграции.

- [ ] **Step 4: Зафиксировать только реальные расхождения**

Если браузерная или полная проверка потребовала изменить описанное поведение, обновить тематический
документ и план фактической формулировкой, затем выполнить:

```bash
git add docs/ui-kit.md docs/sessions-and-projects.md docs/superpowers/plans/2026-08-05-session-chat-panel-layout.md
git commit -m "docs(chat): record verified session panel behavior"
```

Если расхождений нет, этот коммит не создавать.
