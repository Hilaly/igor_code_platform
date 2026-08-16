---
name: plugin-frontend
description: Use when a Sovereign plugin needs browser UI, a browser entry, page, place, component, command, core-place integration, browser SDK context, or navigation inside its own route.
---

# Фронтенд плагина

Browser-часть дополняет worker: manifest объявляет `sovereign.browser`, worker регистрирует
serializable contribution, а browser bundle экспортирует названный React-компонент или descriptor
команды.

**Главный принцип:** worker объявляет данные и имена exports; browser entry реализует exports в
том же runtime-экземпляре `@sovereign/browser-sdk`, который использует host.

Сначала примени `starter.plugin-backend`: browser entry не заменяет обязательные manifest,
worker и lifecycle.

## Рабочий процесс

1. **Добавь `sovereign.browser`.** Укажи путь к TypeScript/TSX entry в том же manifest, где уже есть
   worker.
2. **Выбери contribution.**
   - `component` занимает существующее place.
   - `place` публикует новую точку расширения.
   - `command` объявляет именованное действие и попадает в палитру независимо от `placeId`;
     `placeId: "core.session.slash"` дополнительно помещает его в каталог `/` текущей сессии.
   - `page` создаёт экран `/p/<plugin-id>/<page-id>/*`.
3. **Зарегистрируй contribution в `activate`.** `export` — точное имя browser export.
4. **Реализуй export правильной формы.**
   - Component/page/built-in place — React component.
   - Command — объект `Command` с методом `run`, не React component.
5. **Передай context.** Компоненты places получают `PlaceContext`; вложенные places вызывай с тем
   же релевантным context.
6. **Подписывайся на host event bridge, а не создавай transport.** Используй `useSovereignEvents()`
   для подписки на уже существующую frontend bus. Host держит ровно один `/api/events` SSE; plugin
   не создаёт свой `EventSource` и не опрашивает route по таймеру.
7. **После события перечитывай snapshot через route.** Фильтруй событие по текущему
   `context.subject?.sessionId`, игнорируй revision не новее локальной и после mount, смены сессии,
   reconnect или обнаруженного gap выполняй GET snapshot. Route — источник истины, событие лишь
   invalidation.
8. **Используй browser SDK.** `Place`, `PlaceCollection`, `PlaceTabs`, `useCommands`,
   `usePageNavigation`, `useTranslator` импортируются из `@sovereign/browser-sdk`.
9. **Собери интерфейс из UI-кита.** Примитивы `@sovereign/ui-kit` и токены `--sovereign-*`; своих
   цветов, кеглей и шрифтов в CSS плагина нет. Каждый `className` разметки обязан быть описан в
   таблице стилей, которую импортирует entry: неописанный класс не ошибка сборки, а сбитая вёрстка,
   которую видно только глазом.
10. **Локализуй строки.** Каталоги объявляет worker (`contribute.localeCatalog`), панель берёт
    переводчик хуком `useTranslator(<id плагина>)`. Строк в браузерном bundle нет, своей настройки
    языка у плагина нет, за локалью он никуда не ходит. Даты и числа — `formatDate`/`formatNumber`
    того же переводчика.
11. **Проверь failure states.** Неверное имя export, ошибка bundle и exception команды должны
    отображаться как diagnostics/outcome, а не маскироваться пустым UI.
12. **Собери и проверь.** Typecheck worker и browser entry, запусти plugin, открой contribution и
    вызови каждую command минимум один раз. Посмотри на результат в обоих языках: непереведённая
    строка и разъехавшаяся вёрстка тестами не ловятся.

## Manifest

```json
{
  "sovereign": {
    "id": "task-plugin",
    "worker": "src/worker.ts",
    "browser": "src/browser.tsx",
    "platform": "^0.1.0"
  }
}
```

## Worker

```ts
import { contribute, type PluginModule } from "@sovereign/sdk";

export const activate: PluginModule["activate"] = async () => {
  // Каталог объявляется до вкладов, которые он подписывает: `<вид>.<id вклада>.title` — ключ
  // заголовка, который человек увидит на месте.
  await contribute.localeCatalog({
    id: "messages-en",
    namespace: "task-plugin",
    locale: "en",
    messages: { "page.log.title": "Task log", "command.review.title": "Review this session" },
  });

  await contribute.page({
    id: "log",
    title: "Task log",
    export: "LogPage",
  });

  await contribute.command({
    id: "review",
    title: "Review this session",
    export: "ReviewCommand",
    placeId: "core.session.slash",
  });

  await contribute.route({
    id: "review",
    method: "POST",
    path: "review",
    handle: async () => ({ status: 204 }),
  });
};
```

## Browser entry

```tsx
import {
  usePageNavigation,
  useTranslator,
  type Command,
  type PlaceContext,
} from "@sovereign/browser-sdk";
import type { ReactNode } from "react";

export function LogPage({ context }: { context: PlaceContext }): ReactNode {
  const navigation = usePageNavigation();
  // Неймспейс — идентификатор плагина: тот же, что объявлен каталогом в worker.
  const translator = useTranslator("task-plugin");

  return (
    <section>
      <h2>{translator.t("page.log.title")}</h2>
      project: {context.project ?? "none"}, path: {navigation.path}
    </section>
  );
}

export const ReviewCommand: Command = {
  run: async (context) => {
    const sessionId = context.subject?.sessionId;
    const project = context.project;
    if (sessionId === undefined) {
      throw new Error("the command needs an open session");
    }
    const response = await fetch(
      `/api/p/task-plugin/review?session=${encodeURIComponent(sessionId)}`,
      {
        method: "POST",
        body: JSON.stringify({ project }),
        headers: { "content-type": "application/json" },
      },
    );
    if (!response.ok) {
      throw new Error(`review failed: ${response.status}`);
    }
  },
};
```

Host добавляет slash-команду в каталог как `/<pluginId>.<id>`, загружает export и вызывает
`ReviewCommand.run(context)`. Контекст содержит текущую сессию и её проект; не собирай адрес
сессии вручную из location. Возвращать JSX из command export не нужно.

## Проверка перед завершением

- browser path существует и собирается;
- каждый contribution `export` совпадает с именованным browser export;
- command export соответствует `Command`;
- component и page принимают ожидаемый context;
- command с `placeId` указывает только на action place; для каталога сессии используй
  `core.session.slash`;
- `Command.run(context)` использует текущие `context.subject.sessionId` и `project`, а отказ backend route не
  проглатывается;
- replaceable place имеет cardinality `single` и `builtIn`;
- page использует `usePageNavigation`, а не собирает base path вручную;
- каталоги объявлены worker'ом, а в браузерном bundle нет ни строк, ни своей `Intl`, ни запроса за
  локалью;
- у каждого вклада, чей заголовок видит человек, в каталоге есть ключ `<вид>.<id вклада>.title`;
- каждому `className` разметки соответствует правило в импортированной таблице стилей, а цвета и
  кегли в ней — токены `--sovereign-*`;
- loading, missing export и thrown command видны пользователю;
- tests/typecheck и фактический browser smoke test проходят.

## Частые ошибки

- **Command экспортируется функцией-компонентом.** Runtime ищет `{ run, available? }` и сообщит,
  что command export отсутствует.
- **Worker и browser используют разные имена export.** Contribution зарегистрируется, но host не
  найдёт реализацию.
- **Компонент объявлен без browser entry.** Worker contribution не переносит React-код.
- **`placeId` команды указывает на collection/single/tabs.** Команда с местом допустима только в
  cardinality `action`.
- **Plugin page получает произвольный path из manifest.** Адрес выводится из plugin id и page id.
- **Core places копируются по памяти.** Сверяй id и cardinality со справочником.
- **Browser SDK бандлится второй копией.** Импортируй публичный root; host предоставляет singleton.
- **Строки зашиты в браузерный код.** Панель заговорит по-английски у человека, выбравшего другой
  язык. Каталог объявляет worker, а импорт модуля сообщений в entry заводит второй их экземпляр,
  который разойдётся с объявленным.
- **Заголовок вклада не переведён.** `title` в объявлении — текст на языке автора; на языке окна
  вклад говорит только через ключ `<вид>.<id вклада>.title` в каталоге.
- **Дата собрана своей `Intl`.** Она возьмёт локаль браузера, и в русской строке встанет английская
  дата. Форматируй `translator.formatDate`.
- **Разметка ссылается на классы, которых нет в CSS.** Сборка об этом не скажет: контейнеры
  схлопнутся в поток строк, и увидит это только тот, кто открыл панель.
- **Примитив взят в регистре чужого места.** Компонент, нарисованный для раздела настроек, в плотной
  панели выглядит крупнее всего вокруг. У примитивов кита для этого есть `size`.

Core places, cardinality и точные browser contracts:
[справочник browser SDK](references/browser-reference.md).
