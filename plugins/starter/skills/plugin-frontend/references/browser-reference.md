# Browser SDK плагина

## Entry и singleton

`sovereign.browser` указывает на исходный TypeScript/TSX entry. Демон собирает bundle и отдаёт его
с revision. Публичный root:

```tsx
import {
  Place,
  PlaceCollection,
  PlaceTabs,
  settingsSections,
  useCommands,
  usePageNavigation,
  type Command,
  type PlaceContext,
} from "@sovereign/browser-sdk";
```

Host и plugin получают один runtime-экземпляр browser SDK, поэтому React context общий. Не передавай
plugin identity вручную и не импортируй внутренний host subpath.

## Event bridge и session snapshots

Host уже подписан на единый `/api/events` SSE и передаёт события через frontend bus. Plugin получает
readonly-подписку через `useSovereignEvents()` из публичного `@sovereign/browser-sdk`:

```tsx
import { useEffect } from "react";
import { useSovereignEvents, type PlaceContext } from "@sovereign/browser-sdk";

export function SessionBoard({ context }: { context: PlaceContext }) {
  const events = useSovereignEvents();

  useEffect(() => {
    const sessionId = context.subject?.["sessionId"];
    if (sessionId === undefined) return;
    const reload = () => {
      // Re-fetch the snapshot route and ignore responses below the required revision.
    };
    const unsubscribeEvent = events.subscribe((event) => {
      if (event.type === "core.stream.gap") {
        reload();
        return;
      }
      if (event.type !== "board.changed") return;
      if (event.payload.sessionId !== sessionId) return;
      // Raise the required revision to event.payload.revision before re-fetching.
      reload();
    });
    const unsubscribeRecovery = events.subscribeRecovery?.(reload);
    return () => {
      unsubscribeEvent();
      unsubscribeRecovery?.();
    };
  }, [context.subject, events]);

  return null;
}
```

Компонент должен получить snapshot при mount и смене `sessionId`, а также после reconnect или
обнаруженного разрыва последовательности событий. Событие содержит только ключ инвалидации
(`sessionId`, `revision`); не держи в нём полное состояние. Не создавай второй `EventSource`, не
вызывай `/api/events` напрямую и не используй polling — bus уже разделяется между host и plugins.

## Core places

| Place                       | Cardinality | Replaceable | Context              |
| --------------------------- | ----------- | ----------- | -------------------- |
| `core.session.chat`         | single      | да          | `sessionId`          |
| `core.session.new`          | single      | да          | —                    |
| `core.settings.projects`    | single      | да          | `view`, `projectId`  |
| `core.settings.appearance`  | single      | да          | —                    |
| `core.settings.usage`       | single      | да          | —                    |
| `core.settings.providers`   | single      | да          | `view`, `providerId` |
| `core.settings.plugins`     | single      | да          | `view`, `pluginKey`  |
| `core.settings.daemon`      | single      | да          | —                    |
| `core.settings.diagnostics` | single      | да          | —                    |
| `core.sidebar.sections`     | collection  | нет         | `page`, `sessionId`  |
| `core.panel.tabs`           | tabs        | нет         | `page`, `sessionId`  |
| `core.view.header.actions`  | action      | нет         | `page`, `sessionId`  |

Динамическое семейство `core.session.tool-call.t-<hex-tool-name>` создаёт replaceable single place
для конкретного tool call.

Cardinality:

- `single` — одно view, может быть replaceable;
- `collection` — упорядоченный набор строк/секций;
- `action` — полоса компонентов и command buttons;
- `tabs` — полоса вкладок, смонтирована выбранная.

## `contribute.place`

```ts
await contribute.place({
  id: "board",
  title: "Board",
  cardinality: "single",
  replaceable: true,
  builtIn: "Board",
});
```

Replaceable может быть только `single`; у него обязателен `builtIn` — имя React component export в
browser bundle владельца place.

Незаменяемые places:

```ts
await contribute.place({
  id: "board-actions",
  title: "Board actions",
  cardinality: "action",
  replaceable: false,
});
```

## `contribute.component`

```ts
await contribute.component({
  id: "plugins-panel",
  title: "Plugins panel",
  placeId: "core.settings.plugins",
  export: "PluginsPanel",
  group: "tools",
  order: 1,
});
```

Place может появиться после contribution: существование при регистрации не проверяется.
Упорядочивание: `group`, затем `order`, затем contribution id.

Component export:

```tsx
import type { PlaceContext } from "@sovereign/browser-sdk";
import type { ReactNode } from "react";

export function PluginsPanel({ context }: { context: PlaceContext }): ReactNode {
  return <section>view: {context.subject?.["view"] ?? "unknown"}</section>;
}
```

Условие видимости реализуется самим компонентом через `return null`.

## `contribute.command`

```ts
await contribute.command({
  id: "run",
  title: "Run the board",
  export: "RunCommand",
  placeId: "core.view.header.actions",
  group: "tools",
  order: 1,
});
```

Команда попадает в command palette и доступна по id независимо от `placeId`. Если `placeId` указан,
он дополнительно размещает команду в известном action place; другие кардинальности недопустимы.

Browser export:

```ts
import type { Command } from "@sovereign/browser-sdk";

export const RunCommand: Command = {
  available: (context) => context.subject?.["page"] !== "session-archive",
  run: async (context) => {
    await fetch("/api/p/task-plugin/run", {
      method: "POST",
      body: JSON.stringify({ project: context.project }),
    });
  },
};
```

`available` выключает кнопку, но не скрывает её. `run` может быть sync или async. Host преобразует
результат в `done`, `unavailable`, `unknown` или `failed`; исключение не выбрасывается в React tree.

Вызов из другого компонента:

```tsx
import { useCommands, type PlaceContext } from "@sovereign/browser-sdk";
import type { ReactNode } from "react";

export function RunAgain({ context }: { context: PlaceContext }): ReactNode {
  const { invoke } = useCommands();

  return (
    <button
      onClick={() => {
        void invoke("task-plugin.run", context);
      }}
    >
      Run
    </button>
  );
}
```

## `contribute.page`

```ts
await contribute.page({
  id: "log",
  title: "Task log",
  export: "LogPage",
});
```

Адрес: `/p/<plugin-id>/<page-id>/*`. Полей `path` и `route` нет.

```tsx
import { usePageNavigation } from "@sovereign/browser-sdk";
import type { ReactNode } from "react";

export function LogPage(): ReactNode {
  const navigation = usePageNavigation();

  return (
    <section>
      <div>base: {navigation.basePath}</div>
      <div>path: {navigation.path}</div>
      <button onClick={() => navigation.navigate("entry/42")}>Open entry</button>
      <button
        onClick={() =>
          navigation.navigate(navigation.path, {
            query: { filter: "warn" },
            replace: true,
          })
        }
      >
        Filter
      </button>
      <button onClick={() => navigation.navigateCore({ kind: "settings", section: "plugins" })}>
        Plugin settings
      </button>
    </section>
  );
}
```

`navigate` работает относительно plugin page. `navigateCore` переходит в известный core
destination.

## Nested places

```tsx
import { Place, PlaceCollection, PlaceTabs, type PlaceContext } from "@sovereign/browser-sdk";
import type { ReactNode } from "react";

export function Board({ context }: { context: PlaceContext }): ReactNode {
  return (
    <section>
      <Place id="task-plugin.board" context={context} />
      <PlaceCollection id="task-plugin.board-actions" context={context} />
      <PlaceTabs id="task-plugin.board-tabs" context={context} />
    </section>
  );
}
```

Используй component, соответствующий cardinality объявленного place, и передавай context,
относящийся к текущему экрану.
