# Срез 14a: пользовательские изображения в чате

> **Статус: утверждён для реализации.**
>
> Этот документ фиксирует только изображения. Ссылки `@файл`, чтение содержимого файлов, file
> picker и поиск по проекту вынесены в отдельный срез 14b и сюда не входят.

## Цель и границы

Пользователь может добавить одно или несколько изображений к одному сообщению, отправить их
вместе с текстом или без текста, увидеть это сообщение в ленте и открыть оригинал после
перезапуска, архивации или fork сессии.

Поддерживаются только пользовательские изображения:

- JPEG;
- PNG;
- GIF;
- WebP.

Assistant-generated images и отдельный upload/storage API в этот срез не входят. Изображение
передаётся в Pi в его штатном формате image block и сохраняется inline в существующем Pi JSONL.
Новый blob store, sidecar-файлы и binary HTTP route не добавляются.

## Принятые продуктовые решения

- Одно сообщение может содержать несколько изображений.
- Текст и изображения отправляются одним запросом и одним сообщением истории.
- Изображения отображаются в ленте сразу после принятия запроса и после чтения persisted history.
- В композере появляется кнопка `+` с иконкой слева внизу.
- В меню `+` для этого среза есть один пункт «Изображение»; меню является расширяемой
  поверхностью для будущих skills и prompt templates.
- Изображение можно:
  - выбрать через системный file picker;
  - перетащить в любое место открытого чата;
  - вставить через `Cmd+V`.
- Обычная вставка текста не меняет существующее поведение.
- Лимиты являются настройками демона и сразу отображаются в Settings. Изменение применяется к
  следующим операциям без перезапуска.
- При создании новой сессии после принятия создания пользователь попадает сразу в Chat. Первый
  текст/изображения являются draft этого Chat. Если первый turn отклонён, ошибка показывается в
  Chat, а draft сохраняется для повторной отправки.
- Изображения поддерживаются одинаково для обычного turn и режимов `steer`, `follow-up`,
  `next-turn`, `append`.
- Text-only модель не может принять сообщение с изображениями. Ничего не удаляется молча:
  композер сохраняет draft и объясняет причину отказа.

## Публичный протокол

В `packages/protocol/src/session.ts` добавляется общий тип:

```ts
export const sessionImageMimeTypes = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
] as const;

export type SessionImageMimeType = (typeof sessionImageMimeTypes)[number];

export type SessionImage = {
  mimeType: SessionImageMimeType;
  /** Чистый base64 без `data:` prefix. */
  data: string;
};

export type SessionImageMessage = {
  text: string;
  images?: SessionImage[];
};
```

`TurnRequest` расширяется полем `images?: SessionImage[]`:

```ts
type TurnRequest = {
  text: string;
  images?: SessionImage[];
  model?: string;
  thinkingLevel?: ThinkingLevel;
};
```

`SessionMessage` получает то же поле:

```ts
type SessionMessage = {
  text: string;
  images?: SessionImage[];
  mode: SessionMessageMode;
};
```

`SessionDraft` не получает message content. Создание сессии остаётся операцией выбора project,
agent и model; первый turn выполняется уже в Chat через обычный `TurnRequest`. Это устраняет
дублирование протокола и позволяет одинаково показывать отказ обычного и первого turn.

### Нормализация и валидация

`parseTurnRequest` и `parseSessionMessage` используют общий `parseSessionImageMessage`:

1. `raw` и его image entries должны быть объектами;
2. `mimeType` должен входить в `sessionImageMimeTypes`;
3. `data` должен быть непустой canonical base64 без whitespace и без `data:` prefix;
4. base64 должен декодироваться без ошибки;
5. декодированный payload обязан начинаться с сигнатуры соответствующего формата:
   - JPEG `FF D8 FF`;
   - PNG `89 50 4E 47 0D 0A 1A 0A`;
   - GIF `GIF87a` или `GIF89a`;
   - WebP `RIFF....WEBP`;
6. количество, размер одного image и суммарный размер проверяются значениями runtime config;
7. текст может быть пустым/состоять из пробелов только если есть хотя бы одно изображение;
8. пустые сообщения без текста и изображений отвергаются;
9. неизвестные поля отвергаются так же, как неизвестные поля остальных session requests.

Parser не читает filesystem и не декодирует изображения в UI-специфичный объект. Он возвращает
чистый protocol value или diagnostics. Для HTTP-отказа daemon использует существующий формат
`{ error: string }`; статусы и действия UI зафиксированы в разделе «Ошибки и наблюдаемость».

### Лимиты

В `Config` добавляются четыре ключа:

```ts
maxImageBytes: number;
maxImagesPerMessage: number;
maxMessageImageBytes: number;
maxSessionImageBytes: number;
```

Значения по умолчанию:

| Ключ                   |            Значение |
| ---------------------- | ------------------: |
| `maxImageBytes`        |  `10 * 1024 * 1024` |
| `maxImagesPerMessage`  |                 `8` |
| `maxMessageImageBytes` |  `32 * 1024 * 1024` |
| `maxSessionImageBytes` | `256 * 1024 * 1024` |

Ограничения применяются к декодированным байтам, а не к длине base64. Это делает лимит
одинаковым для picker, paste, JSON API и восстановленной сессии.

Проверка `maxSessionImageBytes` считается по всей сессии, включая все ветки и сообщения, которые
уже записаны в JSONL. В очередях учитываются только сообщения, которые ещё не записаны Pi, чтобы
одна и та же нагрузка не считалась дважды. Для нового сообщения daemon сначала валидирует payload
и текущий итог сессии, затем резервирует/записывает его атомарно в существующей последовательной
операции сессии. При превышении лимита запись не создаётся.

HTTP body limit для `POST /turns` и `POST /messages` вычисляется из `maxMessageImageBytes`
(base64 expansion плюс фиксированный JSON overhead), а не остаётся прежним маленьким общим
лимитом daemon. Остальные маршруты сохраняют свой текущий предел. При превышении body limit
dispatcher возвращает `413` до JSON parsing.

UI применяет те же лимиты для раннего feedback, но daemon является источником истины. Если
настройка изменилась между выбором и отправкой, пользователь получает отказ и сохранённый draft.

## Runtime-контракт Pi

Внутренний runtime передаёт изображения через штатный Pi тип:

```ts
type PiImage = {
  type: "image";
  data: string;
  mimeType: SessionImageMimeType;
};
```

Нормализатор сообщения строит `content` в устойчивом порядке: сначала text block, если текст
непустой, затем image blocks в порядке добавления. Для image-only сообщения `content` содержит
только image blocks.

Все пять путей используют один нормализатор:

- обычный turn: `harness.prompt(text, { images })`;
- `steer`: `harness.steer(text, { images })`;
- `follow-up`: `harness.followUp(text, { images })`;
- `next-turn`: `harness.nextTurn(text, { images })`;
- `append`: `harness.appendMessage({ role: "user", content })`.

Нельзя реализовывать отдельные «image versions» этих пяти путей. Вызов любого пути сначала
проверяет capability выбранной модели, затем вызывает Pi; text-only модель отбрасывается до
provider request.

Capability определяется по текущему model catalog. Для запроса с image blocks требуется
`model.input` с `"image"`; это уже существует в публичном `ModelSummary`, поэтому новый capability
registry не вводится. Если capability неизвестна, модель считается text-only: fail closed.

Проверка выполняется для каждой операции, которая может построить контекст или отправить его
провайдеру:

- перед запуском нового turn;
- при отложенном старте queued turn;
- перед `steer`, `follow-up`, `next-turn` и `append`;
- при `setModel`, если активная ветка или очереди содержат image blocks;
- перед compaction и перед navigation с `summarize`;
- перед provider request как последняя защита.

После появления изображения в активной ветке нельзя переключить её на text-only модель и нельзя
продолжить даже текстовым сообщением на такой модели: новый контекст всё равно содержит image
block. Проверяется именно активная ветка; изображения в брошенной ветке не попадают в новый
контекст. Общий `maxSessionImageBytes` при этом считает все persisted message entries сессии,
включая брошенные ветки.

Если сообщение уже принято в `steer`/`follow-up`/`next-turn`, его image blocks сохраняются в
очереди вместе с текстом. Очереди наружу больше не являются `string[]`:

```ts
export type SessionQueuedMessage = {
  text: string;
  images?: SessionImage[];
};

export type SessionQueues = {
  steer: SessionQueuedMessage[];
  followUp: SessionQueuedMessage[];
  nextTurn: SessionQueuedMessage[];
};
```

UI показывает queued image thumbnails, а не только текст. Payload не меняется при round-trip
через snapshot/reconnect. Пока сообщение находится только в queue, оно не является persisted
entry; если процесс завершился до того, как Pi записал его в JSONL, оно теряется по той же
семантике, что и существующие queued text messages. После записи Pi его lifecycle такой же, как
у обычного user message.

## Persistence и история

Для пользовательского сообщения Pi JSONL остаётся единственным persistence layer. Вызов Pi
получает image blocks с исходным base64; отдельного преобразования байтов, resize, transcoding,
hashing или удаления метаданных не выполняется.

Перевод записи Pi в публичный `SessionEntry` расширяется блоком:

```ts
export type SessionContentBlock =
  | { kind: "text"; text: string }
  | { kind: "image"; mimeType: SessionImageMimeType; data: string }
  | { kind: "reasoning"; text: string }
  | { kind: "tool-call"; toolCallId: string; toolName: string; input: unknown };
```

Любое user message из JSONL сохраняет весь порядок `text`/`image` blocks. Нельзя сворачивать
изображения в placeholder или отбрасывать image-only user messages. Unknown content blocks
остаются безопасными и не ломают чтение существующих сессий.

Fork, archive, restart и pagination не декодируют и не перегенерируют data: они используют
существующий persisted entry path, поэтому изображения доступны во всех этих сценариях. Если Pi
создаёт fork как новый JSONL, скопированная история считается частью лимита новой сессии;
никаких ссылок на внешний blob или общего GC для этого не вводится.

Для streaming:

- user image message публикуется одним message delta вместе с его image blocks. Для queued
  `steer`/`follow-up`/`next-turn` это происходит в момент фактического принятия Pi, а не в момент
  постановки в очередь;
- assistant text/reasoning streaming остаётся прежним;
- assistant image streaming в срез не добавляется;
- renderer обязан корректно принять сохранённый user image block, даже если live delta его не
  содержит.

Для live user message protocol добавляет отдельную дельту полного содержимого:

```ts
| {
    kind: "message-blocks";
    messageId: string;
    blocks: Array<
      | { kind: "text"; text: string }
      | { kind: "image"; mimeType: SessionImageMimeType; data: string }
    >;
  }
```

Она используется только для user message и приходит один раз после `message-start`; старые
`message-delta` для assistant text/reasoning не меняются. Браузер при reconnect перечитывает
persisted entry и не пытается восстановить пропущенную live delta.

## Композер и ввод

### Единый draft model

Оба композера используют общую модель:

```ts
export type ComposerDraft = {
  text: string;
  images: SessionImage[];
};
```

`MessageComposer` и `NewSessionView` не имеют отдельных правил для picker/paste/drop. Общие
функции:

- `readImageFile(file)`;
- `imageFromClipboardItem(item)`;
- `normalizeImageInputs(files/items)`;
- `canAddImages(draft, additions, limits)`.

Они возвращают оригинальные bytes в base64, не data URL. File input очищается после чтения, чтобы
повторный выбор того же файла снова вызвал `change`.

### Кнопка `+`

В нижней левой части toolbar появляется icon-only button с доступным именем и tooltip.
Используется существующая библиотека компонентов `ui-kit`; отдельная иконка/меню-библиотека не
добавляется.

Открытое меню содержит один action `Изображение`, который открывает скрытый
`<input type="file" accept="image/jpeg,image/png,image/gif,image/webp" multiple>`.
Action не отправляет сообщение сам: он только добавляет изображения в draft. При закрытом меню
не должно быть невидимого submit.

В draft preview у каждого изображения есть icon-only remove button с доступным именем. У
image-only draft последняя картинка тоже может быть удалена; после этого submit снова требует
непустой текст. При смене проекта/агента или route draft очищается только существующим
намеренным reset action, а не из-за временного отказа модели.

### Drag-and-drop

Drop zone — открытый Chat surface, а не только textarea. Если `DataTransfer` содержит хотя бы
одно поддержанное image file:

- `dragover` на поверхности предотвращает browser navigation;
- `drop` предотвращает открытие файла браузером;
- все поддержанные изображения добавляются одной пачкой в draft;
- текстовые/неподдержанные файлы игнорируются и не запускают `@файл`;
- превышение лимита показывает ошибку рядом с composer, draft до drop не изменяется.

Если drop не содержит поддержанного изображения, существующее поведение страницы не ломается.

### Cmd+V

Paste handler смотрит `clipboardData.items`:

- image items читаются и добавляются все вместе;
- plain text вставляется в textarea в текущую selection;
- mixed clipboard добавляет images и вставляет text;
- при наличии image item handler предотвращает default только после ручной вставки text, чтобы
  изображение не превращалось в браузерный object URL;
- обычный text-only paste оставляет native textarea behavior.

Для file picker и drop batch валиден атомарно: если один файл в пачке не поддержан или превышает
лимит, ни один новый файл из этой пачки не добавляется, а уже существующий draft не меняется.
Для mixed clipboard plain text вставляется независимо от отказа image item, потому что текст и
картинки в clipboard имеют разные пользовательские операции.

Изображение хранится в draft до успешного acceptance. Ошибка чтения, MIME или лимита
показывается как composer error; сетевой отказ также не очищает draft.

## Отображение истории

`session-message-list` обрабатывает `kind: "image"`:

- inline thumbnail внутри user message;
- сетка, если изображений больше одного;
- сохранение пропорций;
- click открывает Dialog с полноразмерным оригиналом;
- Dialog поддерживает previous/next, счётчик, Escape и download original;
- `src` строится как `data:${mimeType};base64,${data}`;
- alt не содержит base64 и локализуется;
- image-only message имеет тот же bubble/layout, что и текстовое сообщение;
- порядок блоков в смешанном сообщении соответствует `content`.

Кнопка уже существующего copy-last-answer считается выполненной функциональностью и в этот
срез не добавляется/не дублируется.

Ограничение Dialog: один открытый viewer на сообщение, без записи изображения в filesystem и
без публичного URL. Скачивание создаёт Blob только в браузере и не меняет сессию.

## New session flow и ошибки

Новый экран не отправляет первый turn в фоне до navigation. Flow:

1. `POST /api/sessions` создаёт сессию;
2. UI переходит на Chat route;
3. `ChatView` получает `initialDraft` через существующий in-memory navigation/state bridge;
4. Chat вызывает обычный `POST .../turns` с текстом, images, model и thinkingLevel;
5. при accepted draft очищается;
6. при refusal/error Chat показывает `Notice`/ошибку в Chat и сохраняет весь draft.

Reload до отправки может потерять только несохранённый browser state; после принятия daemon
сохраняет image blocks в JSONL. Не добавляется отдельный серверный draft endpoint.

Navigation происходит после успешного `POST /api/sessions`, но не ждёт принятия первого turn:
ошибка первого turn должна быть видна в Chat, а не на стартовой форме. Если ответ первого turn
потерян из-за network timeout, Chat остаётся на сессии с сохранённым draft и предлагает обычную
повторную отправку; вторая сессия не создаётся. Если daemon успел принять turn, повторная
отправка автоматически не выполняется, чтобы не дублировать сообщение.

В обычной сессии отказ любого типа не удаляет draft. Это правило действует одинаково для:

- malformed image;
- лимита;
- text-only model;
- неизвестной/пропавшей модели;
- busy/queue refusal;
- network/HTTP error.

## Ошибки и наблюдаемость

Daemon возвращает существующие HTTP semantics:

- `400` — malformed image payload, неподдержанный MIME, invalid base64/signature;
- `413` — HTTP body или декодированный message payload превышает соответствующий request limit;
- `409` — превышен session image budget, недопустимый режим занятости или несовместимая текущая
  модель;
- `404` — неизвестная сессия/проект;
- `5xx` — только непредвиденная ошибка сервера.

Причина должна называть конкретный объект и предел, например:

- `image 2 has unsupported MIME type`;
- `image 1 exceeds maxImageBytes`;
- `message exceeds maxMessageImageBytes`;
- `session exceeds maxSessionImageBytes`;
- `the selected model does not accept image input`.

Отказ после HTTP acceptance (queued turn, provider/runtime error, lost SSE) не меняет уже
возвращённый статус. Он публикуется существующим `turn-failed`/`phase` event с причиной, без
base64. UI маркирует pending/live message ошибкой и не очищает draft, если сообщение ещё не было
записано; если user entry уже записан, entry остаётся видимым, а повторная отправка является
явным действием пользователя.

Маршрут не логирует base64, data URL или содержимое изображения. Логи содержат только
идентификатор сессии, режим, число изображений, декодированный размер и результат валидации.

## Settings

Новые четыре ключа входят во все существующие поверхности настроек:

- `Config` и parser;
- config API;
- UI Settings form;
- live config subscription/reload.

UI показывает человекочитаемые MiB/шт. значения, но отправляет целые байты/числа. Проверка
положительная и строгая:

- `maxImageBytes >= 1`;
- `maxImagesPerMessage >= 1`;
- `maxMessageImageBytes >= maxImageBytes`;
- `maxSessionImageBytes >= maxMessageImageBytes`.

Нарушение взаимных ограничений отклоняет весь config update без частичного применения. Live
изменение влияет на новые input/requests; уже сохранённые сообщения не пересчитываются и не
удаляются.

## TDD и проверка

Тесты должны сначала доказать RED, затем реализацию GREEN, затем общий refactor.

Обязательные группы:

1. **Protocol**
   - text+image и image-only;
   - несколько изображений;
   - MIME/base64/signature;
   - все четыре лимита и unknown keys;
   - очередь с images.
2. **Runtime**
   - единый нормализатор для prompt/steer/followUp/nextTurn/append;
   - передача Pi image block без изменения байтов;
   - fail-closed для text-only/unknown capability;
   - queue snapshot сохраняет payload.
3. **Daemon**
   - validation до provider;
   - session aggregate limit;
   - persistence/reopen/archive/fork;
   - отказ не пишет запись.
4. **Web**
   - picker multiple;
   - drag-and-drop на Chat surface;
   - Cmd+V image-only, text-only и mixed;
   - limits/error preserve draft;
   - model incompatibility disables submit but not removal;
   - queued thumbnails;
   - history grid/dialog/navigation/download;
   - new session navigates to Chat before first turn and renders refusal there.
5. **Regression**
   - existing text-only requests unchanged;
   - existing copy button remains;
   - `make check`.

## Почему так

### Inline Pi JSONL, а не новый storage

Pi уже является persistence layer для истории. Inline image blocks дают restart/archive/fork/
pagination без нового ownership lifecycle, binary route и garbage collector. Жёсткие лимиты
делают этот путь контролируемым.

### Один нормализатор для пяти режимов

Разные реализации prompt/steer/follow-up/next-turn/append быстро расходятся по порядку блоков,
лимитам и обработке image-only. Общий message payload и один normalizer сохраняют семантику
сообщения во всех режимах.

### Fail closed для capability

У text-only модели нет безопасного способа «попробовать и посмотреть»: provider может принять
запрос, потерять image blocks или вернуть менее понятную ошибку. Неизвестная capability поэтому
считается несовместимой; UI и daemon делают одну и ту же проверку.

### Почему `@файл` отдельно

`@файл` — адресуемый проектный ресурс, а не вложение байтов. Он требует отдельного контракта
по project root, безопасности, поиску и инструментам. Смешивать его с image payload означало бы
получить два разных lifecycle в одном срезе.

### Почему не base64 в URL и не sidecar

Data URL используется только для локального renderer. В wire и JSONL лежит чистый base64.
Sidecar/Blob store отвергнуты: они добавляют storage lifecycle без текущей продуктовой выгоды.
