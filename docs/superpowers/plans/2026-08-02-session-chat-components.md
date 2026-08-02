# План реализации компонентов чата сессии

> **Для агентов-исполнителей:** ОБЯЗАТЕЛЬНЫЙ ДОПОЛНИТЕЛЬНЫЙ SKILL: используйте
> superpowers:subagent-driven-development (рекомендуется) или superpowers:executing-plans, чтобы
> выполнять этот план задача за задачей. Для отслеживания шагов используется синтаксис checkbox
> (`- [ ]`).

**Цель:** выделить ленту сообщений сессии и контролируемый композер из `ChatView` без изменения
видимого пользователю поведения.

**Архитектура:** `ChatView` остаётся координатором панели открытой сессии и владеет черновиком
сообщения, чтобы `EntryTreeDrawer` мог заменить его после навигации. `MessageComposer` владеет только
выбором режима доставки и сообщает об управляемых изменениях черновика; `SessionMessageList` владеет
формированием и отображением ленты, включая действия над записями и редактирование меток. Оба
остаются feature-компонентами в `apps/web/src/sessions` и не выполняют собственных запросов.

**Технологический стек:** TypeScript, React 19, Vitest, Testing Library, `@sovereign/protocol`,
`@sovereign/ui-kit`.

## Общие ограничения

- Сохранить всё существующее поведение экрана сессии и каждый ключ перевода.
- Оставить состояние `draft` в `ChatView` и передавать `draft` вместе с `onDraftChange` в
  `MessageComposer`.
- Оставить HTTP/API-вызовы сессии за пределами всех view-компонентов.
- Оставить оба выделенных компонента в `apps/web/src/sessions`; не добавлять примитивы или
  зависимости UI-кита.
- Сохранить порядок ленты: сохранённые записи активной ветки, ожидающие турны, затем live-элементы.
- Сохранить дедупликацию первого live-prompt, не скрывая более поздний steering, повторяющий прежнее
  сообщение человека.
- Следовать TDD: добавить прямой компонентный тест, увидеть ожидаемый отказ, затем добавить
  production-код.
- Завершать каждую задачу зелёными focused-тестами, существующим `sessions-view.test.tsx`, проверкой
  типов веб-пакета и атомарным коммитом.

---

### Задача 1: выделить контролируемый композер сообщений

**Файлы:**

- Создать: `apps/web/src/sessions/message-composer.tsx`
- Создать: `apps/web/src/sessions/message-composer.test.tsx`
- Изменить: `apps/web/src/sessions/chat-view.tsx:12-370`

**Интерфейсы:**

- Получает: `SessionMessage`, `SessionMessageMode` и `ScopedTranslator`; колбэки, уже получаемые
  `ChatView`.
- Предоставляет:

```ts
export type MessageComposerProps = {
  draft: string;
  onDraftChange: (draft: string) => void;
  busy: boolean;
  onSubmit: (text: string) => void;
  onSendMessage: (message: SessionMessage) => Promise<string | undefined>;
  onInterrupt: () => void;
  translator: ScopedTranslator;
};

export function MessageComposer(props: MessageComposerProps): React.JSX.Element;
```

- `ChatView` сохраняет ответственность за скрытие компонента, когда сессия архивная, и напрямую
  передаёт свою пару `draft`/`setDraft`.

- [x] **Шаг 1: написать падающие прямые компонентные тесты**

Создать `message-composer.test.tsx` с harness-компонентом с состоянием, который отображает
`MessageComposer`. Доказать через DOM следующее поведение границы компонента:

```tsx
it("сообщает об изменениях черновика через контролируемый интерфейс", () => {
  // Ввести текст через textarea и проверить, что harness показывает обновлённое контролируемое значение.
});

it("отправляет черновик простаивающей сессии и просит владельца очистить его", () => {
  // Ввести "привет", нажать "Отправить", проверить onSubmit("привет") и пустую textarea.
});

it("владеет режимом доставки, пока сессия занята", () => {
  // Выбрать follow-up, отправить "продолжай" и проверить { text: "продолжай", mode: "follow-up" }.
});

it("предлагает append только в простое, а interrupt — только во время работы", () => {
  // Проверить вызов append с режимом "append" в простое, перерисовать занятую сессию и проверить interrupt.
});
```

- [x] **Шаг 2: запустить прямой тест и подтвердить RED**

Выполнить:

```bash
pnpm --filter @sovereign/web test -- src/sessions/message-composer.test.tsx
```

Ожидается: FAIL, потому что `./message-composer.tsx` не существует. Не добавлять production-код до
фиксации этого отказа в отчёте о задаче.

- [x] **Шаг 3: реализовать минимальный контролируемый компонент**

Перенести из `ChatView` в `message-composer.tsx` `busyModes`, состояние режима доставки, селектор
режима, textarea, выбор отправки/append, очистку черновика и кнопку прерывания. После непустой
отправки или append вызывать `props.onDraftChange("")`. При отправке сохранять исходный текст
черновика и использовать `trim()` только для отклонения/блокировки пустого ввода, как в текущем
поведении.

- [x] **Шаг 4: встроить компонент в `ChatView`**

Удалить перенесённые импорты UI-кита и встроенный код композера. Отобразить:

```tsx
{
  archived ? undefined : (
    <MessageComposer
      draft={draft}
      onDraftChange={setDraft}
      busy={busy}
      onSubmit={onSubmit}
      onSendMessage={onSendMessage}
      onInterrupt={onInterrupt}
      translator={translator}
    />
  );
}
```

Оставить `<EntryTreeDrawer onEditorText={setDraft} />` без изменений, чтобы навигация продолжала
заполнять тот же контролируемый черновик.

- [x] **Шаг 5: подтвердить GREEN и интеграцию**

Выполнить:

```bash
pnpm --filter @sovereign/web test -- src/sessions/message-composer.test.tsx src/sessions/sessions-view.test.tsx
pnpm --filter @sovereign/web typecheck
```

Ожидается: оба тестовых файла проходят, проверка типов завершается с кодом 0.

- [x] **Шаг 6: сделать коммит**

```bash
git add apps/web/src/sessions/message-composer.tsx apps/web/src/sessions/message-composer.test.tsx apps/web/src/sessions/chat-view.tsx
git commit -m "refactor(web): extract the session message composer" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

### Задача 2: выделить список сообщений сессии

**Файлы:**

- Создать: `apps/web/src/sessions/session-message-list.tsx`
- Создать: `apps/web/src/sessions/session-message-list.test.tsx`
- Изменить: `apps/web/src/sessions/chat-view.tsx:12-644`

**Интерфейсы:**

- Получает: снимок `OpenSession` и существующие колбэки для fork и меток записей.
- Предоставляет:

```ts
export type SessionMessageListProps = {
  open: OpenSession;
  busy: boolean;
  archived: boolean;
  onFork: (request: SessionForkRequest) => Promise<void>;
  onSetLabel: (entryId: string, label: string | null) => Promise<string | undefined>;
  translator: ScopedTranslator;
};

export function SessionMessageList(props: SessionMessageListProps): React.JSX.Element;
```

- Владеет собственным диалогом редактирования метки и уведомлением об отказе метки, потому что оба
  возникают из действий строки сообщения.
- Оставляет уведомления об отказах/деградации турна, статистику, контекст, значки очереди, дерево,
  fork сессии и компакцию в `ChatView`.

- [x] **Шаг 1: написать падающие прямые компонентные тесты**

Создать `session-message-list.test.tsx` с минимальной фикстурой `OpenSession`. Доказать через DOM
следующее поведение границы компонента:

```tsx
it("отображает по порядку сохранённые записи, ожидающие турны и live-элементы", () => {
  // Использовать три уникальных текста и сравнить положения их элементов.
});

it("дедуплицирует сохранённый первый prompt, но сохраняет повторный steering", () => {
  // Сохранить "привет" и передать два live-сообщения пользователя с этим текстом; ожидать две видимые копии.
});

it("оставляет действия над сообщениями и редактирование меток в списке", async () => {
  // Открыть меню метки сообщения, сохранить метку и проверить onSetLabel(entryId, label).
});

it("не предлагает изменяющих действий для архивных сообщений", () => {
  // Проверить отсутствие действий с метками при сохранении читаемого содержимого.
});
```

- [x] **Шаг 2: запустить прямой тест и подтвердить RED**

Выполнить:

```bash
pnpm --filter @sovereign/web test -- src/sessions/session-message-list.test.tsx
```

Ожидается: FAIL, потому что `./session-message-list.tsx` не существует. Не добавлять production-код
до фиксации этого отказа в отчёте о задаче.

- [x] **Шаг 3: реализовать минимальный компонент списка**

Перенести из `ChatView` в `session-message-list.tsx`:

- поиск результата вызова инструмента;
- фильтрацию активной ветки/ленты;
- порядок ожидающих и live-элементов и дедупликацию первого prompt;
- состояния загрузки и пустой ленты вокруг `MessageFeed`;
- `EntryMessage`, `ContentBlock` и `LiveMessage`;
- состояние диалога метки, запрос метки, уведомление об отказе и колбэки fork/метки на уровне строки.

Сохранить существующие комментарии, объясняющие неочевидный порядок, потоковую Markdown-разметку,
поведение архива и позиции fork.

- [x] **Шаг 4: встроить компонент в `ChatView`**

Заменить встроенную ленту и диалог метки на:

```tsx
<SessionMessageList
  open={open}
  busy={busy}
  archived={archived}
  onFork={onFork}
  onSetLabel={onSetLabel}
  translator={translator}
/>
```

Удалить только импорты, состояние, вспомогательные функции и обработку отказа, которыми теперь
владеет список. Оставить отказ компакции локальным для `ChatView` и сохранить его переведённое
уведомление.

- [x] **Шаг 5: подтвердить GREEN и интеграцию**

Выполнить:

```bash
pnpm --filter @sovereign/web test -- src/sessions/session-message-list.test.tsx src/sessions/message-composer.test.tsx src/sessions/sessions-view.test.tsx
pnpm --filter @sovereign/web typecheck
```

Ожидается: все три тестовых файла проходят, проверка типов завершается с кодом 0.

- [x] **Шаг 6: выполнить проверку всей feature-области**

Выполнить:

```bash
pnpm --filter @sovereign/web test
pnpm exec eslint apps/web/src/sessions
pnpm exec prettier --check apps/web/src/sessions
```

Ожидается: весь набор тестов веб-пакета проходит, ESLint завершается с кодом 0, а Prettier сообщает,
что все подходящие файлы отформатированы.

- [x] **Шаг 7: сделать коммит**

```bash
git add apps/web/src/sessions/session-message-list.tsx apps/web/src/sessions/session-message-list.test.tsx apps/web/src/sessions/chat-view.tsx
git commit -m "refactor(web): extract the session message list" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

### Задача 3: проверить завершённый рефакторинг

**Файлы:**

- Изменять только в том случае, если отказ проверки обнаружит регрессию в файлах, изменённых в
  задачах 1–2.

**Интерфейсы:**

- Получает: два выделенных компонента, встроенных в `ChatView`.
- Предоставляет: ветку, в которой проходят полные проверки репозитория и production-сборка веба.

- [x] **Шаг 1: запустить полную проверку репозитория**

```bash
make check
```

Ожидается: проверка типов, ESLint, Prettier и тесты каждого пакета завершаются с кодом 0.

- [x] **Шаг 2: запустить production-сборку**

```bash
make build
```

Ожидается: каждый пакет со скриптом сборки успешно собирается, а production-бандл веба Vite
создаётся без ошибок.

- [x] **Шаг 3: зафиксировать проверку**

Если изменения кода не понадобились, не создавать пустой коммит. Записать команды, коды выхода и
число тестов в отчёте о задаче и SDD-журнале. Если потребовалось исправить регрессию в заданных
границах, сначала добавить падающий регрессионный тест, увидеть RED, реализовать минимальное
исправление, повторить обе команды и сделать атомарный коммит с обязательным co-author-трейлером.
