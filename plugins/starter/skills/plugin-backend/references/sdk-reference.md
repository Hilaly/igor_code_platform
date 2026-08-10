# Backend SDK плагина

## Структура

```text
my-plugin/
  package.json
  src/worker.ts
  agents/<name>/AGENT.md
  skills/<name>/SKILL.md
```

`agents/` и `skills/` необязательны. Для исполняемого плагина `sovereign.worker` обязателен.

## Manifest

| Поле                 | Обязательность | Контракт                                          |
| -------------------- | -------------- | ------------------------------------------------- |
| `sovereign.id`       | обязательно    | `^[a-z0-9][a-z0-9-]*$`, значение `core` запрещено |
| `sovereign.worker`   | обязательно    | путь к server entry                               |
| `sovereign.browser`  | необязательно  | путь к browser entry                              |
| `sovereign.platform` | обязательно    | поддерживаемый range платформы                    |

`sovereign.id` — не npm package name. Он участвует в contribution namespace и маршруте
`/api/p/<plugin-id>/...`. Для worker с ESM imports обязательно `"type": "module"`.

Поддерживаемые platform ranges:

- `*`;
- точный `x.y.z`;
- `^x.y.z`;
- `~x.y.z`;
- `>=x.y.z`.

Составные ranges и prerelease не поддерживаются. Нечитаемый range даёт plugin status `refused`.

## Источники

| Источник               | Расположение                    | По умолчанию |
| ---------------------- | ------------------------------- | ------------ |
| `builtin`              | `plugins/` поставки             | включён      |
| `data`                 | `<data-directory>/plugins/`     | выключен     |
| `project:<project-id>` | `<project>/.sovereign/plugins/` | выключен     |

Plugin key состоит из source и id, например `builtin:starter` или
`project:b7Kq3xv9pQdT:task-plugin`.

## Lifecycle

```ts
import { log, type PluginModule } from "@sovereign/sdk";

export const activate: PluginModule["activate"] = async () => {
  await log.info("plugin is up");
};

export const deactivate: PluginModule["deactivate"] = async () => {
  await log.info("plugin is going down");
};
```

- Worker исполняется в отдельном потоке.
- Все SDK-границы асинхронны.
- Contributions, собранные во время `activate`, применяются одним снимком после успешного возврата.
- Ошибка `activate` сохраняет предыдущий действующий снимок.
- Reload теряет память процесса.
- `deactivate` имеет ограниченное время; важные данные сохраняй до него.

## Импорты SDK

```ts
import {
  contribute,
  defineEvent,
  events,
  log,
  providers,
  sessions,
  storage,
  z,
} from "@sovereign/sdk";
```

### `log`

`log.debug | info | warn | error(message, fields?)` возвращают `Promise<void>`. Source записи
проставляет ядро как `plugin:<id>`.

### `storage`

```ts
await storage.set("last-seen", { id: "42" });
const value = await storage.get("last-seen");
const keys = await storage.keys();
await storage.delete("last-seen");
const directory = await storage.directory();
```

Ключ начинается с `[A-Za-z0-9]`, далее допускает `.`, `-`, `_`, общая длина до 128 символов.
Значение обязано быть JSON-совместимым. Функции, `undefined`, `symbol`, `bigint`, `Map`, `Date` и
циклические ссылки отвергаются.

### `providers`

```ts
const list = await providers.list();
const models = await providers.models("anthropic");
const status = await providers.status("anthropic");
const report = await providers.refresh();
await providers.logout("anthropic");
```

Свой provider регистрируется в `activate`:

```ts
await providers.register({
  id: "vendor-local",
  name: "Vendor Local",
  baseUrl: "http://127.0.0.1:11434/v1",
  api: "openai-completions",
  apiKey: { label: "Vendor key", environmentVariables: ["VENDOR_API_KEY"] },
  models: [{ id: "vendor-large", name: "Vendor Large", contextWindow: 32_000, maxTokens: 4_096 }],
});
```

`api`:

- `openai-completions`;
- `openai-responses`;
- `anthropic-messages`;
- `google-generative-ai`.

Provider credentials через SDK не читаются и не записываются.

### `sessions`

Доступны `agents`, `list`, `create`, `prompt`, `abort`, `entries`, `fork`, `update`, `remove`,
`message`, `stats`, `branch`, `context`, `compact`, `navigate`, `label`.

```ts
const session = await sessions.create({
  projectId: "b7Kq3xv9pQdT",
  agentId: "starter.generic",
});
await sessions.prompt({ sessionId: session.id, text: "что в этом проекте?" });
```

### Events

```ts
const taskCreated = defineEvent("task.created", z.object({ id: z.string() }));

export const activate: PluginModule["activate"] = async () => {
  await contribute.event(taskCreated);

  await contribute.tool({
    id: "create-task",
    description: "Create a task",
    parameters: z.object({ id: z.string() }),
    invoke: async ({ id }) => {
      await taskCreated.publish({ id });
      return `created ${id}`;
    },
  });

  await events.subscribe("tracker.task.updated", async (payload, origin) => {
    await log.debug("task updated", { payload, origin });
  });
};
```

Event declaration начинает действовать после `activate`; tool handler вызывается позднее.
Подписка использует полное имя события без wildcard. Чужой payload непрозрачен, если подписчик не
импортировал и не применил schema publisher’а.

## Contributions

Ядро добавляет namespace ко всем declared ids: `board` плагина `task-plugin` становится
`task-plugin.board`. Объявить contribution в чужом namespace нельзя.

### Agent

```ts
await contribute.agent({
  id: "reviewer",
  title: "Task reviewer",
  instructions: "Review tasks without changing them.",
  tools: { include: ["read"], exclude: [] },
  skills: { include: ["code-review"], exclude: [] },
});
```

Обязательны `id`, `instructions`. Опциональны `title`, `description`, `tools`, `skills`, `model`,
`thinkingLevel`.

### Tool

```ts
await contribute.tool({
  id: "fetch-todo",
  description: "Fetch a todo by id",
  parameters: z.object({ id: z.string() }),
  invoke: async ({ id }) => `todo ${id}`,
});
```

Tool id: `^[a-z0-9][a-z0-9-]{0,63}$`. Результат `invoke`: строка или
`{ content: string; isError?: boolean }`.

### Hook

```ts
await contribute.hook({
  id: "on-turn",
  event: "turn_finished",
  criticality: "advisory",
  handler: async ({ sessionId, usage }) => {
    await log.info("turn done", { sessionId, usage });
  },
});
```

Platform hooks: `session_created`, `session_closed`, `before_session_start`, `turn_finished`,
`permission_request`. Доступны также runtime hooks Pi. `before_session_start` и
`permission_request` могут вернуть `{ refuse: "reason" }`. Default criticality — `advisory`;
default timeout задаётся `hookTimeoutMilliseconds` и равен 5 секундам.

### Routes

```ts
await contribute.route({
  id: "list-items",
  method: "GET",
  path: "items",
  handle: async () => ({ status: 200, body: { items: [] } }),
});

await contribute.publicRoute({
  id: "webhook",
  method: "POST",
  path: "webhook",
  handle: async () => ({ status: 200, body: "ok" }),
});
```

Метод по умолчанию `GET`; поддерживаются `GET | POST | PUT | DELETE`. Обычный route защищён
платформенной session. Public route открыт внешнему вызывающему.

### Color scheme

```ts
await contribute.colorScheme({
  id: "midnight",
  title: "Midnight",
  scheme: {
    tokenContract: 2,
    variants: {
      light: { surface: "#f7f8fa" },
      dark: { surface: "#101218" },
    },
    roleOverrides: { accentHover: "#123456" },
  },
});
```

Форма scheme — публичный `ColorSchemeDocument`: `tokenContract`, `variants`,
опциональный `roleOverrides`.

### Locale catalog

```ts
await contribute.localeCatalog({
  id: "own-ru",
  namespace: "task-plugin",
  locale: "ru",
  messages: { "task.empty": "Задач нет" },
});
```

Namespace может быть `core` для строк платформы или id самого плагина. Чужой namespace запрещён.
Locale канонизируется через `Intl`; пустой messages object отвергается.

### Custom

```ts
await contribute.custom({
  id: "endpoint",
  title: "Endpoint",
  payload: { url: "https://example.invalid" },
});
```

Форму payload понимает plugin-consumer; ядро проверяет общий contribution contract.

## Dependencies

Если внешний plugin source содержит `node_modules`, платформа использует его как есть. Иначе
dependencies устанавливаются через `npm` из `PATH`. Builtin dependencies входят в собранный
артефакт платформы.
