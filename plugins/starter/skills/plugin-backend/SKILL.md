---
name: plugin-backend
description: Use when creating or changing a Sovereign plugin worker, package manifest, backend SDK integration, lifecycle, storage, provider, session operation, or non-UI contribution such as an agent, tool, hook, event, route, color scheme, locale catalog, or custom payload; also when declaring a browser-backed command contribution.
---

# Бэкенд плагина

Исполняемый плагин — ESM-пакет с `sovereign` manifest и TypeScript worker. Worker живёт в
изолированном потоке, общается с ядром только через асинхронный `@sovereign/sdk` и теряет память
процесса при перезапуске.

**Главный принцип:** `activate` декларативно собирает новый снимок плагина; долговременное состояние
живёт в `storage`, а внешние эффекты выполняются только через явные SDK-контракты.

Если плагину нужен browser UI, сначала собери backend-основу по этому скилу, затем прочитай
`starter.plugin-frontend`.

## Рабочий процесс

1. **Создай manifest.** Обязательны `"type": "module"` и `sovereign.id`, `worker`, `platform`.
2. **Добавь `activate`.** Экспортируй функцию типа `PluginModule["activate"]`; все SDK-вызовы
   асинхронны.
3. **Зарегистрируй вклады.** Делай `await contribute.*` внутри `activate`. Ядро применит их одним
   снимком только после успешного возврата.
4. **Не публикуй только что объявленное событие напрямую в `activate`.** До применения снимка оно
   ещё не действует. Публикуй из route, tool, hook или другого обработчика, вызванного позже.
5. **Не держи важное состояние в памяти worker.** Используй `storage` для JSON-совместимых значений
   и `storage.directory()` для файлов.
6. **Для изменяемого состояния используй route как источник истины и событие как invalidation.**
   Обработчик сначала записывает новый snapshot в `storage`, затем публикует событие с минимальным
   payload (обычно `sessionId` и `revision`). Клиент после события перечитывает snapshot через route;
   событие не дублирует состояние.
7. **Не добавляй polling API.** Объяви session-protected GET route для snapshot и событие изменения.
   Публикуй событие только после успешной записи; при ошибке записи состояние и событие не должны
   измениться.
8. **Ограничь внешнюю поверхность.** Предпочитай session-protected `contribute.route`;
   `publicRoute` требует собственной аутентификации, валидации и защиты от повторов.
9. **Добавляй browser-вклады только вместе с `sovereign.browser`.** `place`, `component`, `command`
   и `page` требуют browser bundle. Вклад `command` объявляется здесь, но его обработчик не живёт
   в worker: за browser export обратись к `starter.plugin-frontend`.
10. **Проверь плагин.** Запусти его tests/typecheck, включи источник, дождись состояния running и
   проверь contributions и diagnostics.

## Минимальный manifest

```json
{
  "name": "@someone/task-plugin",
  "version": "1.0.0",
  "type": "module",
  "sovereign": {
    "id": "task-plugin",
    "worker": "src/worker.ts",
    "browser": "src/browser.tsx",
    "platform": "^0.1.0"
  }
}
```

## Минимальный worker с событием, route и slash-командой

```ts
import { contribute, defineEvent, log, z, type PluginModule } from "@sovereign/sdk";

const taskCreated = defineEvent("task.created", z.object({ id: z.string() }));

export const activate: PluginModule["activate"] = async () => {
  await contribute.event(taskCreated);

  await contribute.route({
    id: "create-task",
    method: "POST",
    path: "tasks",
    handle: async () => {
      const task = { id: crypto.randomUUID() };
      await taskCreated.publish(task);
      return { status: 201, body: task };
    },
  });

  await contribute.command({
    id: "review",
    title: "Review this session",
    export: "ReviewCommand",
    placeId: "core.session.slash",
  });

  await log.info("task-plugin is active");
};
```

Route вызывается после активации, поэтому к моменту `publish` вклад события уже действует. Если
вклад события выключен человеком или проиграл спор источников, публикация будет отклонена и
записана в журнал.

## Проверка перед завершением

- manifest читается, platform range поддерживается, worker path существует;
- `activate` завершается и не публикует ещё не применённые contributions;
- важное состояние восстанавливается после reload;
- tool schemas и route input проверяют внешние данные;
- `publicRoute` не полагается на session protection;
- browser contributions не объявлены без browser entry;
- tests, typecheck и фактический запуск проходят;
- plugin status и contribution problems просмотрены;
- внешняя dependency и причина её выбора документированы в проекте.

## Частые ошибки

- **Публикация события сразу после `contribute.event`.** Регистрация ещё находится в строящемся
  снимке. Перенеси публикацию в вызываемый после activation handler.
- **Состояние хранится в module variable.** Reload worker его уничтожит.
- **Забыто `await`.** RPC-операция может завершиться после `activate`, потеряться при reload или
  скрыть отказ.
- **`publicRoute` считают обычным route.** Это единственная поверхность без session protection.
- **Плагин импортирует внутренние packages платформы.** Публичная граница — `@sovereign/sdk`.
- **Manifest обещает browser export без browser entry.** Такой вклад не сможет загрузить код.
- **В примере оставлен псевдокод.** Code fences копируют; используй синтаксически корректный код.

`core.session.slash` добавляет строку плагина в каталог `/` текущей сессии. Объявление метаданных и
реализация browser `Command` — разные части одного вклада; для второй части прочитай
`starter.plugin-frontend`.

Полный manifest, lifecycle, SDK и backend contributions:
[справочник backend SDK](references/sdk-reference.md).
