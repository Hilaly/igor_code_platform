# Проверки рантайма

Утверждения о возможностях Node, на которых стоят решения по архитектуре. Проверены запуском,
а не взяты из документации. Прогоняются заново при смене мажорной версии Node: если проверка
перестала проходить, затронутое решение нужно пересматривать.

**Проверено на:** Node v24.18.0, macOS arm64, 2026-07-26.
**Связанные решения:** [ADR-0002](adr/0002-nodejs-lts-as-runtime.md).

## 1. TypeScript исполняется без транспайлера

```bash
printf 'const id: string = "demo";\nconsole.log("ok:", id);\n' > /tmp/t.ts && node /tmp/t.ts
```

Результат: `ok: demo`. Флаги не нужны, стирание типов включено по умолчанию.

## 2. Нестираемый синтаксис в режиме по умолчанию не работает

```bash
printf 'enum Level { Debug, Info }\nconsole.log(Level.Info);\n' > /tmp/e.ts && node /tmp/e.ts
```

Результат: `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX: TypeScript enum is not supported in strip-only mode`.
Так же ведут себя `namespace` и parameter properties (`constructor(private x: T)`).

## 3. Встроенный трансформ снимает это ограничение

```bash
node --experimental-transform-types /tmp/e.ts
```

Результат: `1`. Транспайлер внутри Node, внешних зависимостей не требуется. Флаг помечен
экспериментальным и печатает предупреждение.

## 4. Флаг можно включить только для воркера

Хост-процесс запускается без флага, воркер получает его через `execArgv`:

```js
new Worker(pluginUrl, { execArgv: ["--experimental-transform-types"] });
```

Результат: код с `enum` и parameter properties исполняется внутри воркера, хост-процесс при этом
экспериментальных флагов не несёт. Значит режим исполнения TypeScript можно выбирать для плагинов
отдельно от самого демона.

## 5. Лимит памяти на воркер действительно убивает воркер, а не процесс

Воркер с `resourceLimits: { maxOldGenerationSizeMb: 32 }` в бесконечном цикле аллокаций:

```js
new Worker(hogUrl, { resourceLimits: { maxOldGenerationSizeMb: 32 } });
```

Результат:

```
worker died: Error | Worker terminated due to reaching memory limit: JS heap out of memory
worker exit code: 1 | host alive, rss 62 MB
```

Хост-процесс пережил событие и остался в пределах своей памяти. Это опорный факт для модели
изоляции «воркер на плагин»: лимит — не декларация, а рабочий предохранитель.

## 6. SQLite доступен из коробки

```bash
node -e 'const {DatabaseSync}=require("node:sqlite"); new DatabaseSync(":memory:").exec("create table t(a)")'
```

Результат: работает без флагов и без нативных зависимостей.

## 7. Пакет воркспейса резолвится в исходниках через симлинк pnpm

Node не стирает типы в файлах внутри `node_modules`, а pnpm кладёт туда симлинк на пакет
воркспейса. Вопрос — какой путь увидит Node.

```bash
cd apps/daemon && node -e 'import("@sovereign/protocol").then((m) => console.log(m.healthPath))'
```

Результат: `/api/health`. Node разворачивает симлинк в реальный путь (`packages/protocol/src`),
то есть файл оказывается вне `node_modules` и стирание типов применяется.

Это опорный факт для [ADR-0006](adr/0006-internal-packages-consumed-as-sources.md): без него
потребление пакетов исходниками не работало бы и потребовалась бы сборка в `dist`.

## Чего эти проверки не покрывают

- Поведение при тысячах циклов `terminate`/`spawn` — утечки на длинной дистанции не измерялись.
- Стоимость холодного старта воркера с плагином.
- Работу нативных аддонов в зависимостях плагинов.
