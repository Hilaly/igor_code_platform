# Формат `AGENT.md`

## Расположение и идентификаторы

Определение занимает отдельную директорию; соседние файлы служат ресурсами, а относительные пути
разрешаются от директории определения.

- Plugin-owned: `<plugin-directory>/agents/<name>/AGENT.md`, идентификатор
  `<plugin-id>.<name>`.
- Project standalone: `<project>/.sovereign/agents/<name>/AGENT.md`, короткий id `<name>`,
  precedence 200.
- User standalone: `<data-directory>/agents/<name>/AGENT.md`, короткий id `<name>`,
  precedence 100.

Standalone-определение не запускает worker и не принадлежит плагину. Межклиентского корня
`.agents/agents` нет.

## Имя

Поддерживаются 1–64 символа: строчные латинские буквы, цифры, `_` и `-`. Дефис не может быть первым
или последним, `--` запрещён. Поле `name` обязано совпадать с именем директории.

## Frontmatter

Frontmatter — YAML 1.2. Повтор ключа и синтаксическая ошибка недопустимы. Неизвестные поля
игнорируются, поэтому используй только документированные ключи.

| Поле             | Обязательность | Контракт                                 |
| ---------------- | -------------- | ---------------------------------------- |
| `name`           | обязательно    | имя, совпадающее с директорией           |
| `description`    | обязательно    | непустая строка                          |
| `tools`          | необязательно  | selector `{ include, exclude }`          |
| `skills`         | необязательно  | selector `{ include, exclude }`          |
| `model`          | необязательно  | непустая строка, обычно `provider/model` |
| `thinking-level` | необязательно  | поддерживаемый уровень reasoning         |

Markdown-body с системными инструкциями обязателен и после trim не может быть пустым.

## Селекторы

`tools` и `skills` имеют одинаковую форму:

```yaml
tools:
  include: ["read-*", "bash"]
  exclude: ["*-delete"]
```

- `include` и `exclude` — массивы строк.
- Отсутствующая сторона selector становится `[]`.
- Полностью отсутствующий selector становится `{ include: [], exclude: [] }`.
- Пустой `include` означает «ничего», не «всё».
- `*` совпадает с любым отрезком имени; сопоставляется полное имя.
- Сначала применяется `include`, затем `exclude`; запрет всегда побеждает.
- Selectors применяются заново к текущему runtime-каталогу перед операцией.

Plugin-owned скил выбирается квалифицированным id, например `github.review`; standalone — коротким,
например `review`. Скил с `disable-model-invocation: true` не попадёт в каталог модели даже при
совпадении selector.

## Model и thinking

Поддерживаемые `thinking-level`:

- `off`;
- `minimal`;
- `low`;
- `medium`;
- `high`;
- `xhigh`;
- `max`.

Parser проверяет `model` только как непустую строку. Рекомендуемая форма — `provider/model`; её
доступность зависит от runtime provider catalogue.

## Ограничения discovery

- Максимальный размер `AGENT.md` — 1 048 576 байт (`entry-too-large`).
- Символическая ссылка вместо директории определения или entry-файла запрещена
  (`unsupported-symlink`).
- Обход root плоский: определяется только `<root>/<name>/AGENT.md`.
- Ошибка одного определения не останавливает остальные.

## Diagnostics

- `invalid-frontmatter`;
- `invalid-name`;
- `name-directory-mismatch`;
- `missing-description`;
- `missing-instructions`;
- `invalid-selector`;
- `invalid-model`;
- `invalid-thinking-level`;
- `entry-too-large`;
- `unsupported-symlink`.

Состояние определений видно на панели проекта и через
`GET /api/projects/:id/file-resources`.
