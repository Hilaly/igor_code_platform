# Авторинг prompt templates и session slash-команд

> **Статус: реализовано.**

## Цель

Сделать встроенные starter-скилы достаточными для создания артефактов среза 15: файловых prompt
templates и plugin-owned команд, размещённых в каталоге `/` открытой агентской сессии.

## Границы

Изменяются только authoring-инструкции и их статические проверки:

- новый `plugins/starter/skills/creating-prompt-templates`;
- `plugins/starter/skills/plugin-backend`;
- `plugins/starter/skills/plugin-frontend`;
- `plugins/starter/skills/creating-skills`;
- тесты качества starter-скилов;
- индекс и тематическая документация о starter-поставке.

Не изменяются parser файловых ресурсов, runtime, protocol, SDK и UI-контракт. `creating-agents`
остаётся без изменений: агент уже получает каталог применимых skills и читает их через `read`.

## Авторинг prompt templates

Новый skill `creating-prompt-templates` — workflow для повторяемой задачи «создать или проверить
`commands/<name>.md`».

Он описывает:

- два корня: `<data-directory>/commands` со scope `user` и `<project>/.sovereign/commands` со
  scope `project`;
- плоский `.md`-файл, необязательный frontmatter и fallback description из первой непустой строки;
- приоритет project над user при одинаковом имени;
- подстановку `$1`, `$2`, `$@`, `$ARGUMENTS`, `${@:N}` и `${@:N:L}`;
- занятые имена `compact`, `fork`, `rename`, `archive`;
- различие prompt template и `SKILL.md`;
- проверку каталога сессии, аргументов, подстановки и фактического запуска.

Skill остаётся model-invocable: агент может создать шаблон по запросу пользователя, но не получает
нового инструмента и не обходит существующие правила доступа к папке проекта.

## Команды плагина

Отдельный skill для plugin command не создаётся. Авторинг разделяется между уже существующими
`plugin-backend` и `plugin-frontend`.

### `plugin-backend`

Скил явно описывает, что `contribute.command` — декларация вклада в worker, а не backend-обработчик.
Для команды необходим `sovereign.browser`; backend-часть регистрирует `id`, `title`, `export` и,
для slash-каталога, `placeId: "core.session.slash"`. Скил направляет к `starter.plugin-frontend`
за реализацией browser export.

### `plugin-frontend`

Скил разделяет команды палитры и команды с местом `core.session.slash`. Для slash-команды фиксируется:

- `placeId` допустим только для cardinality `action`;
- host показывает строку `/<pluginId>.<declared-command-id>`;
- browser export имеет форму `Command` с `run(context)`;
- context содержит текущую сессию и её проект;
- обработчик вызывает backend route или другой публичный контракт плагина и обрабатывает отказ.

Минимальный пример worker + browser entry остаётся синтаксически корректным и не смешивает React
компонент с `Command`.

## `creating-skills`

Скил получает короткую оговорку о границе: `SKILL.md` — инструкции, которые модель читает или
активирует, а `commands/<name>.md` — готовое сообщение, которое запускает человек. Запросы про
`/name`, `$ARGUMENTS` или папку `commands` направляются в `creating-prompt-templates`.

## Проверка

Статические тесты starter-скилов расширяются проверками:

- новый skill проходит parser и имеет description, начинающийся с `Use when`;
- локальные ссылки разрешаются относительно директории skill;
- в prompt-template skill присутствуют оба корня, reserved names и все формы аргументов;
- backend skill содержит `core.session.slash` и ссылку на frontend skill;
- frontend skill содержит `Command`, `run(context)` и slash place;
- `creating-skills` различает `SKILL.md` и prompt template.

Проверки не копируют весь runtime-контракт: точные правила остаются в `docs/file-resources.md`,
`docs/ui-extension-model.md` и `docs/web-api.md`.

## Почему так

**Один новый skill вместо двух.** Файловые шаблоны — отдельный формат ресурсов и самостоятельная
повторяемая задача. Plugin command уже имеет две естественные половины в существующих скилах: worker
декларирует contribution, browser bundle исполняет `Command`. Отдельный skill создал бы третью точку
входа и дублировал бы границы плагинного контракта.

**`creating-agents` не меняется.** Срез 15 не добавил нового формата агента или нового инструмента:
модель уже получает `<available_skills>` и читает выбранный `SKILL.md` progressive disclosure.

**Статическая проверка вместо копирования спецификаций.** Тесты ловят потерю ключевых authoring-подсказок,
а нормативные детали остаются в тематических документах и не расходятся с ними второй копией.
