# Панель действий реплики сессии — план реализации

> **Для агентов-исполнителей:** ОБЯЗАТЕЛЬНЫЙ ДОПОЛНИТЕЛЬНЫЙ SKILL: используйте
> superpowers:subagent-driven-development (рекомендуется) или superpowers:executing-plans, чтобы
> выполнять этот план задача за задачей. Для отслеживания шагов используется синтаксис checkbox
> (`- [ ]`).

**Цель:** заменить постоянные текстовые действия и меню `…` у сохранённых реплик на единую
hover/focus-панель с локальным временем, иконками, tooltip и копированием только текста реплики.

**Архитектура:** `@sovereign/ui-kit` получает `lucide-react` и экспортирует небольшой согласованный
словарь иконок через собственные компоненты. `SessionMessageList` остаётся владельцем предметных
действий, clipboard-состояния и отказов; внутренний `EntryMessage` оборачивает `Message` в
feature-контейнер, который показывает строку метаданных по hover и `:focus-within`.

**Технологический стек:** TypeScript, React 19, Vitest, Testing Library, CSS Modules прикладного
экрана, `lucide-react`, `@sovereign/protocol`, `@sovereign/ui-kit`.

## Общие ограничения

- Состав и семантика существующих действий форка и меток не меняются.
- `lucide-react` является зависимостью `@sovereign/ui-kit`; `apps/web` не импортирует библиотеку
  напрямую.
- Панель относится только к сохранённым `SessionEntry` с `kind: "message"`; live-сообщения,
  ожидающие турны и служебные записи не получают выдуманного времени или действий.
- Панель визуально скрыта без наведения и появляется целиком по hover или клавиатурному фокусу.
- Копируются только непустые блоки `kind: "text"`, соединённые `"\n\n"`; reasoning, tool calls и
  tool results исключены.
- Время форматируется локально как часы и минуты из `SessionEntry.time`; невалидная дата не
  отображается.
- Все видимые действия — icon-only кнопки с локализованными `aria-label` и `Tooltip`; меню `…` у
  реплики отсутствует.
- Новых HTTP-маршрутов, запросов и изменений протокола нет.
- Каждая задача выполняется TDD-циклом и завершается отдельным атомарным коммитом.

---

### Задача 1: публичный набор иконок UI-кита

**Файлы:**

- Создать: `packages/ui-kit/src/components/icons.tsx`
- Создать: `packages/ui-kit/src/components/icons.module.css`
- Изменить: `packages/ui-kit/src/components/rendering.test.tsx`
- Изменить: `packages/ui-kit/src/index.ts`
- Изменить: `packages/ui-kit/package.json`
- Изменить: `pnpm-lock.yaml`
- Изменить: `docs/ui-kit.md`

**Интерфейсы:**

- Получает: `lucide-react` и существующий `Icon` с размерной сеткой UI-кита.
- Предоставляет:

```ts
export type SymbolIconProps = { size?: IconSize };
export function CopyIcon(props: SymbolIconProps): React.JSX.Element;
export function ForkBeforeIcon(props: SymbolIconProps): React.JSX.Element;
export function ForkThroughIcon(props: SymbolIconProps): React.JSX.Element;
export function SetLabelIcon(props: SymbolIconProps): React.JSX.Element;
export function ClearLabelIcon(props: SymbolIconProps): React.JSX.Element;
```

- [x] **Шаг 1: добавить падающий тест публичных пиктограмм**

В `rendering.test.tsx` импортировать пять компонентов из `./icons.tsx` и проверить общий контракт:

```tsx
it("renders the shared action icons as decorative symbols on the UI-kit size grid", () => {
  const markup = renderToStaticMarkup(
    <>
      <CopyIcon size="sm" />
      <ForkBeforeIcon />
      <ForkThroughIcon />
      <SetLabelIcon />
      <ClearLabelIcon />
    </>,
  );

  expect(markup.match(/<svg/g)).toHaveLength(5);
  expect(markup).toContain('aria-hidden="true"');
  expect(markup).not.toContain("undefined");
});
```

- [x] **Шаг 2: подтвердить RED отсутствующего модуля**

Выполнить:

```bash
pnpm --filter @sovereign/ui-kit test -- src/components/rendering.test.tsx
```

Ожидается: FAIL с невозможностью разрешить `./icons.tsx`.

- [x] **Шаг 3: подключить библиотеку и реализовать минимальные обёртки**

Выполнить:

```bash
pnpm --filter @sovereign/ui-kit add lucide-react
```

В `icons.tsx` поэлементно импортировать `Copy`, `GitBranchPlus`, `GitFork`, `Tag`, `TagOff` и
отрисовать каждый символ внутри существующего `Icon`. SVG получает `size="100%"`,
`strokeWidth={1.75}` и `aria-hidden`, а компонент принимает только размер UI-кита. Не
реэкспортировать Lucide и его типы.

- [x] **Шаг 4: открыть публичную поверхность и описать решение**

Добавить `export * from "./components/icons.tsx"` в `packages/ui-kit/src/index.ts`. В разделе
`Icon` документа `docs/ui-kit.md` записать, что именованные пиктограммы поставляет Lucide через
обёртки UI-кита; экранный код не импортирует библиотеку напрямую. В «Почему так» описать выбор
Lucide и отвергнутые локальные SVG/прямые импорты.

- [x] **Шаг 5: подтвердить GREEN и контракт пакета**

Выполнить:

```bash
pnpm --filter @sovereign/ui-kit test -- src/components/rendering.test.tsx
pnpm --filter @sovereign/ui-kit typecheck
```

Ожидается: тест проходит, typecheck завершается с кодом 0.

- [x] **Шаг 6: сделать атомарный коммит**

```bash
git add packages/ui-kit/src/components/icons.tsx packages/ui-kit/src/components/rendering.test.tsx \
  packages/ui-kit/src/index.ts packages/ui-kit/package.json pnpm-lock.yaml docs/ui-kit.md \
  docs/superpowers/plans/2026-08-05-session-message-actions.md
git commit -m "feat(ui-kit): add shared action icons"
```

### Задача 2: строка времени и единые действия сохранённой реплики

**Файлы:**

- Изменить: `apps/web/src/sessions/session-message-list.tsx:1-320`
- Изменить: `apps/web/src/sessions/session-message-list.test.tsx:1-280`
- Изменить: `apps/web/src/sessions/sessions.css`
- Изменить: `packages/ui-kit/src/i18n/messages/en.ts`
- Изменить: `packages/ui-kit/src/i18n/messages/ru.ts`
- Изменить: `docs/ui-kit.md`

**Интерфейсы:**

- Получает: `CopyIcon`, `ForkBeforeIcon`, `ForkThroughIcon`, `SetLabelIcon`, `ClearLabelIcon`,
  `Button`, `Tooltip`, `SessionEntry.time` и прежние callbacks форка/меток.
- Предоставляет внутренние чистые функции:

```ts
function messageText(entry: Extract<SessionEntry, { kind: "message" }>): string | undefined;
function formatEntryTime(time: string): string | undefined;
```

- Сохраняет публичный интерфейс `SessionMessageListProps` без изменений.

- [ ] **Шаг 1: заменить тест меню метки тестом единого ряда icon-only действий**

В существующем тесте `keeps message actions and label editing with the list` проверить отсутствие
кнопки «Метка этой записи» и `menuitem`, наличие кнопок «Пометить запись» и «Снять метку», открытие
прежнего диалога прямым нажатием «Пометить запись» и вызов
`onSetLabel("m1", "сюда вернуться")`. В тесте форка оставить проверки обоих прежних payload.

- [ ] **Шаг 2: добавить падающие тесты времени, ролей и ограничений**

Добавить случаи:

```tsx
it("shows the saved entry time and the role-specific action set", () => {
  // У обеих записей есть <time dateTime="2026-07-29T00:00:00.000Z">.
  // Copy и fork-at есть у обеих; fork-before — только у human.
});

it("keeps label actions visible but disabled while busy", () => {
  // Set label и clear label присутствуют; обе disabled, clear также disabled без действующей метки.
});

it("does not offer label actions for archived messages", () => {
  // Текст и read-only copy/fork остаются, обеих кнопок метки нет.
});

it("omits an invalid saved entry time without hiding its actions", () => {
  // <time> отсутствует, copy остаётся.
});
```

- [ ] **Шаг 3: подтвердить RED старой разметки**

Выполнить:

```bash
pnpm --filter @sovereign/web test -- src/sessions/session-message-list.test.tsx
```

Ожидается: FAIL, потому что текущая реализация выводит текстовые кнопки и меню, но не время и
единый набор icon-only действий.

- [ ] **Шаг 4: реализовать строку времени и действий**

В `EntryMessage` обернуть обычный `Message` и `.sessions-entry-meta` общим
`.sessions-entry-message[data-role]`. В метаданных вывести `<time dateTime={entry.time}>`, затем
`Tooltip` + `Button size="sm" iconOnly` для каждого допустимого действия. У каждой кнопки одинаковый
переведённый текст в `aria-label` и tooltip. Удалить импорт и использование `Menu`.

`formatEntryTime` создаёт `Date`, возвращает `undefined` для `Number.isNaN(date.getTime())`, иначе
вызывает `date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })`.

В `sessions.css` строка сохраняет место, но имеет `opacity: 0` и `pointer-events: none`; селекторы
`:hover` и `:focus-within` общего контейнера возвращают `opacity: 1` и pointer events. Человеческая
строка выравнивается вправо, агентская — влево. Не применять `visibility: hidden`, чтобы кнопки
оставались достижимыми через Tab и сами раскрывали строку по `:focus-within`.

- [ ] **Шаг 5: подтвердить GREEN структуры и прежнего поведения**

Выполнить:

```bash
pnpm --filter @sovereign/web test -- src/sessions/session-message-list.test.tsx \
  src/sessions/sessions-view.test.tsx
pnpm --filter @sovereign/web typecheck
```

Если `sessions-view.test.tsx` отсутствует в текущем дереве, выполнить только прямой тест списка и
полный `pnpm --filter @sovereign/web test`; не создавать фиктивный файл.

- [ ] **Шаг 6: сделать промежуточный коммит панели**

```bash
git add apps/web/src/sessions/session-message-list.tsx \
  apps/web/src/sessions/session-message-list.test.tsx apps/web/src/sessions/sessions.css \
  packages/ui-kit/src/i18n/messages/en.ts packages/ui-kit/src/i18n/messages/ru.ts \
  docs/ui-kit.md docs/superpowers/plans/2026-08-05-session-message-actions.md
git commit -m "feat(web): unify saved message actions"
```

### Задача 3: копирование только текста выбранной реплики

**Файлы:**

- Изменить: `apps/web/src/sessions/session-message-list.tsx`
- Изменить: `apps/web/src/sessions/session-message-list.test.tsx`
- Изменить: `packages/ui-kit/src/i18n/messages/en.ts`
- Изменить: `packages/ui-kit/src/i18n/messages/ru.ts`
- Изменить: `docs/ui-kit.md`

**Интерфейсы:**

- Получает: сохранённую message-запись и `navigator.clipboard.writeText`.
- Предоставляет внутреннюю операцию `copy(entry): Promise<void>`, состояние
  `copiedEntryId?: string`, состояние `copyRefusal?: string` и двухсекундный сброс подтверждения.
- Публичные props и серверные интерфейсы не меняются.

- [ ] **Шаг 1: добавить падающий тест состава копируемого текста**

Создать запись агента с блоками text/reasoning/tool-call/text, подменить
`navigator.clipboard.writeText` через `vi.stubGlobal` и проверить:

```tsx
fireEvent.click(screen.getByRole("button", { name: "Копировать" }));
await waitFor(() => expect(writeText).toHaveBeenCalledWith("первая часть\n\nвторая часть"));
expect(screen.getByRole("button", { name: "Скопировано" })).toBeTruthy();
```

Добавить `afterEach(() => vi.unstubAllGlobals())`, чтобы Clipboard API не протекал между тестами.

- [ ] **Шаг 2: добавить падающие тесты отсутствующего текста и ошибки clipboard**

Проверить, что у message-записи только с reasoning/tool-call кнопки «Копировать» нет. Для
`writeText`, отклонённого с `new Error("denied")`, проверить локализованный `role="alert"` с причиной
и то, что доступное имя кнопки не меняется на «Скопировано».

- [ ] **Шаг 3: подтвердить RED неработающего копирования**

Выполнить:

```bash
pnpm --filter @sovereign/web test -- src/sessions/session-message-list.test.tsx
```

Ожидается: FAIL, потому что кнопка ещё не пишет текст в Clipboard API и не показывает результат.

- [ ] **Шаг 4: реализовать сбор текста и обратную связь**

`messageText` фильтрует `kind === "text"`, отбрасывает блоки с `text.trim() === ""`, сохраняет
исходный текст остальных блоков и соединяет их `"\n\n"`. Если частей нет, возвращает `undefined`.

В `SessionMessageList` хранить ID последней успешно скопированной записи, clipboard-ошибку и ref
таймера. Перед новым копированием очищать прежний таймер и ошибку. После успешного `writeText`
установить ID и через 2000 мс очистить его; при размонтировании очистить таймер. При исключении
показать `Notice tone="danger"` с переводом `chat.copy.refused` и причиной, не устанавливая
успешное состояние.

Добавить симметричные ключи `chat.copy`, `chat.copy.done`, `chat.copy.refused` в английский и
русский каталоги. Для успешной кнопки и её tooltip использовать `chat.copy.done`.

- [ ] **Шаг 5: подтвердить GREEN компонента и интеграции**

Выполнить:

```bash
pnpm --filter @sovereign/web test -- src/sessions/session-message-list.test.tsx
pnpm --filter @sovereign/web test
pnpm --filter @sovereign/web typecheck
```

Ожидается: все тесты веб-пакета проходят, typecheck завершается с кодом 0.

- [ ] **Шаг 6: сделать атомарный коммит копирования**

```bash
git add apps/web/src/sessions/session-message-list.tsx \
  apps/web/src/sessions/session-message-list.test.tsx \
  packages/ui-kit/src/i18n/messages/en.ts packages/ui-kit/src/i18n/messages/ru.ts \
  docs/ui-kit.md docs/superpowers/plans/2026-08-05-session-message-actions.md
git commit -m "feat(web): copy saved message text"
```

### Задача 4: визуальная и полная проверка

**Файлы:**

- Изменить при найденном расхождении: файлы задач 1–3
- Изменить: `docs/superpowers/plans/2026-08-05-session-message-actions.md`
- Изменить: `docs/README.md`, только если ссылка или описание плана отсутствуют либо устарели

**Интерфейсы:**

- Получает: законченные задачи 1–3.
- Предоставляет: проверенную реализацию без новых предупреждений и с закрытым планом.

- [ ] **Шаг 1: запустить полный автоматический gate**

```bash
make check
```

Ожидается: typecheck, ESLint, Prettier и все тесты завершаются с кодом 0.

- [ ] **Шаг 2: проверить production-сборку**

```bash
make build
```

Ожидается: все собираемые пакеты завершаются с кодом 0; Vite создаёт production bundle без ошибки
импорта `lucide-react`.

- [ ] **Шаг 3: проверить экран в настоящем браузере**

Запустить приложение по `docs/runbook.md`, открыть сессию с человеческой и агентской репликами и
проверить во всех четырёх поставляемых схемах:

- без hover время и кнопки визуально отсутствуют;
- при hover панель появляется под выбранной репликой и не сдвигает соседние сообщения;
- Tab раскрывает панель через `:focus-within` и сохраняет видимый фокус;
- tooltip не обрезается лентой у проверяемых кнопок;
- human/agent выравнивают панель по своей стороне;
- обе кнопки форка, метки и копирование выполняют прежние действия.

Сохранить скриншот проверки во временном каталоге, не добавляя артефакт в git. Если окружение не
содержит демон с готовой сессией, зафиксировать это ограничение в итоговом отчёте и выполнить
визуальную проверку через существующий UI-kit catalogue или тестовый fixture — не объявлять
непроверенный экран проверенным.

- [ ] **Шаг 4: закрыть документацию и план**

Отметить выполненные checkbox плана. Убедиться, что `docs/ui-kit.md` описывает актуальный набор
иконок, hover/focus-панель, время и копирование, а `docs/README.md` ссылается на дизайн и план.

- [ ] **Шаг 5: повторить проверки после любых правок визуального QA**

```bash
git diff --check
make check
make build
```

Ожидается: три команды завершаются с кодом 0.

- [ ] **Шаг 6: сделать финальный документационный коммит, если остались изменения**

```bash
git add docs/README.md docs/ui-kit.md \
  docs/superpowers/plans/2026-08-05-session-message-actions.md
git commit -m "docs(chat): complete message action toolbar"
```

Если после задач 1–3 и отметок плана изменений нет, отдельный пустой коммит не создавать.
