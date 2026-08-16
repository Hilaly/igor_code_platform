# Обновление starter skills для Mission и расширенного SDK

## Статус

Дополнение к утверждённому дизайну встроенных плагинов. Реализация выполняется после ревью этой
спецификации вместе с Mission plugin, browser SDK bridge и Superpowers port.

## Цель и границы

После появления `mission-update` и публичного browser event bridge встроенный `starter` обязан учить
модель актуальному SDK Sovereign. Полный аудит всех пяти starter skills и их references должен убрать
расхождения между документацией и публичными контрактами, не превращая starter в владельца Mission
состояния.

Изменяются только Markdown skills и соседние references:

| Skill | Изменение |
| --- | --- |
| `plugin-backend` | Полный workflow для session-scoped `mission-update`, storage snapshot, event invalidation и route как источника истины. |
| `plugin-frontend` | Полный workflow для `useSovereignEvents`, host-provided frontend bus, `core.panel.tabs`, session filtering и revision-safe fetch. |
| `creating-skills` | Правила plugin-owned skills, progressive disclosure и обязательное отражение текущего плана через `mission-update`, когда skill управляет многошаговой работой. |
| `creating-agents` | Примеры skill selectors учитывают plugin-qualified IDs, а tool allowlists — короткие имена (`mission-update`, `subagent-*`) и не обещают отсутствующие инструменты. |
| `creating-prompt-templates` | Явно отделяет slash prompt template от Mission и обновляет ссылку на актуальный frontend contract. |

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
- storage failure не публикует событие;
- неизвестные поля и статусы валидируются до записи.

Справочник `references/sdk-reference.md` должен использовать реальные публичные SDK имена и не
приводить устаревший API, которого нет в текущем `@sovereign/sdk`.

### `plugin-frontend`

Добавить канонический пример panel component:

- `PlaceContext.subject.sessionId` определяет текущую сессию;
- `useSovereignEvents()` подписывает компонент на host-provided frontend bus;
- компонент не создаёт собственный `EventSource` и не открывает второй SSE;
- event фильтруется по сессии, затем route перечитывает snapshot;
- `revision` защищает от out-of-order response;
- reconnect/gap восстанавливается обычным snapshot fetch;
- `core.panel.tabs` остаётся plugin-owned вкладом, UI не становится core-owned.

`references/browser-reference.md` должен описывать bridge как публичный SDK surface и сохранять
правило singleton browser SDK.

### `creating-skills`

Добавить правило выбора Mission:

- короткая одношаговая инструкция не обязана создавать Mission;
- многошаговая работа с согласованным планом должна отражать цель и статусы через `mission-update`;
- долговременная история остаётся в `docs/` или другом репозиторном артефакте;
- Mission — текущий per-session snapshot, не project task manager и не замена skill-файлу;
- соседние references и scripts включаются только когда на них есть рабочая ссылка.

### `creating-agents`

Уточнить, что skill selectors работают с квалифицированными plugin-owned IDs, а tool selectors
используют короткие имена инструментов, которые получает модель. Примеры должны явно различать:

- core tool `read`/`write`/`edit`;
- tool `mission-update` из плагина `mission`;
- tools `subagent-*` из плагина `subagents`;
- skill IDs вроде `starter.plugin-backend` и `superpowers.writing-plans`.

### `creating-prompt-templates`

Зафиксировать границу: prompt template — текстовая заготовка команды `/`, а Mission — состояние
текущего плана модели. Template может попросить модель обновить Mission, но сам не является Mission
и не хранит её snapshot.

## Проверки

- каждый из пяти starter skills и все его references проходят ручной аудит ссылок;
- примеры не содержат неизвестных SDK exports, старых имён tools или второго SSE;
- `mission-update`, `useSovereignEvents`, `PlaceContext.subject.sessionId`, `storage`, `events` и
  route examples согласованы с публичным API после реализации bridge;
- frontmatter и Markdown links валидны;
- существующие starter quality tests и полный `make check` проходят.

## Почему так

### Полный аудит вместо точечной правки

Публичный SDK используется сразу несколькими starter skills. Исправление только backend/frontend
оставило бы creating-agents, creating-skills или prompt-template references с устаревшими обещаниями.

### Документация starter не владеет Mission

Mission — отдельный plugin с собственным worker, storage и UI. Starter только объясняет, как другой
плагин или skill использует публичный контракт; дублировать состояние в starter нельзя.

### Mission не заменяет артефакты репозитория

Снимок нужен модели и UI прямо сейчас. Design docs, implementation plans и ledger остаются в Git,
потому что только они переживают смену сессии и служат долговременной памятью проекта.
