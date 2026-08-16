# Встроенный плагин Superpowers

## Статус

Утверждённый дизайн. Реализация выполняется после письменного ревью этой спецификации и отдельного
implementation plan.

## Цель и состав

`superpowers` — skills-only built-in plugin, портирующий полный комплект из 14 upstream skills
Superpowers 6.2.0 в формат файловых ресурсов Sovereign. Тексты остаются на английском, исходные
skill IDs сохраняются, а несовместимые с Sovereign инструменты и lifecycle адаптируются.

В плагин входят:

- 14 `skills/<name>/SKILL.md`;
- все соседние references, scripts, examples и assets, на которые ссылаются skills;
- `package.json` и минимальный worker, необходимый для успешной активации и публикации файловых
  ресурсов;
- MIT `LICENSE`, upstream attribution Jesse Vincent и документ `UPSTREAM-ADAPTATION.md` с версией,
  картой замен и намеренно удалёнными предположениями.

Плагин не добавляет собственных tools, routes, storage или UI. Его методология использует инструменты
`starter`, `subagents` и `mission` по публичным именам Sovereign.

## Карта адаптаций

### Планирование и миссия

`using-superpowers` и `writing-plans` сохраняют approval gates, design docs и implementation plans.
План и текущий статус дополнительно отражаются вызовом `mission-update`; файл плана и Mission должны
оставаться согласованными. Markdown-файлы в `docs/superpowers/plans` и ledger остаются долговременной
историей, Mission — текущим снимком для модели и UI.

### Команды и файлы

Все shell-вызовы используют `bash`; длительные команды — `run_in_background: true` с `job-output` и
`job-kill`. Чтение, запись и правка проекта используют core `read`, `write` и `edit`. Команды,
проверки, пути `docs/` и правила `CLAUDE.md`/`AGENTS.md` описываются в терминах Sovereign.

### Subagents и review

`dispatching-parallel-agents`, `subagent-driven-development` и `requesting-code-review` используют
`subagent-spawn`, `subagent-list`, `subagent-output`, `subagent-message`, `subagent-stop`, а для
выбора исполнителя и модели — `subagent-types` и `subagent-models`. Шаблоны prompt остаются
соседними ресурсами. `general-purpose` и вызовы Claude/Codex Task заменяются доступными Sovereign
agent IDs и собственным plugin lifecycle. Параллелизм ограничивается фактическими слотами платформы.

### Worktrees и завершение ветки

`using-git-worktrees` и `finishing-a-development-branch` не предполагают native worktree API. Они
используют `bash` и `git worktree`, проверяют `GIT_DIR`/`GIT_COMMON`, работают только с worktree,
который создал текущий workflow, и не удаляют чужие worktrees. Нативная автоматизация Codex не
обещается.

### Visual companion

Visual companion остаётся опциональным. Его HTML/JS/shell-скрипты поставляются как соседние ресурсы
и запускаются через `bash`; для текстовых развилок браузер не открывается. Любые предположения о
внешнем Codex browser tool удаляются.

### Skill authoring и debugging

`writing-skills` сохраняет RED–GREEN–REFACTOR для документации и pressure scenarios, но запускает
сценарии через `subagent-spawn`, а task tracking ведёт через Mission и Markdown ledger.
`test-driven-development`, `systematic-debugging` и `verification-before-completion` сохраняют
методологию и используют реальные команды проекта.

Platform-specific `codex-tools`, `pi-tools`, `gemini-tools` и `antigravity-tools` не поставляются как
альтернативные инструкции; вместо них добавляется единый `sovereign-tools.md`.

## Discovery и сборка

Плагин получает квалифицированные IDs вида `superpowers.<skill-name>`. Его worker не объявляет
программный skill: loader обнаруживает `skills/` после успешной активации обычным built-in путём.
Манифест соответствует форме `plugins/starter` и попадает в payload встроенных плагинов. Папка не
получает runtime dependency сверх `@sovereign/sdk`.

## Проверки

- ровно 14 entry-файлов `SKILL.md` с валидным Sovereign frontmatter;
- все относительные ссылки разрешаются внутри plugin directory;
- нет неподдержанных полей frontmatter, symlink-ресурсов или забытых крупных файлов;
- статический аудит не находит старые имена Codex/Claude/Pi/Gemini/Antigravity tools там, где должен
  быть Sovereign workflow;
- `mission-update`, `bash`, `read`, `write`, `edit` и `subagent-*` употреблены согласованно;
- artifact payload содержит plugin и его ресурсы;
- discovery показывает `builtin:superpowers.*`;
- `make check` и `make build` проходят.

## Почему так

### Отдельный plugin, а не расширение starter

`starter` отвечает за базового агента и shell-инструменты. Смешивание методологии с ним лишило бы
Superpowers независимого lifecycle, включения и обновления. Новый skills-only plugin сохраняет
границу ответственности и не дублирует runtime.

### Полный комплект, а не выборочное ядро

Скилы образуют цепочку: brainstorming → spec → plan → execution → review → finish, а
writing-skills и subagent-driven-development ссылаются на соседние правила. Удаление «служебных»
skills разорвало бы discovery и заставило бы переносить их неявно в инструкции starter.

### Английский текст и upstream attribution

Пользователь явно выбрал сохранение английского текста. MIT license, версия 6.2.0, авторство и карта
адаптаций нужны для аудита происхождения и последующих обновлений; это не означает автоматическую
синхронизацию с upstream.

### Mission вместо task-list

`mission-update` обозначает действие над целью текущей сессии и не выглядит как проектный task
manager. Планы всё равно остаются файлами в репозитории: Mission не заменяет долговременную память.

### Отсутствующие Codex task API и native worktree API

Sovereign не притворяется, что имеет приватные возможности среды Codex. Task tracking переносится на
Mission + Markdown, а worktree lifecycle — на проверенные git-команды. Добавление новых core APIs в
рамках порта отвергнуто как расширение архитектурной задачи.
