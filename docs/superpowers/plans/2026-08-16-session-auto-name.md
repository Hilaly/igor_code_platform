# Автоименование сессии из первого сообщения — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers.subagent-driven-development` (recommended) or `superpowers.executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for durable tracking; mirror current status through `mission-update`.

**Goal:** Безымянная сессия получает имя, сгенерированное демоном из первого текстового сообщения, — сессия, созданная с текстом, не должна висеть в списках как «Без названия».

**Architecture:** Имя вычисляет и пишет демон при принятии первого турна с текстом у безымянной сессии — существующим механизмом `PersistedAgentSession.setName` (тем же, что у `PUT /sessions/:id` и `/rename`). Правило живёт в службе сессий (`apps/daemon/src/sessions/sessions.ts`): публичный контракт `packages/protocol` не меняется, рантайм `packages/agent-runtime-pi` не трогается.

**Tech Stack:** TypeScript, демон `apps/daemon`, node:test, pnpm, Makefile (`make check`).

## Global Constraints

- TDD: тест пишется до реализации и обязан упасть на RED (CLAUDE.md §5, скил `superpowers.test-driven-development`).
- Коммиты — Conventional Commits, сообщения на английском, один коммит — одно логическое изменение (CLAUDE.md §3).
- Документация — на русском; живёт в том же коммите, что и вызвавшее её изменение кода (CLAUDE.md §2).
- Публичный контракт `packages/protocol` не меняется: `SessionDraft` и `TurnRequest` остаются как есть.
- Итоговая проверка — `make check` (typecheck, lint, fmt-check, test) без ошибок (CLAUDE.md §6).
- Процессы, создающие воркеры, запускаются с `env -u WATCH_REPORT_DEPENDENCIES` (CLAUDE.md §0).
- Имя — запись в дерево сессии, а не свойство harness: переименование и так работает рядом с идущим турном (docs/sessions-and-projects.md).

---

### Task 1: Имя сессии из первого сообщения

**Files:**

- Modify: `apps/daemon/src/sessions/sessions.ts` — константа предела и функция генерации имени (module-level, после `maximumSkillBytes`), `nameFromFirstMessage` (внутри сервиса, перед `prompt`), вызов в `prompt` после принятия турна.
- Modify: `apps/daemon/src/sessions/sessions.test.ts` — пять тестов в `describe("the session lifecycle over http")`, после теста «clears the session name when the replacement body omits it».
- Modify: `docs/sessions-and-projects.md` — правило в основном тексте (после абзаца «Архивация и удаление требуют простоя, переименование — нет.») и раздел в «Почему так» (перед «### Сессия доигрывает, а не останавливается»).
- Modify: `docs/web-api.md` — правило после абзаца «**Переименование простоя не требует,**…» и правка абзаца «**`title` у сессии необязателен.**».

**Interfaces:**

- Consumes: `options.store.open(sessionId)` → `PersistedAgentSession | undefined`; `persisted.setName(name: string)`; `find(sessionId)` → `AgentSessionSummary | undefined`; `refresh()`; `PromptRequest.text` (определён только у обычной реплики — у скила и шаблона его нет).
- Produces: приватные `sessionNameFromMessage(text: string): string` и `nameFromFirstMessage(sessionId: string, request: PromptRequest): Promise<void>` (ни наружу, ни в контракт не выходят).

- [ ] **Step 1: Написать падающие тесты**

Вставить в `apps/daemon/src/sessions/sessions.test.ts` после теста «clears the session name when the replacement body omits it» (перед «archives a session out of the list…»):

```ts
it("names a fresh session from the first text message", async () => {
  const { call, start } = await serve();
  const sessionId = String((await start()).body["id"]);

  assert.equal(
    ((await call("GET", sessionsPath)).body as unknown as SessionsSnapshot).sessions[0]?.title,
    undefined,
  );

  assert.equal(
    (
      await call("POST", sessionTurnsPath(sessionId), {
        text: "помоги разобрать баг\nвот подробности",
      })
    ).status,
    200,
  );

  // Имя пишется вместе с принятием турна: списку оно видно сразу, а не после конца турна.
  assert.equal(
    ((await call("GET", sessionsPath)).body as unknown as SessionsSnapshot).sessions[0]?.title,
    "помоги разобрать баг",
  );
});

it("truncates the generated name at the limit of the daemon", async () => {
  const { call, start } = await serve();
  const sessionId = String((await start()).body["id"]);

  await call("POST", sessionTurnsPath(sessionId), { text: "а".repeat(100) });

  // Предел генератора — 60 символов: столько же вмещает строка сайдбара без переноса.
  assert.equal(
    ((await call("GET", sessionsPath)).body as unknown as SessionsSnapshot).sessions[0]?.title,
    `${"а".repeat(60)}…`,
  );
});

it("keeps a name given before the first turn", async () => {
  const { call, start } = await serve();
  const sessionId = String((await start()).body["id"]);

  await call("PUT", sessionPath(sessionId), { title: "разбор бага", archived: false });

  await call("POST", sessionTurnsPath(sessionId), { text: "первый текст" });

  // Имя, данное руками, первый текст не перетирает.
  assert.equal(
    ((await call("GET", sessionsPath)).body as unknown as SessionsSnapshot).sessions[0]?.title,
    "разбор бага",
  );
});

it("leaves the session unnamed when the first turn has no text", async () => {
  const { call, start } = await serve({ input: ["text", "image"] });
  const sessionId = String((await start()).body["id"]);
  const payload = Buffer.alloc(16);

  payload.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  // Скриншот без единого слова — законная просьба, но имени из неё не выйдет.
  assert.equal(
    (
      await call("POST", sessionTurnsPath(sessionId), {
        images: [{ mimeType: "image/png", data: payload.toString("base64") }],
      })
    ).status,
    200,
  );

  assert.equal(
    ((await call("GET", sessionsPath)).body as unknown as SessionsSnapshot).sessions[0]?.title,
    undefined,
  );
});

it("does not name the session from a skill invocation", async () => {
  const directory = mkdtempSync(join(workspace, `skill-secret-`));

  writeFileSync(join(directory, "SKILL.md"), "почини сборку и ничего больше", "utf8");

  const secret = skill("secret", { location: join(directory, "SKILL.md") });
  const agent: AgentContributionRegistration = {
    ...baseAgent,
    skills: { include: ["secret"], exclude: [] },
  };
  const { call, start } = await serve({
    turns: [{ text: "починил" }],
    contributions: { base: () => [agent], forProject: () => [agent, secret] },
  });
  const sessionId = String((await start()).body["id"]);

  assert.equal(
    (
      await call("POST", sessionTurnsPath(sessionId), {
        skill: "secret",
        instructions: "начни с тестов",
      })
    ).status,
    200,
  );
  await untilIdle(call, sessionId);

  // Имя принадлежит просьбе человека: инструкции скила сессию не называют.
  assert.equal(
    ((await call("GET", sessionsPath)).body as unknown as SessionsSnapshot).sessions[0]?.title,
    undefined,
  );
});
```

Все импорты, нужные тестам (`mkdtempSync`, `writeFileSync`, `join`, `workspace`, `skill`, `untilIdle`, `sessionsPath`, `sessionPath`, `sessionTurnsPath`, `SessionsSnapshot`), в файле уже есть.

- [ ] **Step 2: Запустить тесты, увидеть падение**

Run: `cd apps/daemon && env -u WATCH_REPORT_DEPENDENCIES node --test src/sessions/sessions.test.ts`

Expected: 5 новых провалов вида `AssertionError [ERR_ASSERTION]: undefined == 'помоги разобрать баг'` — имя никто не генерирует. Остальные 92 теста зелёные.

- [ ] **Step 3: Реализовать генерацию имени**

В `apps/daemon/src/sessions/sessions.ts`, module-level, после константы `maximumSkillBytes` (перед `export function createSessionService`):

```ts
/**
 * Предел имени, сгенерированного из первого сообщения. Больше в строке сайдбара не помещается,
 * а имя всё равно переименовываемое: точную формулировку человек поправит руками.
 */
const maximumGeneratedSessionNameLength = 60;

/**
 * Имя сессии из первого сообщения: первая непустая строка, усечённая до предела с многоточием.
 * Вызывающий гарантирует непустой текст, поэтому пустого результата здесь не бывает.
 */
function sessionNameFromMessage(text: string): string {
  const line =
    text
      .split("\n")
      .map((candidate) => candidate.trim())
      .find((candidate) => candidate !== "") ?? text.trim();

  return line.length <= maximumGeneratedSessionNameLength
    ? line
    : `${line.slice(0, maximumGeneratedSessionNameLength)}…`;
}
```

Внутри сервиса, непосредственно перед `const prompt = async (request: PromptRequest)`:

```ts
/**
 * Безымянная сессия получает имя из первого же текстового сообщения. Только обычная реплика:
 * у скила и шаблона своего текста нет, и имя от инструкций скила было бы про скил, а не про
 * просьбу. Имя — обычная запись в дерево, поэтому рядом с идущим турном оно безопасно, ровно
 * как переименование (docs/sessions-and-projects.md).
 */
const nameFromFirstMessage = async (sessionId: string, request: PromptRequest): Promise<void> => {
  if (request.text === undefined || request.text.trim() === "") {
    return;
  }

  const summary = find(sessionId);

  if (summary === undefined || summary.name !== undefined) {
    return;
  }

  const persisted = await options.store.open(sessionId);

  if (persisted === undefined) {
    return;
  }

  await persisted.setName(sessionNameFromMessage(request.text));
  await refresh();
};
```

В `prompt`, сразу после `tracked.validating = false;`:

```ts
// Безымянная сессия получает имя из первого текстового сообщения. До `announce`: разосланный
// снимок обязан уже нести имя (docs/sessions-and-projects.md).
await nameFromFirstMessage(sessionId, request);
```

Почему именно там: турн уже принят (`place.start` вернул слот) — отказ после этого невозможен, гонки двух турнов одной сессии нет (слот резервируется до имени), а имя пишется до `announce()`, то есть уходит в разосланный снимок сразу. Гвард по `request.text === undefined` отсекает скил и шаблон; `trim() === ""` — турн без текста (одна картинка). Прямой вызов службы с пробельным текстом тоже не называет сессию, хотя HTTP-парсер и так обрезает текст.

- [ ] **Step 4: Запустить тесты, увидеть прохождение**

Run: `cd apps/daemon && env -u WATCH_REPORT_DEPENDENCIES node --test src/sessions/sessions.test.ts`

Expected: 97 pass, 0 fail.

- [ ] **Step 5: Обновить документацию**

В `docs/sessions-and-projects.md`, в основном тексте после абзаца «**Архивация и удаление требуют простоя, переименование — нет.**…»:

```markdown
**Безымянная сессия получает имя из первого же текстового сообщения.** Имя — первая непустая
строка, усечённая до 60 символов с многоточием; пишет его демон при принятии турна тем же
механизмом, что `/rename`. Уже названную сессию первый текст не переименовывает, а сообщение без
текста (одна картинка) имени не даёт. Скил и шаблон сессию тоже не называют: их текст — инструкции,
а имя принадлежит просьбе человека.
```

В том же файле, в «Почему так», перед «### Сессия доигрывает, а не останавливается»:

```markdown
### Имя сессии из первого сообщения

**Имя обязательным полем формы создания (`SessionDraft.name`).** Полный контроль, но это ломающее
изменение публичного контракта и лишнее действие на стартовом экране. Отвергнуто: сессия создаётся
и без текста, и поле было бы пустым в большей части случаев.

**Имя считает браузер и пишет `PUT /sessions/:id` после создания.** Контракт не меняется, но имя
появляется вторым запросом, а между созданием и записью сессия в списке безымянная. Отвергнуто:
демон умеет имя и без браузера, а SDK и плагины получили бы другое поведение, чем интерфейс.

Цена принятого варианта: правило живёт в демоне — единое для браузера, SDK и плагинов; имя может не
совпасть с тем, что человек хотел бы видеть, поэтому оно переименовываемое, а у генератора есть
предел 60 символов.
```

В `docs/web-api.md`, после абзаца «**Переименование простоя не требует,**…»:

```markdown
**Безымянная сессия получает имя из первого текстового сообщения.** Имя берёт демон при принятии
турна: первая непустая строка, усечённая до 60 символов с многоточием. Уже названную сессию первый
текст не переименовывает; турн без текста (одна картинка), скил и шаблон имя не дают
([sessions-and-projects.md](sessions-and-projects.md)).
```

Там же переписать абзац «**`title` у сессии необязателен.** Безымянная сессия — норма, а не переходное состояние: имя даётся не при создании, а когда захочется…» — имя теперь даётся не формой, а первым текстовым сообщением либо переименованием:

```markdown
**`title` у сессии необязателен.** Безымянная сессия — норма, а не переходное состояние: имя даётся
не формой создания, а первым текстовым сообщением либо переименованием, поэтому клиент обязан уметь
показать сессию без имени.
```

- [ ] **Step 6: Полная проверка**

Run: `make check` (из корня репозитория; при падении тестов из-за воркеров — те же команды с `env -u WATCH_REPORT_DEPENDENCIES`).

Expected: typecheck без ошибок, eslint без ошибок, prettier без диффов, все тесты зелёные.

- [ ] **Step 7: Коммит**

```bash
git add apps/daemon/src/sessions/sessions.ts apps/daemon/src/sessions/sessions.test.ts docs/sessions-and-projects.md docs/web-api.md
git commit -m "feat(sessions): name a session from its first message"
```

Тело коммита — почему: сессия, созданная с текстом, висела в списках как «Без названия», пока её
не переименуют вручную; имя генерирует демон при первом текстовом турне, чтобы правило было единым
для браузера, SDK и плагинов, а контракт не менялся. Имя — запись в дерево, как `/rename`.
