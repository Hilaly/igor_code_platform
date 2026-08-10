# Формат `SKILL.md`

## Progressive disclosure

Для каждого применимого скила системный prompt содержит только:

- квалифицированный или короткий `name`;
- `description`;
- абсолютный `location` его `SKILL.md`.

Полный Markdown модель читает обычным инструментом `read`. Относительные ссылки в инструкции
разрешаются от директории определения. Соседние файлы не индексируются и не загружаются заранее.

## Расположение и идентификаторы

Каждый скил занимает отдельную директорию:

- plugin-owned: `<plugin-directory>/skills/<name>/SKILL.md`, идентификатор
  `<plugin-id>.<name>`;
- project Sovereign: `<project>/.sovereign/skills`, precedence 400;
- project Agent Skills: `<project>/.agents/skills`, precedence 300;
- user Sovereign: `<data-directory>/skills`, precedence 200;
- user Agent Skills: `~/.agents/skills`, precedence 100.

Standalone-скилы сохраняют короткий идентификатор `<name>`. При одинаковых kind и id побеждает
определение с большим precedence.

## Имя

Поддерживаются 1–64 символа: строчные латинские буквы, цифры, `_` и `-`. Дефис не может быть первым
или последним, `--` запрещён. Поле `name` обязано совпадать с именем директории.

`_` технически допустим, но даёт warning `nonstandard-underscore`: строгий Agent Skills client
может отказаться от такого имени. Для переносимых скилов используй hyphen-case.

## Frontmatter

Frontmatter — YAML 1.2. Повтор ключа и синтаксическая ошибка недопустимы; неизвестные поля
игнорируются, поэтому опечатка в имени поля может пройти незаметно.

| Поле                       | Обязательность | Контракт                                                    |
| -------------------------- | -------------- | ----------------------------------------------------------- |
| `name`                     | обязательно    | имя, совпадающее с директорией                              |
| `description`              | обязательно    | непустая строка до 1024 символов                            |
| `license`                  | необязательно  | непустая строка                                             |
| `compatibility`            | необязательно  | непустая строка до 500 символов                             |
| `metadata`                 | необязательно  | YAML mapping, где ключи и значения — строки                 |
| `allowed-tools`            | необязательно  | одна строка с именами инструментов через пробельные символы |
| `disable-model-invocation` | необязательно  | boolean, по умолчанию `false`                               |

Markdown-body может быть пустым на уровне parser.

## `allowed-tools`

Строка делится по пробельным символам и сохраняется как нормализованный `string[]`. На текущем
runtime поле:

- не меняет доступный набор инструментов;
- не вводит дополнительных permission checks;
- не является sandbox или security boundary.

## `disable-model-invocation`

При `true` скил остаётся в registry и diagnostics, но не попадает в model-visible XML catalogue.
Самостоятельно активировать его модель не может. Поле подходит для ресурса, который выбирает другой
код или агент по прямому id.

## Ограничения discovery

- Максимальный размер `SKILL.md` — 1 048 576 байт (`entry-too-large`).
- Символическая ссылка вместо директории определения или entry-файла запрещена
  (`unsupported-symlink`).
- Обход корня плоский: определяется только `<root>/<name>/SKILL.md`.
- Соседние ресурсы не валидируются и не входят в квоту entry-файла.

## Diagnostics

- `invalid-frontmatter`;
- `invalid-name`;
- `name-directory-mismatch`;
- `missing-description`;
- `invalid-description`;
- `invalid-license`;
- `invalid-compatibility`;
- `invalid-metadata`;
- `invalid-allowed-tools`;
- `invalid-disable-model-invocation`;
- `entry-too-large`;
- `unsupported-symlink`;
- `nonstandard-underscore` — warning.

Ошибка одного определения локальна и не останавливает discovery остальных. Состояние видно на
панели проекта и через `GET /api/projects/:id/file-resources`.
