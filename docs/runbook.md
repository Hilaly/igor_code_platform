# Runbook

Как запустить и проверить проект. Единственная точка входа — `make`; знать, какой скрипт в каком
пакете лежит, не требуется.

## Требования к окружению

- **Node.js 24.** Версия зафиксирована в `.nvmrc` ([toolchain.md](toolchain.md)).
  `nvm use` в корне репозитория переключает на неё. На Node 22 сборка не поедет: `make` проверяет
  версию и останавливается с внятной ошибкой, потому что иначе первым симптомом будет непонятная
  ошибка стирания типов.
- **pnpm 11** ([toolchain.md](toolchain.md)). Ставится через `corepack enable`.
- **`npm` в `PATH`** — нужен не для сборки репозитория, а демону в рантайме: им он ставит
  зависимости внешних плагинов ([plugins.md](plugins.md)), а продакшн-артефакт — ещё и свои
  невшиваемые зависимости при первом запуске версии ([toolchain.md](toolchain.md)). Приходит вместе
  с Node, отдельной установки не требует.

## Команды

| Команда                       | Что делает                                   |
| ----------------------------- | -------------------------------------------- |
| `make`                        | Список целей                                 |
| `make install`                | Установить зависимости                       |
| `make dev`                    | Поднять демон и веб-интерфейс с хот-релоадом |
| `make catalog`                | Поднять каталог компонентов UI-кита          |
| `make check`                  | Типы, линтер, формат, тесты — всё, что есть  |
| `make typecheck`              | Только типы (`tsc --noEmit`)                 |
| `make lint` / `make lint-fix` | Линтер                                       |
| `make fmt` / `make fmt-check` | Форматирование                               |
| `make test`                   | Тесты                                        |
| `make build`                  | Сборка продакшн-артефакта                    |
| `make clean`                  | Удалить зависимости и артефакты              |

## Аргументы запуска демона

Два необязательных аргумента ([data-directory.md](data-directory.md)): путь к директории данных
позиционным, порт флагом `--port`.

```bash
node apps/daemon/src/main.ts ~/.sovereign_platform --port 8787
```

Это же и значения по умолчанию, поэтому запуск без аргументов равносилен строке выше. `--help`
печатает использование. Ни порт, ни путь не читаются из файлов настроек: смена порта — перезапуск с
другим аргументом.

## Продакшн-артефакт

`make build` собирает сначала веб-интерфейс, потом артефакт — один файл `dist/sovereign.js`
([toolchain.md](toolchain.md)). Аргументы у него те же, что у запуска из исходников:

```bash
make build
node dist/sovereign.js ~/.sovereign_platform --port 8787
```

Открывать нужно **порт демона**, а не 5273: Vite тут не участвует, интерфейс отдаёт сам демон из
памяти. Каталога со статикой рядом с артефактом не существует.

Первый запуск версии ставит `npm`-ом в `<директория данных>/runtime/<версия>/` то, что в один файл не
вшивается, — сегодня только `esbuild`. На тёплом кеше npm это около трёх секунд, и до конца установки
демон не слушает порт. Без сети или без `npm` в `PATH` демон **всё равно поднимется**: в журнале
встанет `the runtime dependencies of the artifact are not installed`, а плагин с браузерной частью
уйдёт в `failed` с причиной `the browser bundler is not available`. Плагины без браузерной части
работают как обычно.

Тот же первый запуск разворачивает встроенные плагины в `<директория данных>/builtin/<версия>/`, и
`starter` с `subagents` поднимаются оттуда как обычные плагины источника `builtin`. В сеть это не
ходит: их зависимости приехали внутри артефакта. Каталог принадлежит платформе — правки в нём
затираются следующим запуском изменённого артефакта, а менять встроенный плагин надо копией в
`plugins/` директории данных ([data-directory.md](data-directory.md)).

## Dev-режим

`make dev` поднимает два процесса:

- **демон** — `http://127.0.0.1:8787`, директория данных `apps/daemon/.sovereign-dev` (в
  `.gitignore`), перезапускается сам при правке исходников (`node --watch`);
- **веб-интерфейс** — `http://localhost:5273`, Vite с HMR.

Открывать нужно порт веб-интерфейса. Запросы к `/api/*` он проксирует в демон, поэтому пути в коде
одинаковы для dev и продакшна, а CORS не возникает.

В свежей директории данных учётной записи нет, поэтому первое открытие `http://localhost:5273`
показывает форму «задай пароль», а не оболочку ([authentication.md](authentication.md)). Дальше — вход
тем же паролем; сессия живёт в cookie и переживает перезапуск демона, потому что лежит файлом
([data-directory.md](data-directory.md)).

Порт веба выбран нестандартным намеренно: 5173 занят чуть ли не в каждом втором Vite-проекте.
`strictPort` включён, чтобы при занятом порте `make dev` падал с ошибкой, а не уезжал молча на
соседний порт, пока в документации написан один адрес.

Проверить, что всё поднялось:

```bash
curl -s http://localhost:5273/api/health
```

Ответ вида `{"status":"ok","startedAt":"...","uptimeSeconds":12}` означает, что жив и веб-сервер,
и прокси, и демон. Сессия для этого не нужна: проба «жив ли демон» обязана работать до входа
([web-api.md](web-api.md)).

Ходить надо на `localhost`, а не на `127.0.0.1`: Vite слушает только IPv6-петлю, и запрос на
IPv4-адрес получит `ECONNREFUSED` ([runtime-checks.md](runtime-checks.md), проверка 18). К самому
демону это не относится — он слушает `127.0.0.1:8787`.

## Каталог компонентов

`make catalog` (`pnpm --filter @sovereign/ui-kit run catalog`) поднимает Ladle на
`http://localhost:61000` — это дефолт Ladle, своего конфига у нас нет. Демон и веб-интерфейс ему не
нужны: каталог собирает кит сам по себе, поэтому его можно держать открытым вместо `make dev`, когда
работа идёт по ките. Занятый порт Ladle не считает ошибкой и молча уезжает на соседний — адрес всегда
печатается в терминале, смотреть надо туда, а не в эту строку.

Зачем он: `jsdom` отвечает на «что связано с чем», а не на «как это выглядит» (ниже, «Тесты»), а у
восьми примитивов из девятнадцати нет ни
одного потребителя в приложении — они перенесены заранее под срезы 6–10
([roadmap.md](roadmap.md)). Каталог — единственное место, где такой примитив вообще видно.

Что в нём смотреть:

- **примитив во всех своих состояниях** — покой, наведение, фокус, выключено, ошибка. Клавиатурой в
  том числе: у диалога, меню и вкладок поведение фокуса — их основная часть, и глазами на статичной
  картинке оно не проверяется;
- **схему и масштаб** — вверху страницы два переключателя: цветовая схема (все четыре схемы поставки) и
  `data-scale`; светлый и тёмный вариант берутся из собственного переключателя темы Ladle. Выбор
  переживает переход между историями. Схема применяется тем же `applyRoles`, что и в приложении, —
  второго пути применения темы нет, иначе каталог показывал бы не то, что покажет продукт. Примитив,
  который разъезжается на `larger` или теряет контраст на `imperium`, виден сразу;
- **что перенос ничего не забыл** — истории разложены на две группы: наши примитивы и восемь
  перенесённых срезом 5.

## Веб-API с командной строки

Полный контракт — в [web-api.md](web-api.md); здесь только как пощупать.

Без cookie отвечают `GET`/`POST /api/login-session`, `POST /api/account`, `/api/health` и публичный
маршрут включённого плагина, объявленный через `contribute.publicRoute`; остальные защищённые маршруты
дают `401`. Поэтому сначала вход, дальше — с тем же файлом cookie. Первый вход создаёт учётную запись:

```bash
curl -c jar -X POST http://localhost:5273/api/account \
  -H 'content-type: application/json' -d '{"password":"correct horse"}'
```

Дальше — обычный вход тем же телом на `POST /api/login-session`; пароль короче шести символов даёт `400`,
неверный — `401`. Выход:

```bash
curl -b jar -X DELETE http://localhost:5273/api/login-session
```

Состояние плагинов:

```bash
curl -s -b jar http://localhost:5273/api/plugins
```

Поток событий — по кадру, а не пачкой в конце; `-N` обязателен, иначе буферизует сам `curl`:

```bash
curl -sN -b jar http://localhost:5273/api/events
```

Выход обрывает и этот поток: запись сессии удалена, а проверка стоит на входе в соединение
([web-api.md](web-api.md)).

Догон после разрыва: индекс последнего полученного события уходит заголовком, и приходит ровно
пропущенное. Заведомо старый индекс даёт `core.stream.gap` — это сигнал перезапросить снимок:

```bash
curl -sN -b jar -H 'Last-Event-ID: 20' http://localhost:5273/api/events
```

## Проекты с командной строки

```bash
curl -s -b jar http://localhost:5273/api/projects
curl -s -b jar -X POST http://localhost:5273/api/projects \
  -H 'content-type: application/json' \
  -d '{"folder":"~/code/platform","name":"Платформа"}'
```

Ответ создания несёт `folder` — путь после разворота `~` — и `folderKey`, по которому шло сравнение.
Второй проект на ту же папку, как её ни напиши, отвечает `409` с полем `conflict`: целой записью
занявшего ([web-api.md](web-api.md)).

Переименование, архивация и восстановление — один `PUT` целой записью; идентификатор берётся из
списка:

```bash
curl -s -b jar -X PUT http://localhost:5273/api/projects/b7Kq3xv9pQdT \
  -H 'content-type: application/json' \
  -d '{"name":"Платформа","archived":true}'
curl -s -b jar -X DELETE http://localhost:5273/api/projects/b7Kq3xv9pQdT \
  -H 'content-type: application/json'
```

Эфемерный проект (`id` = `work`) на оба отвечает `409`.

**Смена доступности папки проверяется настоящим томом,** а не `mv` и не `chmod`: те дают `ENOENT` и
`EACCES`, но не воспроизводят случай, ради которого наблюдатель поставлен
([runtime-checks.md](runtime-checks.md), проверка 27).

```bash
hdiutil create -size 10m -fs APFS -volname SovereignProject /tmp/sovereign-project.dmg
hdiutil attach /tmp/sovereign-project.dmg          # → /Volumes/SovereignProject
# создать проект на /Volumes/SovereignProject, повесить поток событий, затем:
hdiutil detach /Volumes/SovereignProject
```

Не трогая вкладку: в потоке появляется `core.projects.changed`, а `GET /api/projects` показывает
`"availability":"missing"`. Задержка — от одного до двух интервалов опроса (интервал 5 с): сразу
после `detach` точка монтирования какое-то время ещё существует папкой. `hdiutil attach` возвращает
состояние сам.

## Плагин на живом демоне

Контракт плагина — в [plugins.md](plugins.md); здесь только как его пощупать. Папка плагина кладётся
в `plugins/` директории данных, в dev-режиме это `apps/daemon/.sovereign-dev/plugins/hello/`.

Внешний плагин выключен, пока его не включили. Два способа, путь применения один:

```bash
curl -b jar -X PUT http://localhost:5273/api/plugins/data%3Ahello/preferences \
  -H 'content-type: application/json' -d '{"enabled":true}'
```

```bash
echo '{ "plugins": { "data:hello": { "enabled": true } } }' > apps/daemon/.sovereign-dev/preferences.json
```

Демон подхватит и то и другое без перезапуска, поднимет воркер и дальше будет перезагружать плагин на
каждую правку его исходников. Что происходит — видно в двух разных местах: журнал идёт в терминал,
где запущен демон (переходы жизненного цикла — записями `plugin lifecycle`, строки самого плагина — с
источником `plugin:<id>`), а поток событий отдаётся по HTTP. Наружу журнал не попадает
([logging.md](logging.md)). Набор применённых вкладов
пишется на уровне `debug`:

```bash
echo '{ "logLevel": "debug" }' > apps/daemon/.sovereign-dev/config.json
```

Состояние видно вью плагинов на `http://localhost:5273/plugins`: список плагинов с состоянием,
причиной отказа и попыткой перезапуска, переключение плагина и каждого его вклада, схема нагрузки
вклада-события и диагностика отвергнутых вкладов ([ui-kit.md](ui-kit.md)). То же самое доступно и без
интерфейса — журналом, снимком `GET /api/plugins` и потоком. Оболочка на
`http://localhost:5273` показывает связь с демоном, переключает цветовую схему, масштаб интерфейса и
язык и собирает диагностику интерфейса в правой панели.

События плагина видно тем же потоком: у кадра события плагина полное имя с неймспейсом публикатора
и поле `plugin`. Отказы — в журнале ядра: `the plugin published an event that is not in effect for
it` означает, что объявления нет или его выключили, а не что сломался транспорт.

## Браузерная часть плагина живьём

Плагин из `plugins/` директории данных объявляет `sovereign.browser`
([plugins.md](plugins.md), [ui-extension-model.md](ui-extension-model.md)). Здесь конвейер щупается
снимком, `curl`-ом и импортом бандла; то, как этот бандл доезжает до интерфейса, — в разделе «Места и
вклады плагина живьём» ниже.

Минимальный плагин: `package.json` с `sovereign.browser`, воркер, `src/browser.tsx` с импортами
`react`, `@sovereign/ui-kit` и своего `*.module.css`.

```bash
curl -s -b jar http://localhost:5273/api/plugins | python3 -m json.tool | grep -A 4 '"browser"'
```

У работающего плагина в статусе появляется `browser` с ревизией и двумя адресами. Ассет берётся по
готовому адресу — составлять его руками не надо:

```bash
curl -s -D - -o bundle.js -b jar \
  'http://localhost:5273/plugin-assets/data%3Abrowsered/<ревизия>/browser.js'
curl -s -o /dev/null -w '%{http_code}\n' \
  'http://localhost:5273/plugin-assets/data%3Abrowsered/<ревизия>/browser.js'   # 401: сессия нужна
```

В dev-режиме это работает через порт Vite потому, что `/plugin-assets` стоит в прокси рядом с `/api`
— как и маршруты плагина, ассеты отдаёт демон, а не dev-сервер.

Что стоит посмотреть, кроме кодов ответа:

1. **Переход через `building`.** В журнале демона три записи `plugin lifecycle` подряд: `building`,
   `starting`, `running`, между первой и второй — `the plugin browser bundle is built` с ревизией.
   Между ними единицы миллисекунд.
2. **Ревизия от содержимого.** Правка `*.module.css` даёт новую ревизию, прежняя ещё отвечает `200`.
   Перезапуск демона **без правок** оставляет ревизию прежней, но прежняя из памяти уходит: она жила
   в предыдущем процессе.
3. **Провал сборки — состояние плагина.** Импорт несуществующего файла уводит плагин в `failed` с
   текстом esbuild и местом импорта; `attempt` не растёт, перезапуска нет. Починка файла поднимает
   плагин той же перезагрузкой по наблюдателю.
4. **Модули хоста.** Бандл скачивается и импортируется из Node с подставленным
   `globalThis.__sovereignHostModules__`: экспорты плагина работают, а `useState` из плагина — **та
   же функция**, что у хоста. Ради этого сборка и живёт в демоне.
5. **Имя класса.** В `browser.css` имя выглядит как `.data_browsered_badge_badge`: ключ плагина
   въезжает в имя, потому что у esbuild хеша в имени класса нет вовсе.

Всё пять прогонялись на срезе 12b-1; чем кончились — в [runtime-checks.md](runtime-checks.md),
проверка 36.

## Файловые агенты и скилы

Файловые определения не требуют отдельного плагина и подхватываются работающим демоном. Для
пользовательских ресурсов используйте `~/.sovereign_platform/agents/` и
`~/.sovereign_platform/skills/`; для ресурсов проекта — `.sovereign/agents/` и
`.sovereign/skills/` внутри папки проекта. Внутри корня каждое определение лежит в отдельном
каталоге с именем короткого идентификатора:

```text
.sovereign/
  agents/reviewer/AGENT.md
  skills/review/SKILL.md
```

Минимальный рабочий `AGENT.md`:

```markdown
---
name: reviewer
description: Проверяет изменения
tools:
  include: ["*"]
  exclude: []
skills:
  include: [review]
  exclude: []
---

Читайте diff и сообщайте о рисках.
```

Минимальный рабочий `SKILL.md`:

```markdown
---
name: review
description: Делает обзор изменений
---

Проверьте diff, тесты и обратную совместимость.
```

Селектор `skills.include: ["*"]` явно включает все доступные скилы (кроме скрытых
`disable-model-invocation: true`). Если поле `skills` отсутствует, список пуст: отсутствие селектора
не означает «включить всё». Аналогично, отсутствующий `tools` не выдаёт агенту инструменты.

Проверить hot reload можно без перезапуска демона. После записи файла запросите проект и его
ресурсы:

```bash
curl -s -b jar http://localhost:5273/api/projects/<project-id>/agents
curl -s -b jar http://localhost:5273/api/projects/<project-id>/file-resources
```

Второй ответ содержит `revision`, состояния `active`, `shadowed`, `switched-off` или `invalid` и
диагностики с точным путём. Состояние `invalid` означает, что файл найден, но YAML или обязательное
поле не прошло проверку; `shadowed` — более частный ресурс проиграл по precedence; `switched-off` —
вклад выключен настройкой. Исправьте указанный `path`/`reason`, сохраните файл и дождитесь новой
`revision`. Сессия перечитывает выбранного агента и его скилы перед следующим турном; уже созданная
сессия не требует пересоздания.

Редактирование `AGENT.md`/`SKILL.md` из UI не поддерживается. Создавайте, исправляйте и удаляйте
определения обычными файловыми инструментами, затем проверяйте проектный API.

Плагинские ресурсы лежат внутри каталога самого плагина: `<plugin-directory>/agents/<name>/AGENT.md`
и `<plugin-directory>/skills/<name>/SKILL.md`. Такой плагин всё равно обязан иметь `package.json`
с блоком `sovereign` и worker-файл; Markdown-вклады становятся видимыми только после успешного
`activate()`. Встроенный плагин находится в репозитории `plugins/starter/`, внешний — в
`<data-directory>/plugins/<name>/`, а проектный — в `<project>/.sovereign/plugins/<name>/`.
Редактирование этих файлов на работающем демоне вызывает тот же hot reload, но при неуспешной
активации плагина его ресурсы не публикуются.

## Сессия агента без настоящей модели

Проверять сессии на настоящем провайдере дорого и недетерминировано, поэтому живьём они гоняются на
**двойнике модели**: свой сервер по протоколу `openai-completions` плюс кастомный провайдер от
временного плагина в директории данных. Заведено в срезе 9b, переиспользовано в 10a и 10b; рецепт
лежит здесь, потому что собирать его заново дороже, чем записать.

1. **Сервер модели** — обычный `node:http`, отвечающий кадрами SSE:

   ```js
   response.writeHead(200, { "content-type": "text/event-stream" });
   response.write(
     `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: "при" } }] })}\n\n`,
   );
   response.write(
     `data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 11, completion_tokens: 7, total_tokens: 18 } })}\n\n`,
   );
   response.write("data: [DONE]\n\n");
   ```

   **Отвечать надо медленно** — по кадру в полсекунды и ответом строк на десять. Мгновенный ответ
   закрывает турн раньше, чем в него успевает вклиниться стиринг, и проверить очереди на нём нечем.

   Ответ полезно строить **из того, что приехало в запросе**: по нему видно, доехали ли до модели
   стиринг и сообщение к следующему турну, а не только то, что маршрут ответил `200`.

2. **Плагин с провайдером** — папка в `plugins/` директории данных с `package.json`, где есть блок
   `sovereign`, и воркером, который зовёт `providers.register` с `api: "openai-completions"` и
   `baseUrl` сервера из первого шага.

   SDK плагину надо чем-то дать: вне монорепозитория его ставят, а здесь достаточно симлинка
   `plugins/<id>/node_modules/@sovereign/sdk` на `packages/sdk`. Пока его нет, плагин падает с
   `ERR_MODULE_NOT_FOUND` и перезапускается сам — симлинк можно положить и на работающем демоне.

3. **Включить плагин** (см. предыдущий раздел) и убедиться, что провайдер появился:
   `GET /api/providers` покажет его со статусом `configured`, если переменная окружения из
   `apiKey.environmentVariables` задана хоть чем-нибудь.

Дальше сессия создаётся и живёт как настоящая: `POST /api/sessions` с `model: "<id>/<модель>"`, и
весь жизненный цикл проверяется обычным `curl` ([web-api.md](web-api.md)).

## Команды сессии по `/` живьём

Продолжение рецепта выше: сессия на двойнике модели плюс файловый скил из главы про файловые
ресурсы. Проверяется наблюдаемыми фактами, а не «выглядит правильно».

1. **Каталог отдаёт применимое.** `GET /api/sessions/<id>/commands` — в `skills` лежит то, что
   прошло отбор агента; у скила с `disable-model-invocation: true` стоит `"hidden": true`. Скил вне
   отбора в ответе отсутствует.

2. **Скрытый скил запускается человеком.** `POST /api/sessions/<id>/turns` с телом
   `{"skill":"<name>","instructions":"начни с тестов"}` отвечает `200`. В `GET .../entries` первая
   запись турна — сообщение человека, внутри которого лежит **полный текст** `SKILL.md`, а не
   ссылка на него. В системном prompt того же обращения этого скила нет.

3. **Неизвестное имя — отказ, а не турн.** Тело `{"skill":"нет-такого"}` отвечает `409` с именем в
   причине, а следующий обычный турн уходит сразу: слот очереди отказ не занял.

4. **Тело называет одну операцию.** `{"text":"сделай","skill":"review"}` и `{"skill":"review",
"images":[…]}` отвечают `400`.

5. **В браузере.** `/` в начале черновика открывает каталог; стрелки ходят по строкам, `Escape`
   оставляет `/` обычным текстом, `Enter` на неполном имени подставляет его, на полном — запускает.
   `/compact`, `/rename`, `/archive` и `/fork` делают то же, что соответствующие кнопки. Отказ
   показан врезкой над лентой и **не стирает черновик**.

6. **Шаблон промпта.** Файл `<data-directory>/commands/review.md` с телом `Разбери $ARGUMENTS`
   появляется в `GET .../commands` без перезапуска демона; `POST .../turns` с
   `{"template":"review","arguments":"срез 15"}` уезжает модели уже раскрытым. Одноимённый
   `<project>/.sovereign/commands/review.md` перекрывает пользовательский, а файл с именем
   `compact.md` в каталог не попадает вовсе.

7. **Команда плагина в каталоге.** Фикстура `placed` объявляет `placed.note` в месте
   `core.session.slash`: строка `/placed.note` видна в каталоге, запуск пишет в консоль браузера
   идентификатор именно этой сессии, а выключение вклада строку убирает.

## Хуки и инструменты плагина живьём

Продолжение предыдущего рецепта: тот же плагин, который регистрирует провайдера, объявляет ещё
инструмент и подписки ([hooks.md](hooks.md)). Одного плагина хватает на всё, а отдельный — второй
симлинк SDK и вторая перезагрузка.

1. **Инструмент** — `contribute.tool({ id, description, parameters: z.object({…}), invoke })`. Что он
   доехал до модели, видно **записью дерева** `tools-change`: рядом с `bash`, `read`, `write`, `edit`
   стоит его имя. Дальше нужно, чтобы модель его позвала, — двойник модели для этого отвечает кадром
   `tool_calls` с именем инструмента. Результат приезжает записью `tool-result` из воркера.

2. **Цепочка перезаписи** — две подписки на одно перезаписывающее событие (например
   `before_agent_start`), у второй в обработчике `log.info` с признаком «вход изменён первой». Порядок
   задан рангом источника и идентификатором вклада, то есть `first` до `second`; в журнале плагина
   видно `first: true`.

3. **Отказ на старте сессии** — две подписки на `before_session_start`, обе возвращают `{ refuse }`
   для условной папки. `POST /api/sessions` отвечает `409`, в теле список из **двух** отказов с
   авторами, а `GET /api/sessions?projectId=…` остаётся пустым: отказ до первой траты означает, что
   сессии нет вовсе.

4. **Таймаут по критичности** — подписка, чей обработчик возвращает `new Promise(() => {})`.
   Некритичная на перезаписывающем событии даёт в журнале `outcome: "skipped"`, и турн доигрывает
   (дольше на величину таймаута); критичная — `outcome: "aborted-the-turn"` и турн падает с причиной,
   называющей автора. То же самое приезжает событием `core.hook.timed-out` в поток. Переключать их
   удобно `disabledContributions` в `preferences.json`: правка применяется без перезапуска.

5. **Наблюдателя не ждут** — зависшая подписка на `turn_end` не мешает сессии вернуться в `idle`, а
   бросающая на `turn_start` оставляет турн живым: исключение уезжает записью `the hook subscription
failed` в журнал ядра и до рантайма не доходит.

Все шесть проверок прогонялись на срезе 11a; чем они кончились и что нашлось сверх ожидаемого — в
[runtime-checks.md](runtime-checks.md), проверка 35. Цена фан-аута событий рантайма измерена там же,
проверкой 34.

## Маршруты и хранилище плагина живьём

Плагин из `plugins/` директории данных объявляет `contribute.route`, `contribute.publicRoute` и
пользуется `storage` ([plugins.md](plugins.md), [web-api.md](web-api.md)). Зависимостей ему не надо:
хватает симлинка `node_modules/@sovereign/sdk` на `packages/sdk`.

```bash
curl -b jar 'http://localhost:5273/api/p/routed/board/7?full=yes'   # 200, ответ плагина
curl 'http://localhost:5273/api/p/routed/board/7'                    # 401: сессия нужна
curl -X POST -H 'content-type: text/plain' -d 'тело' \
  http://localhost:5273/api/p/routed/webhooks/github                 # 202: публичный, без сессии
```

Адрес — под `/api`, а не рядом с ним: корень `/p/` отдан браузерным страницам плагина
([web-api.md](web-api.md)). В dev-режиме прокси Vite отправляет демону и `/api`, и
`/plugin-assets`, поэтому маршруты и browser assets плагина на `:5273` доходят до того же демона,
что и на его порту.

Что стоит посмотреть, кроме кодов ответа:

1. **Лимит частоты.** `publicRouteRequestsPerMinute: 3` в `config.json`, четвёртый вызов подряд —
   `429`, и в журнале `the public route of a plugin was called too often`. Правка ключа применяется
   без перезапуска, как и правка предела тела: следующий запрос считается уже по новому.
2. **Таймаут.** Маршрут, чей обработчик возвращает `new Promise(() => {})`, отвечает `504` ровно через
   `pluginRouteTimeoutMilliseconds`; подробностей наружу не уходит, причина остаётся в журнале.
3. **Журнал различает вызовы.** У записи `a route of a plugin was called` есть поле `access`, и у
   публичного вызова рядом стоит `caller` — адрес вызывающего.
4. **Переключение вклада.** `disabledContributions: ["routed.webhook"]` в `preferences.json` — и
   адрес отвечает `404`, а соседний маршрут того же плагина работает; вернули запись — вернулся
   адрес. Правка исходников плагина приносит новый маршрут той же перезагрузкой.
5. **Хранилище.** `plugin-storage/data%3Arouted.json` появляется после первой записи,
   `storage.directory()` отдаёт готовую `plugin-files/data%3Arouted/`. Битый файл читается отказом и
   **не перезаписывается**: под ним состояние плагина.

Все пять прогонялись на срезе 11b; чем кончились — в [roadmap.md](roadmap.md).

## Вклады-данные и конфиг живьём

Плагин из `plugins/` директории данных объявляет цветовые схемы и каталоги сообщений
([plugins.md](plugins.md), [ui-kit.md](ui-kit.md)). Проверять его надо в браузере, а не `curl`-ом:
данные едут снимком `/api/plugins`, а применяет их интерфейс.

Плагин для прогона объявляет заведомо разное: годную схему на текущем мажоре `tokenContract`; вторую
на чужом мажоре; третью с палитрой без одного ключа; каталог `core`/`ru`, подменяющий одну строку
платформы; каталог `core`/`eo` на языке, которого нет в поставке; каталог в своём неймспейсе с
ключом `appearance.scheme.<id схемы>`.

1. **Схема в списке.** `/settings/appearance` показывает годную схему под названием из каталога
   плагина, выбор меняет цвета без перезагрузки, а `preferences.json` держит `<pluginId>.<id>`.
2. **Чужой мажор и неполная палитра** в списке не появляются, а в `/settings/diagnostics` стоят две
   строки с причиной — **по одной на схему, а не по одной на снимок плагинов**.
3. **Выключение плагина** возвращает `imperium` с диагностикой и `preferences.json` **не переписывает**:
   включили обратно — вернулись цвета.
4. **Новый язык.** Эсперанто появляется в списке языков; переведены строки каталога, остальные
   английские, подменённая строка `core`/`ru` подменена.
5. **Копия плагина в папке проекта.** `.sovereign/plugins/<имя>` внутри проекта — и в снимке два
   объявления с одним `id`. Ко всему окну применяются только вклады узла: в списке схем по-прежнему
   одна запись, строки платформы не подменены. Новый корень плагинов проекта демон подхватывает
   перезапуском, а не наблюдателем — правку исходников уже существующего плагина подхватывает на лету.
   **Маршрут, объявленный обеими копиями, при этом отвечает `404`**: адрес один на демон, спорят обе,
   не отвечает никто ([backlog.md](backlog.md)).
6. **Конфиг из формы.** Раздел «демон» пишет `config.json` целиком. `publicRouteRequestsPerMinute: 3`
   даёт `429` на четвёртом вызове без перезапуска; `pluginRouteBodyLimitBytes: 10` отвергает
   следующий же `POST` с большим телом (`413`); `logLevel: debug` добавляет отладочные строки в
   журнал уже созданного логгера; негодное значение даёт `400` с диагностикой и файл не трогает.
7. **Гонка с файлом.** Правка `config.json` редактором при открытой форме без несохранённых правок
   просто приезжает в поля. Если правки есть — они остаются, а сверху встаёт врезка «изменился на
   диске» с кнопкой «взять из файла».
8. **Отказ файловой системы.** `chmod 555` на директорию данных — и сохранение отвечает причиной
   (`EACCES`), а не «internal error»; файл не меняется. Права возвращаются `chmod 755`.

Проверка `chmod 444` на сам `config.json` ничего не проверяет: запись атомарна (временный файл и
`rename`), а `rename` спрашивает права директории, не файла, — и заодно возвращает файлу режим `0600`.

Все восемь прогонялись на срезе 12a; чем кончились — в [roadmap.md](roadmap.md).

## Места и вклады плагина живьём

Сценарий начинается с tracked-фикстур
`apps/daemon/src/plugins/fixtures/{placed,rival,browserless}` и не зависит от содержимого
игнорируемого `apps/daemon/.sovereign-dev`. Из корня репозитория:

```bash
RUNBOOK_DATA="$(mktemp -d)"
pnpm --filter @sovereign/daemon run seed-runbook -- "$RUNBOOK_DATA"
node apps/daemon/src/main.ts "$RUNBOOK_DATA" --port 8787
pnpm --filter @sovereign/web run dev -- --host localhost --port 5273
```

Две последние команды долгоживущие: запустите демон и Vite в отдельных терминалах, подставив в
первую из них путь, который напечатал seed. Следующие команды выполняются с тем же значением
`RUNBOOK_DATA`. Создайте учётную запись, затем получите обычную login-cookie тем же паролем:

```bash
RUNBOOK_COOKIE="$RUNBOOK_DATA/runbook-cookie.jar"
curl -sS -c "$RUNBOOK_COOKIE" -X POST http://localhost:5273/api/account \
  -H 'content-type: application/json' -d '{"password":"correct horse"}'
curl -sS -b "$RUNBOOK_COOKIE" -c "$RUNBOOK_COOKIE" \
  -X POST http://localhost:5273/api/login-session \
  -H 'content-type: application/json' -d '{"password":"correct horse"}'
```

Seed оставляет `placed.plugins`, `placed.boom` и все три вклада `rival` выключенными. Поэтому
`http://localhost:5273/settings/plugins` сначала показывает встроенный список, а переключения ниже
можно наблюдать без перезагрузки страницы.

1. **Owner `builtIn` рисуется кодом самого плагина.** Включите `placed.plugins`:

   ```bash
   curl -sS -b "$RUNBOOK_COOKIE" -X PUT \
     http://localhost:5273/api/plugins/data%3Aplaced/preferences \
     -H 'content-type: application/json' \
     -d '{"enabled":true,"disabledContributions":["placed.boom"]}'
   ```

   Панель содержит `Plugins, by the placed plugin`, `view: list` и `the built-in board for the
window`. Последняя строка важнее снимка реестра: `PluginsPanel` импортировал публичный `Place` из
   `@sovereign/browser-sdk` и через него отрисовал собственный `placed.board`.

2. **`rival` заменяет board, затем добавляет action в коллекцию владельца:**

   ```bash
   curl -sS -b "$RUNBOOK_COOKIE" -X PUT \
     http://localhost:5273/api/plugins/data%3Arival/preferences \
     -H 'content-type: application/json' \
     -d '{"enabled":true,"disabledContributions":["rival.plugins","rival.board-action"]}'
   ```

   В той же панели появляется `the rival replacement board for the window`. Теперь включите action:

   ```bash
   curl -sS -b "$RUNBOOK_COOKIE" -X PUT \
     http://localhost:5273/api/plugins/data%3Arival/preferences \
     -H 'content-type: application/json' \
     -d '{"enabled":true,"disabledContributions":["rival.plugins"]}'
   ```

   Рядом виден `rival board action`.

3. **Равный claim на место ядра возвращает owner fallback.** Включите `rival.plugins`:

   ```bash
   curl -sS -b "$RUNBOOK_COOKIE" -X PUT \
     http://localhost:5273/api/plugins/data%3Arival/preferences \
     -H 'content-type: application/json' \
     -d '{"enabled":true,"disabledContributions":[]}'
   ```

   `/settings/plugins` снова показывает встроенный список. В `/settings/diagnostics` одна причина:
   `the place core.settings.plugins is claimed by placed.plugins, rival.plugins of equal rank, so
none of them takes it`.

4. **Падающий sibling не гасит соседа.** Включите `placed.boom`:

   ```bash
   curl -sS -b "$RUNBOOK_COOKIE" -X PUT \
     http://localhost:5273/api/plugins/data%3Aplaced/preferences \
     -H 'content-type: application/json' \
     -d '{"enabled":true,"disabledContributions":[]}'
   ```

   Секция `placed section` остаётся в левой панели, оболочка жива, а диагностика содержит
   `the component placed.boom failed while rendering: the placed plugin cannot render this`.

5. **Component без browser bundle получает локальный отказ.** `browserless` включён seed-командой и
   остаётся `running`, но его `browserless.panel` помечен `Declared, but not applied` с причиной
   `the component browserless.panel needs a browser bundle, but the plugin declares no
sovereign.browser`.

6. **CSS меняет ревизию, не ломая место.** Сначала снова покажите панель `placed` и выключите
   падающий sibling:

   ```bash
   curl -sS -b "$RUNBOOK_COOKIE" -X PUT \
     http://localhost:5273/api/plugins/data%3Arival/preferences \
     -H 'content-type: application/json' \
     -d '{"enabled":true,"disabledContributions":["rival.plugins"]}'
   curl -sS -b "$RUNBOOK_COOKIE" -X PUT \
     http://localhost:5273/api/plugins/data%3Aplaced/preferences \
     -H 'content-type: application/json' \
     -d '{"enabled":true,"disabledContributions":["placed.boom"]}'
   printf '\n.panel { border-color: #ff4f81; }\n' >> \
     "$RUNBOOK_DATA/plugins/placed/src/browser.module.css"
   ```

   После watcher/rebuild у `data:placed` новая browser revision, в `head` ровно один
   `link[data-sovereign-plugin^="data:placed@"]`, рамка стала розовой, а replacement и action
   продолжают работать.

Проектную копию seed намеренно не создаёт: он не угадывает id проекта и не пишет project
preferences. Создайте настоящий проект, затем отдельно скопируйте и включите `placed`:

```bash
RUNBOOK_PROJECT_FOLDER="$RUNBOOK_DATA/runbook-project"
mkdir -p "$RUNBOOK_PROJECT_FOLDER/.sovereign/plugins"
RUNBOOK_PROJECT_ID="$(
  curl -sS -b "$RUNBOOK_COOKIE" -X POST http://localhost:5273/api/projects \
    -H 'content-type: application/json' \
    -d "{\"folder\":\"$RUNBOOK_PROJECT_FOLDER\",\"name\":\"Runbook project\"}" |
    python3 -c 'import json, sys; print(json.load(sys.stdin)["id"])'
)"
cp -R "$RUNBOOK_DATA/plugins/placed" "$RUNBOOK_PROJECT_FOLDER/.sovereign/plugins/placed"
RUNBOOK_PROJECT_KEY="$(
  node -e 'process.stdout.write(encodeURIComponent(`project:${process.argv[1]}:placed`))' \
    "$RUNBOOK_PROJECT_ID"
)"
RUNBOOK_PROJECT_READY=0
for RUNBOOK_ATTEMPT in $(seq 1 50); do
  if curl -fsS -b "$RUNBOOK_COOKIE" http://localhost:5273/api/plugins | \
    python3 -c 'import json, sys; key = sys.argv[1]; raise SystemExit(not any(plugin["key"] == key for plugin in json.load(sys.stdin)["plugins"]))' \
      "project:$RUNBOOK_PROJECT_ID:placed"; then
    RUNBOOK_PROJECT_READY=1
    break
  fi
  sleep 0.1
done
test "$RUNBOOK_PROJECT_READY" = 1
curl -sS -b "$RUNBOOK_COOKIE" -X PUT \
  "http://localhost:5273/api/plugins/$RUNBOOK_PROJECT_KEY/preferences" \
  -H 'content-type: application/json' \
  -d '{"enabled":true,"disabledContributions":[]}'
```

После появления карточки `project:<id>:placed` глобальный `/settings/plugins` по-прежнему
разрешается только из data-контекста; проектная копия применяется лишь в контексте созданного
проекта.

## Вкладки и команды плагина живьём

Продолжение того же сценария: демон, Vite и cookie уже подняты выше, фикстура `placed` включена
командой из шага 1. Всё ниже — про правую панель, кнопку команды и палитру.

1. **Вкладка появилась подписью из снимка.** Нажмите `Show the side panel` в шапке. В полосе стоит
   кнопка `Board` — подпись пришла из `title` вклада `placed.board-tab`, а не из его кода: строка
   есть в `/api/plugins` до того, как бандл загружен. Панель под полосой показывает заглушку `No
tabs: a plugin will bring them`, потому что открытой вкладки ещё нет.

2. **Открытие вкладки монтирует экземпляр.** Щёлкните `Board`. Появляется `Board tab` и строка
   `page: home` — вкладка получила тот же контекст страницы, что и секции левой панели.

3. **Команда исполняется тремя дорогами.** В полосе действий шапки стоит кнопка `Run the placed
board` — она нарисована по заголовку из снимка и рядом с чужим компонентом `placed action`. Щелчок
   по ней и щелчок по `run the command from here` внутри вкладки делают одно и то же: вторая кнопка
   зовёт `invoke("placed.run")` **из кода плагина** и показывает исход `done`. В консоли браузера —
   `[placed] the command ran for home`.

4. **Палитра складывает оба источника.** Кнопка `Commands` в шапке (и аккорд Cmd/Ctrl+K) открывает
   список, где команды ядра и обе команды плагина идут вперемешку, без деления на источники.
   `Show the navigation panel` и `Show the side panel` стоят строками без кнопки: они сейчас ничего
   бы не сделали, и палитра их не прячет, а выключает.

5. **Отказ команды приезжает значением.** Выберите `A command that throws when run` — интерфейс
   остаётся жив, а `/settings/diagnostics` получает
   `the command placed.boom-command failed: the placed command cannot run`.

6. **`available` выключает кнопку после загрузки бандла.** Откройте архив сессий (командой
   `Open the archive`). Кнопка `Run the placed board` в шапке становится неактивной: `RunCommand`
   объявил себя недоступным на этой странице. Вкладка при этом жива и показывает
   `page: session-archive`.

7. **Выключенный вклад не стирает выбранную вкладку.**

   ```bash
   curl -sS -b "$RUNBOOK_COOKIE" -X PUT \
     http://localhost:5273/api/plugins/data%3Aplaced/preferences \
     -H 'content-type: application/json' \
     -d '{"enabled":true,"disabledContributions":["placed.boom","placed.plugins","placed.board-tab"]}'
   ```

   Панель показывает заглушку. Верните вклад тем же запросом без `placed.board-tab` — вкладка
   открывается сама, потому что `openTab` из раскладки никто не трогал. То же самое переживает и
   перезагрузка страницы.

8. **Пересборка плагина не гасит страницу.** Допишите строку в
   `"$RUNBOOK_DATA/plugins/placed/src/browser.module.css"`. Плагин проходит через `building`, и
   именно поэтому забытый `openTab` не чистится: иначе вкладка закрывалась бы на каждую правку.

9. **Палитра работает на установке без единого плагина.** Выключите `placed`, `rival` и
   `browserless` целиком — палитра по-прежнему показывает тринадцать команд ядра. Ради этого команды
   ядра и объявлены данными хоста ([ui-extension-model.md](ui-extension-model.md)).

## Страницы плагина живьём

Продолжение того же сценария: демон, Vite и cookie уже подняты выше, фикстура `placed` включена.
Всё ниже — про её страницу `placed.log` на адресе `/p/placed/log`. Это воспроизводимый сценарий
проверки, а не самостоятельное доказательство merge-readiness ветки: после любого исправления нужны
свежие `make check`, сборка и повтор затронутых шагов.

1. **Страница открывается по адресу, а заголовок приходит из снимка.** Откройте
   `http://localhost:5273/p/placed/log`. В шапке стоит `Log of the placed plugin` — это `title`
   вклада, и он известен до того, как загружен бандл. Сама страница показывает `base: /p/placed/log`
   и `path: /`.

2. **Хвост адреса принадлежит странице.** Нажмите `open entry 3`: адрес становится
   `/p/placed/log/entry/3`, а страница видит `path: /entry/3`. Маршрут ядра при этом не менялся —
   `/p/<pluginId>/<pageId>/*` разбирается одним правилом, каким бы длинным ни был хвост.

3. **Переход, меняющий только параметр, происходит.** Нажмите `toggle the filter in place`: адрес
   получает `?filter=warn`, страница показывает `filter: warn`, второе нажатие даёт `filter=error`.
   До этого среза такой переход молча не происходил вовсе — сравнение шло по одному пути.

4. **`replace` не наполняет историю.** Кнопка «назад» браузера после двух переключений фильтра
   возвращает не на предыдущий фильтр, а на `/p/placed/log`, и **экран меняется вместе с адресом**.

5. **Перезагрузка возвращает то же состояние.** Откройте `/p/placed/log/entry/7?filter=warn` и
   перезагрузите страницу: `path: /entry/7` и `filter: warn` на месте.

6. **Выход на маршрут ядра.** Кнопка `leave for the plugins settings` зовёт `navigateCore` и уводит
   на `/settings/plugins` — канонический адрес ядра, без хвоста параметров страницы.

7. **Encoded dot-сегмент не захватывает чужой адрес.** Временно замените путь в обработчике кнопки
   `open entry` в `apps/daemon/src/plugins/fixtures/placed/src/browser.tsx` на
   `/%2e%2e/%2e%2e/settings/plugins`, дождитесь новой browser-ревизии и нажмите кнопку. Адрес должен
   остаться под базой страницы — `/p/placed/log/settings/plugins`, — а не стать
   `/settings/plugins`. После проверки верните фикстуру без коммита. Это проверяет API владения URL,
   а не security sandbox: включённый browser-код плагина исполняется в realm хоста.

8. **Выключенный вклад оставляет адрес живым.** Не уходя со страницы:

   ```bash
   curl -sS -b "$RUNBOOK_COOKIE" -X PUT \
     http://localhost:5273/api/plugins/data%3Aplaced/preferences \
     -H 'content-type: application/json' \
     -d '{"enabled":true,"disabledContributions":["placed.plugins","placed.boom","placed.log"]}'
   ```

   На том же URL появляется `This page is switched off` с кнопкой возврата, а не общий «не найдено».
   Верните вклад тем же запросом без `placed.log` — страница возвращается сама, без перезагрузки.

9. **Правка исходников переставляет страницу и не гасит оболочку.** Измените строку в
   `"$RUNBOOK_DATA/plugins/placed/src/browser.tsx"` — например, заголовок внутри `LogPage`. Плагин
   проходит через `building`, получает новую ревизию, и открытая страница подхватывает правку на
   месте; в консоли браузера при этом пусто.

10. **Адрес, которого никто не объявлял.** `/p/placed/nope` показывает `No such page` с возвратом.
    Пока снимок ещё не приехал, на этом же месте стоит ожидание, а не отказ: «страницы нет» — это
    утверждение, которое нечем сделать, не прочитав снимок.

11. **Страница перечислена во вью плагина.** На `/settings/plugins/data%3Aplaced` есть раздел
    `Pages` со строкой `Log of the placed plugin`, адресом `/p/placed/log` и кнопкой `Open`.
    Автоматической записи в левой панели у страницы нет — этот список и есть гарантия, что
    объявленная страница достижима.

В конце сначала остановите `Ctrl-C` оба долгоживущих процесса — демон и Vite. Затем удалите только
значение `RUNBOOK_DATA`, полученное от `mktemp -d` в начале этого сценария:

```bash
RUNBOOK_TMP_ROOT="${TMPDIR:-/tmp}"
RUNBOOK_TMP_ROOT="${RUNBOOK_TMP_ROOT%/}"
case "$RUNBOOK_DATA" in
  "$RUNBOOK_TMP_ROOT"/*) rm -rf -- "$RUNBOOK_DATA" ;;
  *) printf 'refusing to remove non-runbook path: %s\n' "$RUNBOOK_DATA" >&2 ;;
esac
unset RUNBOOK_DATA RUNBOOK_COOKIE RUNBOOK_PROJECT_FOLDER RUNBOOK_PROJECT_ID RUNBOOK_PROJECT_KEY
```

## Проверка перед коммитом

```bash
make check
```

Типы проверяются отдельной командой, а не как побочный эффект сборки: внутренние пакеты
потребляются исходниками и не собираются вовсе ([repository-structure.md](repository-structure.md)).
Не позвал `make check` — типы не проверил никто.

## Тесты

- Демон и пакеты — встроенный `node --test`.
- Веб и UI-кит — `vitest`: JSX Node не стирает, а под React `vitest` всё равно нужен.
- **DOM включается пофайлово**, докблоком `// @vitest-environment jsdom` первой строкой файла. Среда
  по умолчанию остаётся `node`: DOM нужен считаным файлам, а поднимать его на каждый тест значит
  платить за него везде ([ui-kit.md](ui-kit.md)). Такие тесты есть и в ките (`toast`,
  `interactive-components`), и в вебе (`login-view`).
- Разметка первого кадра проверяется без DOM — серверной отрисовкой (`renderToStaticMarkup`): связь
  `for` с `id`, склейка `aria-describedby`, промах в имени класса CSS Modules. Это дешевле и ловит
  другое, поэтому остаётся рядом с `jsdom`, а не заменяется им.
- **Вид всё равно проверяется запуском.** `jsdom` отвечает на «что связано с чем», а не на «как это
  выглядит»: раскладки, цветов и фокусной рамки там нет. Для этого — приложение или каталог
  компонентов.

## Чего пока нет

- Бандл плагина не делится по страницам: открытая страница тянет весь браузерный код своего плагина
  ([backlog.md](backlog.md)). Сами страницы, фасад навигации, места, вкладки и команды реализованы
  ([ui-extension-model.md](ui-extension-model.md)); эта строка фиксирует состав платформы, но не
  заменяет свежую полную проверку конкретной ветки.
