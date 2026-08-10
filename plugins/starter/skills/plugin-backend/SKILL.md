---
name: plugin-backend
description: Build a Sovereign plugin with TypeScript worker code — manifest, lifecycle, SDK storage/providers/sessions, and backend contributions (agent, tool, hook, event, route, colorScheme, localeCatalog, custom)
---

# Бэкенд плагина: worker и вклады без браузерной части

Плагин без интерфейса — это `package.json` с полем `sovereign` и worker на TypeScript. Никакой
сборки перед установкой не требуется: платформа исполняет TypeScript как есть. Этот скил описывает
устройство плагина «без браузера»: манифест, жизненный цикл, SDK и вклады, не требующие браузерного
бандла. Вклады, требующие интерфейса (`place`, `component`, `command`, `page`), — в скиле
`plugin-frontend`.

## Структура плагина

```
my-plugin/
  package.json        манифест: поле sovereign
  src/worker.ts       серверная точка входа
  agents/<name>/AGENT.md   файловые агенты (см. скил creating-agents)
  skills/<name>/SKILL.md   файловые скилы  (см. скил creating-skills)
```

Каталог `agents/` и `skills/` необязательны, точка входа `worker` — обязательна.

## Манифест

Поле `sovereign` в `package.json`:

| Поле                 | Обязательность | Значение                                              |
| -------------------- | -------------- | ----------------------------------------------------- |
| `sovereign.id`       | обязательно    | идентификатор `^[a-z0-9][a-z0-9-]*$`; `core` запрещён |
| `sovereign.worker`   | обязательно    | путь к серверной точке входа                          |
| `sovereign.browser`  | необязательно  | путь к браузерной точке входа (см. plugin-frontend)   |
| `sovereign.platform` | обязательно    | диапазон версий платформы                             |

`sovereign.id` — не npm-имя: оно попадает в маршрут `/api/p/<id>/...`. `"type": "module"` обязателен
— без него Node читает точку входа как CommonJS, и импорты не работают.

```json
{
  "name": "@someone/my-plugin",
  "version": "1.0.0",
  "type": "module",
  "sovereign": {
    "id": "my-plugin",
    "worker": "src/worker.ts",
    "platform": "^0.1.0"
  }
}
```

### Диапазон версий

Читается как `*`, точный `x.y.z`, `^x.y.z`, `~x.y.z`, `>=x.y.z`. Составные диапазоны и предрелизы не
поддерживаются. `^` ведёт себя как в npm: на нулевом мажоре ломающим считается минор. Нечитаемая
запись — отказ (`refused`), а не молчаливое «подходит».

## Источники

| Источник               | Где                                   | По умолчанию |
| ---------------------- | ------------------------------------- | ------------ |
| `builtin`              | `plugins/` в поставке                 | включён      |
| `data`                 | `<директория данных>/plugins/`        | выключен     |
| `project:<id проекта>` | `.sovereign/plugins/` в папке проекта | выключен     |

Встроенный включён сразу; любой другой ждёт явного включения. Ключ плагина — `<источник>:<id>`,
например `builtin:my-plugin` или `project:b7Kq3xv9pQdT:my-plugin`.

## Жизненный цикл

Worker — это модуль с обязательным `activate` и опциональным `deactivate`. **Всё асинхронно:** граница
воркера физически асинхронна, между потоками ходят сообщения, а не вызовы.

```ts
import { log, type PluginModule } from "@sovereign/sdk";

export const activate: PluginModule["activate"] = async () => {
  await log.info("my-plugin is up");
};

export const deactivate: PluginModule["deactivate"] = async () => {
  await log.info("my-plugin is going down");
};
```

- Код плагина исполняется в своём воркере (изолированный поток). Перезапуск теряет всё, что плагин
  держал в памяти: плагин обязан восстанавливаться из данных, а не из состояния процесса.
- Регистрация вкладов применяется **одним снимком после успешного `activate`**: наблюдатель видит
  либо прежний набор, либо новый целиком.
- SDK берётся импортом, а не аргументом. Идентичность плагина приходит из воркера, а не из кода:
  объявить себя другим плагином нельзя.
- Правка исходников включённого плагина перезагружает его, не трогая демон.

## SDK

Импортируется из `@sovereign/sdk`:

```ts
import {
  contribute,
  defineEvent,
  events,
  log,
  providers,
  storage,
  sessions,
  z,
} from "@sovereign/sdk";
```

### `log`

`log.debug | info | warn | error(message, fields?)`. Источник записи проставляет ядро (`plugin:<id>`),
записи уходят в `stdout` демона.

### `storage` — ключ-значение и папка

```ts
await storage.set("last-seen", { id: "42" });
const value = await storage.get("last-seen"); // undefined, если не клали
const keys = await storage.keys();
await storage.delete("last-seen");
const folder = await storage.directory(); // абсолютный путь к папке плагина
```

Ключ: `[A-Za-z0-9]`, затем `.`, `-`, `_`, до 128 символов. Значение — любая JSON-совместимая величина.
Функции, `undefined`, `symbol`, `bigint`, `Map`, `Date` и циклические ссылки отказываются на месте
вызова. Ключ хранилища — `источник + идентификатор`, поэтому перекрывающий плагин имеет отдельное
состояние.

### `providers` — LLM-провайдеры

```ts
const list = await providers.list();
const models = await providers.models("anthropic");
const status = await providers.status("anthropic");
const report = await providers.refresh();
await providers.logout("anthropic");
```

Свой провайдер регистрируется в `activate` и живёт, пока жив плагин:

```ts
await providers.register({
  id: "vendor-local",
  name: "Vendor Local",
  baseUrl: "http://127.0.0.1:11434/v1",
  api: "openai-completions",
  apiKey: { label: "Vendor key" },
  models: [{ id: "vendor-large", name: "Vendor Large", contextWindow: 32_000, maxTokens: 4_096 }],
});
```

`api` — одно из `openai-completions | openai-responses | anthropic-messages | google-generative-ai`.
Занятый идентификатор — отказ, а не замена. Значение креда через SDK не читается и не записывается.

### `sessions` — агентные сессии

Тот же набор операций, что и у веб-API: `agents`, `list`, `create`, `prompt`, `abort`, `entries`,
`fork`, `update`, `remove`, `message`, `stats`, `branch`, `context`, `compact`, `navigate`, `label`.

```ts
const session = await sessions.create({ projectId: "b7Kq3xv9pQdT", agentId: "starter.generic" });
await sessions.prompt({ sessionId: session.id, text: "что в этом проекте?" });
```

### `events` и `defineEvent`

```ts
const taskCreated = defineEvent("task.created", z.object({ id: z.string() }));

await contribute.event(taskCreated); // объявление
await taskCreated.publish({ id: "42" }); // публикация с проверкой по схеме

await events.subscribe("tracker.task.created", (payload, origin) => {
  // payload непрозрачен: чужой контракт мог измениться
});
```

Схема пишется на `zod`, и `z` берётся из SDK. Подписка — по точному полному имени, без масок;
возвращает отписку. Подписка на необъявленное событие — не ошибка.

## Вклады без браузерной части

Все вклады применяются одним снимком после `activate`. У каждого вклада ядро даёт неймспейс:
объявленный `board` становится `<plugin-id>.board`. Объявить вклад в чужом неймспейсе нельзя;
неймспейс `core` недоступен. Каждый вклад переключается человеком по отдельности.

### `contribute.agent`

Программный агент. Обязательные поля: `id`, `instructions`. Необязательные: `title`, `description`,
`tools`/`skills` (селекторы), `model`, `thinkingLevel`. Умолчаний SDK не подставляет.

```ts
await contribute.agent({
  id: "agent",
  title: "Base agent",
  instructions: "…системный промпт…",
  tools: { include: ["*"], exclude: ["bash"] },
  skills: { include: ["review-*"], exclude: ["*-unsafe"] },
});
```

### `contribute.tool`

Инструмент для модели. `id` — одновременно имя, которым инструмент зовёт модель; шаблон имени
`^[a-z0-9][a-z0-9-]{0,63}$`, точка-неймспейс в имя не ставится.

```ts
await contribute.tool({
  id: "fetch-todo",
  description: "Fetch a todo by id",
  parameters: z.object({ id: z.string() }),
  invoke: async ({ id }) => `todo ${id}`,
});
```

Результат `invoke` — строка или `{ content: string; isError?: boolean }`. Поле `isError: true`
подсказывает модели, что ответ инструмента — ошибка, а не успешный результат.

### `contribute.hook`

Подписка на событие рантайма (32 события Pi) или на платформенный хук (5 подписываемых:
`session_created`, `session_closed`, `before_session_start`, `turn_finished`, `permission_request`).
Обработчик остаётся в воркере.

```ts
await contribute.hook({
  id: "on-turn",
  event: "turn_finished",
  criticality: "advisory", // или "critical"
  handler: async ({ sessionId, usage }) => {
    await log.info("turn done", { sessionId, usage });
  },
});
```

`criticality` определяет поведение при таймауте обработчика; `before_session_start` и
`permission_request` могут отказать (`{ refuse: "причина" }`), остальные observing. Таймаут хука —
5 секунд по умолчанию (`hookTimeoutMilliseconds`).

### `contribute.event`

Объявляет событие шины. До объявления публикация невозможна. См. пример выше.

### `contribute.route` и `contribute.publicRoute`

HTTP-маршруты на `/api/p/<pluginId>/<path>`. Обычный маршрут защищён сессией по построению;
публичный — единственная поверхность, открытая наружу, и ответственность за неё на авторе.

```ts
await contribute.route({
  id: "list-items",
  method: "GET",
  path: "items",
  handle: async (request) => ({ status: 200, body: { items: [...] } }),
});

await contribute.publicRoute({
  id: "webhook",
  method: "POST",
  path: "webhook",
  handle: async (request) => ({ status: 200, body: "ok" }),
});
```

`method` по умолчанию `GET`; поддерживаются `GET | POST | PUT | DELETE`. Тело запроса и параметры
разбирает диспетчер.

### `contribute.colorScheme`

Цветовая схема — чистые данные, браузерного кода не требует. Форма документа схемы описана в
`docs/ui-kit.md`.

```ts
await contribute.colorScheme({
  id: "midnight",
  title: "Midnight",
  scheme: {
    tokenContract: 2,
    variants: { light: { surface: "#f7f8fa" }, dark: { surface: "#101218" } },
    roleOverrides: { accentHover: "#123456" },
  },
});
```

### `contribute.localeCatalog`

Каталог сообщений. `namespace` объявляется явно: `core` — для строк платформы (так платформе
добавляется язык), идентификатор плагина — для строк самого плагина. Чужой неймспейс запрещён.

```ts
await contribute.localeCatalog({
  id: "own-ru",
  namespace: "my-plugin",
  locale: "ru",
  messages: { "appearance.scheme.midnight": "Полночь" },
});
```

Тег локали канонизируется через `Intl` (`pt-br` → `pt-BR`). Пустой каталог отвергается.

### `contribute.custom`

Вклад для расширения другого плагина, а не ядра. Ядро проверяет идентификатор и переключаемость,
а форму полезной нагрузки понимает потребитель.

```ts
await contribute.custom({ id: "endpoint", title: "Endpoint", payload: { url: "…" } });
```

## Зависимости

Внешний плагин может пользоваться npm-зависимостями: если `node_modules` есть, платформа не трогает
ничего; если нет — ставит `dependencies` через `npm` из `PATH` отдельным этапом жизненного цикла. У
встроенных плагинов этого этапа нет: их зависимости решаются при сборке артефакта.

## Чек-лист бэкенд-плагина

1. `package.json` с полем `sovereign` (`id`, `worker`, `platform`) и `"type": "module"`.
2. `src/worker.ts` с `activate`. Вклады — через `contribute.*` внутри `activate`.
3. Файловые `agents/` и `skills/` — при необходимости, отдельными директориями.
4. `storage` для состояния, своя папка — для файлов.
5. `sessions.*`, `providers.*`, `events.subscribe`/`defineEvent` — для интеграции с ядром.
6. Внешние npm-зависимости — в `dependencies` или в привезённом `node_modules`.
