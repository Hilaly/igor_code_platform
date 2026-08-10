---
name: plugin-frontend
description: Build a Sovereign plugin with a browser bundle — sovereign.browser entry, browser SDK, and UI contributions (place, component, command, page)
---

# Фронтенд плагина: браузерный бандл и вклады с интерфейсом

Когда плагин приносит интерфейс, он объявляет точку входа `sovereign.browser`. Демон собирает
браузерный бандл и отдаёт его по адресу с ревизией. Этот скил описывает вклады, требующие браузерного
бандла: `place`, `component`, `command`, `page`. Вклады без интерфейса — в скиле `plugin-backend`.

## Точка входа и сборка

`sovereign.browser` — путь к браузерной точке входа в `package.json`:

```json
{
  "sovereign": {
    "id": "my-plugin",
    "worker": "src/worker.ts",
    "browser": "src/browser.tsx",
    "platform": "^0.1.0"
  }
}
```

Сборку и выдачу ассетов делает демон; автор пишет исходники, как и для worker-части. Плагин без
`sovereign.browser` не может предложить компонент, команду или страницу.

## Browser SDK

Импорт из `@sovereign/browser-sdk`:

```tsx
import {
  Place,
  PlaceCollection,
  PlaceTabs,
  settingsSections,
  usePageNavigation,
} from "@sovereign/browser-sdk";
```

Корневой `@sovereign/browser-sdk` — синглтон страницы из реестра модулей хоста. Оболочка и плагин
получают exports из одного runtime-экземпляра SDK, поэтому React context общий для provider оболочки
и компонентов плагина. Передавать идентичность плагина аргументом не нужно.

## Core places

Места ядра, куда плагин может положить вклад (адресуются по `placeId`):

| Place                       | Кардинальность | Заменяемо | Контекст             |
| --------------------------- | -------------- | --------- | -------------------- |
| `core.session.chat`         | single         | да        | `sessionId`          |
| `core.session.new`          | single         | да        | —                    |
| `core.settings.projects`    | single         | да        | `view`, `projectId`  |
| `core.settings.appearance`  | single         | да        | —                    |
| `core.settings.usage`       | single         | да        | —                    |
| `core.settings.providers`   | single         | да        | `view`, `providerId` |
| `core.settings.plugins`     | single         | да        | `view`, `pluginKey`  |
| `core.settings.daemon`      | single         | да        | —                    |
| `core.settings.diagnostics` | single         | да        | —                    |
| `core.sidebar.sections`     | collection     | нет       | `page`               |
| `core.panel.tabs`           | tabs           | нет       | `page`               |
| `core.view.header.actions`  | action         | нет       | `page`               |

Динамическое семейство `core.session.tool-call.t-<hex-имя-инструмента>` — отдельное заменяемое место
на каждый вызов инструмента, образуется из имени инструмента; оно не входит в список core places.

Кардинальности: `single` (одно вью), `collection` (полоса строк), `action` (полоса кнопок), `tabs`
(полоса вкладок, отрисован один).

## `contribute.place`

Опубликовать своё место расширения. У заменяемого места обязателен встроенный провайдер (`builtIn`):

```ts
await contribute.place({
  id: "board",
  title: "Board",
  cardinality: "single", // single | collection | action | tabs
  replaceable: true,
  builtIn: "Board", // имя экспорта в браузерном бандле владельца места
});
```

Заменяемым бывает только одиночное место. Места однородны: плагин расширяется другим плагином через
то же место.

## `contribute.component`

Занять место компонентом. `placeId` указывает, куда; `export` — имя экспорта в браузерном бандле.
Существование места при регистрации не проверяется — вклад ждёт, если место ещё не появилось.

```ts
await contribute.component({
  id: "plugins-panel",
  title: "Plugins panel",
  placeId: "core.settings.plugins",
  export: "PluginsPanel",
  group: "tools", // необязательно: порядок — group, затем order, затем id
  order: 1,
});
```

Займёт компонент место или встанет рядом — решает кардинальность места, а не намерение вклада.

## `contribute.command`

Именованное действие. Обязателен `title` — команда рисуется кнопкой и строкой палитры до загрузки
бандла, иначе полоса действий прыгала бы по мере подъёма плагинов.

```ts
await contribute.command({
  id: "run",
  title: "Run the board",
  export: "RunCommand", // имя экспорта в браузерном бандле
  placeId: "core.view.header.actions", // необязательно; если есть — обязано быть action
  group: "tools",
  order: 1,
});
```

Без `placeId` команда живёт в палитре и вызывается по идентификатору, в том числе чужим плагином.

## `contribute.page`

Целый экран плагина на собственном адресе `/p/<pluginId>/<pageId>/*`:

```ts
await contribute.page({
  id: "log", // он же сегмент адреса: /p/<pluginId>/log
  title: "Log", // обязательно: страница представлена ссылкой и шапкой до загрузки кода
  export: "LogPage", // имя экспорта в браузерном бандле
});
```

Пути в объявлении нет — адрес выводится из идентификаторов. Для навигации внутри страницы — хук
`usePageNavigation` из browser SDK (базовый путь, относительный путь, параметры, переходы).

## Рабочий пример

### `src/worker.ts`

```ts
import { contribute, type PluginModule } from "@sovereign/sdk";

export const activate: PluginModule["activate"] = async () => {
  await contribute.page({
    id: "log",
    title: "Log",
    export: "LogPage",
  });

  await contribute.command({
    id: "clear-log",
    title: "Clear log",
    export: "ClearLogCommand",
    placeId: "core.view.header.actions",
  });

  await contribute.component({
    id: "sidebar-shortcut",
    title: "Log shortcut",
    placeId: "core.sidebar.sections",
    export: "LogShortcut",
  });
};
```

### `src/browser.tsx`

```tsx
import type { ReactNode } from "react";
import { usePageNavigation } from "@sovereign/browser-sdk";

export function LogPage(): ReactNode {
  const { path } = usePageNavigation();
  return <section>log at {path}</section>;
}

export function ClearLogCommand(): ReactNode {
  return null; // команда отрисуется оболочкой; обработчик — по имени экспорта
}

export function LogShortcut(): ReactNode {
  return <a href="/p/my-plugin/log">Open log</a>;
}
```

## Чек-лист фронтенд-плагина

1. `sovereign.browser` в манифесте — путь к браузерной точке входа.
2. `src/browser.tsx` с именованными экспортами под каждый `export`, указанный в вкладах.
3. Вклады `place`/`component`/`command`/`page` — в `activate`, через `contribute.*`.
4. Компоненты используют `@sovereign/browser-sdk` (`Place`, `PlaceCollection`, `PlaceTabs`,
   `usePageNavigation`, `settingsSections`).
5. Для страницы — `contribute.page` с обязательными `id`, `title`, `export`.
6. Команды с `placeId` — только в место кардинальности `action`.
