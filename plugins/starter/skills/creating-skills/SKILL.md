---
name: creating-skills
description: Author a Sovereign skill as a Markdown file (SKILL.md) with frontmatter and progressive-disclosure body
---

# Создание файлового скила

Скил в Sovereign — это упаковка знаний и инструкций, которую агент поднимает по необходимости. Скил
объявляется Markdown-файлом `SKILL.md` с YAML frontmatter. Этот скил описывает файловый формат.

## Progressive disclosure

Модель видит в системном промпте только `name`, `description` и абсолютный `location` подходящих
скилов — полный текст она не получает. Когда скил нужен, модель читает его `SKILL.md` обычным
инструментом `read`, а относительные пути внутри файла разрешаются от директории скила. Поэтому тело
пишут для момента «агент решил прочитать подробно», а не для обзора.

## Расположение

Каждый скил — отдельная директория с `SKILL.md`:

- В плагине: `<plugin-directory>/skills/<name>/SKILL.md`. Идентификатор получается с префиксом
  плагина: `<plugin-id>.<name>`. Пример: `plugins/starter/skills/creating-skills/SKILL.md` →
  `starter.creating-skills`.
- Standalone (без плагина), в порядке обхода: `<project>/.sovereign/skills` (scope `project`,
  precedence 400), `<project>/.agents/skills` (scope `project`, source `agents`, precedence 300),
  `<data-directory>/skills` (scope `user`, precedence 200), `~/.agents/skills` (scope `user`,
  source `agents`, precedence 100). Standalone скилы сохраняют короткий идентификатор `<name>`.

## Имя

Имя обязательно совпадает с именем директории. Правила: от 1 до 64 символов, латинские строчные
буквы, цифры, `_` и `-`; дефис не первый и не последний; `--` запрещён. Подчёркивание допустимо, но
даёт warning `nonstandard-underscore`: строгие внешние клиенты Agent Skills могут его не принять.
Префикс с дефисом переносим без предупреждений.

## Frontmatter

YAML 1.2, повтор ключа и синтаксическая ошибка недопустимы, неизвестные поля игнорируются.

| Поле                       | Обязательность | Значение                                                   |
| -------------------------- | -------------- | ---------------------------------------------------------- |
| `name`                     | обязательно    | имя, совпадает с директорией                               |
| `description`              | обязательно    | описание до 1024 символов; то, что видит модель в каталоге |
| `license`                  | необязательно  | непустая строка                                            |
| `compatibility`            | необязательно  | непустая строка до 500 символов                            |
| `metadata`                 | необязательно  | YAML-отображение из строк в строки                         |
| `allowed-tools`            | необязательно  | одна строка с инструментами через пробел                   |
| `disable-model-invocation` | необязательно  | boolean, по умолчанию `false`                              |

Тело после frontmatter — Markdown, может быть пустым.

### `allowed-tools`

Одна строка, разбираемая по пробельным разделителям в список. Распознаётся и сохраняется как
нормализованный список, но пока **не меняет доступный runtime-набор инструментов** и не вводит
особых правил подтверждения вызовов.

### `disable-model-invocation: true`

Скил остаётся в реестре и диагностике, но не попадает в XML-каталог системного промпта и потому
недоступен для самостоятельной активации моделью. Используется для скилов, которые вызывает только
другой код или агент по прямому имени.

## Ограничения

Размер `SKILL.md` — не больше 1 048 576 байт (`entry-too-large`). Символическая ссылка вместо
директории определения или entry-файла запрещена (`unsupported-symlink`).

## Полный пример

```markdown
---
name: code_review
description: Проверяет изменение перед публикацией: тесты, типы, дифф
license: MIT
compatibility: Requires git
metadata:
  author: sovereign
allowed-tools: read bash
disable-model-invocation: false
---

Пройди тесты, типизацию и изучи итоговый diff. Сообщи о найденном и не пиши
в репозиторий без явного разрешения.
```

## Диагностика

Определение с ошибкой не мешает остальным. Основные коды: `invalid-frontmatter`, `invalid-name`,
`name-directory-mismatch`, `missing-description`, `invalid-description`, `invalid-compatibility`,
`invalid-metadata`, `invalid-allowed-tools`, `invalid-disable-model-invocation`,
`nonstandard-underscore` (warning). Состояние и диагностика видны на панели проекта через
`GET /api/projects/:id/file-resources`.
