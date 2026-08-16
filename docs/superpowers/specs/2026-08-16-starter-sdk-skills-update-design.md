# Обновление starter skills для Mission и расширенного SDK

## Статус

Дополнение к утверждённому дизайну встроенных плагинов. Реализация выполняется после ревью этой
спецификации вместе с Mission plugin, browser SDK bridge и Superpowers port.

## Цель и границы

После появления `mission-update` и публичного browser event bridge встроенный `starter` обязан учить
модель актуальному SDK Sovereign. Аудит навыков написания backend и browser-плагинов должен убрать
расхождения между документацией и публичными контрактами, не превращая starter в владельца Mission
состояния.

Изменяются только Markdown skills и соседние references:

| Skill | Изменение |
| --- | --- |
| `plugin-backend` | Полный workflow для session-scoped `mission-update`, storage snapshot, event invalidation и route как источника истины. |
| `plugin-frontend` | Полный workflow для `useSovereignEvents`, host-provided frontend bus, `core.panel.tabs`, session filtering и revision-safe fetch. |

Публичный SDK-код и два новых плагина реализуются отдельными задачами; этот срез не добавляет worker,
route, UI или storage в `starter`.

## Содержание обновлений

### `plugin-backend`

Добавить канонический пример `mission-update`:

- `sessionId` берётся из invocation context, а не из аргументов модели;
- snapshot хранится через `storage` под session-derived key;
- успешная запись публикует объявленное plugin event `changed`;
- payload события содержит только `{ sessionId, revision }`;
- route `GET /api/p/<plugin>/<path>` возвращает полный snapshot;
- событие является invalidation, route — источником истины после пропуска или reconnect;
- backend не предлагает polling API и не требует от browser-кода периодических запросов;
- storage failure не публикует событие;
- неизвестные поля и статусы валидируются до записи.

Справочник `references/sdk-reference.md` должен использовать реальные публичные SDK имена и не
приводить устаревший API, которого нет в текущем `@sovereign/sdk`.

### `plugin-frontend`

Добавить канонический пример panel component:

- `PlaceContext.subject.sessionId` определяет текущую сессию;
- `useSovereignEvents()` подписывает компонент на host-provided frontend bus;
- host-provided bus получает plugin events из единственного общего SSE-соединения приложения;
- компонент не создаёт собственный `EventSource`, не открывает второй SSE и не использует polling;
- event фильтруется по сессии, затем route перечитывает snapshot;
- `revision` защищает от out-of-order response;
- reconnect/gap восстанавливается обычным snapshot fetch;
- `core.panel.tabs` остаётся plugin-owned вкладом, UI не становится core-owned.

`references/browser-reference.md` должен описывать bridge как публичный SDK surface и сохранять
правило singleton browser SDK.

## Проверки

- оба starter plugin skills и все их references проходят ручной аудит ссылок;
- примеры не содержат неизвестных SDK exports, старых имён tools, polling или второго SSE;
- `mission-update`, `useSovereignEvents`, `PlaceContext.subject.sessionId`, `storage`, `events` и
  route examples согласованы с публичным API после реализации bridge;
- frontmatter и Markdown links валидны;
- существующие starter quality tests и полный `make check` проходят.

## Почему так

### Два plugin skills вместо общего аудита starter

Новый контракт касается именно границы backend/browser-плагина. Дополнительные skills про агентов,
skills и prompt templates не должны получать Mission-специфичные правила без самостоятельной
потребности; их включение расширило бы scope и смешало независимые обязанности.

### Документация starter не владеет Mission

Mission — отдельный plugin с собственным worker, storage и UI. Starter только объясняет, как другой
плагин или skill использует публичный контракт; дублировать состояние в starter нельзя.

### Событие вместо polling

Backend сообщает об изменении событием, а route хранит восстанавливаемый snapshot. Frontend слушает
общий SSE bridge и читает snapshot только при mount, смене сессии, событии или recovery после gap.
Периодический polling и отдельный `EventSource` отвергнуты: они дублируют транспорт и создают гонки
между несколькими источниками обновления.
