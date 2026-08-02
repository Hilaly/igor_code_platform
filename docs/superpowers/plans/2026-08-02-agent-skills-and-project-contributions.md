# Agent Skills and Project Contributions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Добавить файловых агентов и Agent Skills из standalone- и plugin-owned-каталогов, разрешать все потребляемые сессией вклады в контексте проекта, применять изменения без перезапуска демона и показывать состояние файлов в Web UI.

**Architecture:** Один реестр хранит объявления вместе с владельцем и источником, но разрешает их отдельно для базового каталога и для конкретного `projectId`. Общий файловый слой разбирает `AGENT.md` и `SKILL.md`; plugin supervisor применяет plugin-owned-файлы атомарно с программными вкладами, а постоянно работающий standalone-сервис обслуживает пользовательские и проектные корни. Session service перед каждым турном повторно разрешает агента, tools и skills, а Pi получает динамический XML-каталог скилов через вычисляемый системный prompt.

**Tech Stack:** TypeScript 5.9, Node.js 24 (`node:test`, `node:fs`, `fs.watch`), `yaml` 2.9, Pi Agent Core 0.82.1, React 19, Vitest, Testing Library, pnpm workspaces, ESLint 9, Prettier 3.

## Global Constraints

- Работать в `/Users/user/repos/sovereign_platform_node/.worktrees/agent-skill-support` на ветке `feat/agent-skill-support`.
- Реализацию вести TDD-циклами; каждый task заканчивается зелёными локальными проверками и отдельным Conventional Commit.
- Актуальную документацию обновлять в том же коммите, что и описываемый код. Постоянные документы `docs/*.md` обязаны быть самодостаточными и не должны ссылаться на файлы из `docs/superpowers/specs/` или `docs/superpowers/plans/`.
- Добавить один runtime dependency `yaml@^2.9.0` в `@sovereign/daemon`; другие зависимости не добавлять.
- Разбирать YAML 1.2 через `parseDocument(..., { uniqueKeys: true })`: синтаксическая ошибка или повтор ключа делают только текущее определение некорректным; неизвестные frontmatter-поля игнорируются.
- Ограничить каждый `AGENT.md` и `SKILL.md` размером 1 МиБ (1 048 576 байт), проверяя размер до чтения и разбора. Соседние ресурсы не измерять и не обходить ради квоты: их читает модель по необходимости обычными tools.
- Discovery нерекурсивный: определениями считаются только `<root>/<name>/AGENT.md` и `<root>/<name>/SKILL.md`; вложенное дерево является ресурсами определения.
- Симлинки не разыменовывать. Ссылка вместо definition directory или entry-файла даёт локальную диагностику `unsupported-symlink`. Соседние ресурсы loader не индексирует; watcher не следит за внешними link targets и не обещает им hot reload.
- Имя агента и скила обязательно совпадает с именем директории. Допустимы строчные латинские буквы, цифры, `_` и `-`, длина 1–64; дефис не бывает первым, последним или двойным. `_` законен, но для скила создаёт warning о переносимости.
- `AGENT.md` требует `name`, `description` и непустой Markdown body. Неуказанные `tools` и `skills` нормализуются в `{ include: [], exclude: [] }`.
- `SKILL.md` требует `name` и `description`; поддерживает `license`, `compatibility`, `metadata`, `allowed-tools` и Pi-поле `disable-model-invocation`. `allowed-tools` проверяется и сохраняется, но в этом срезе не меняет runtime-набор tools.
- Активация скила происходит обычным `read` по абсолютному `location`; не добавлять `activate_skill`, `/skill:name` или другую явную пользовательскую активацию.
- Не защищать прочитанный `SKILL.md` от compaction и не добавлять специальный вид сообщения: результат `read` остаётся обычным результатом инструмента.
- Не создавать `<built-in>/agents` или `<built-in>/skills`. Встроенные ресурсы лежат только в существующих `plugins/<plugin>/agents` и `plugins/<plugin>/skills`.
- Discovery обязан вычислять plugin-owned-каталоги только относительно `DiscoveredPlugin.directory`: в dev это `plugins/<plugin>/{agents,skills}`, в production — распакованный `<data-directory>/builtin/<version>/<plugin>/{agents,skills}`. Отдельный путь ресурсов и новую раскладку built-in не добавлять.
- Мигрировать базового агента в `plugins/base-agent/agents/agent/AGENT.md`, сохранить итоговый id `base-agent.agent`, explicit selectors `include: ["*"]` для tools и пустой selector для skills. Worker остаётся точкой жизненного цикла плагина, но больше не регистрирует агента программно.
- Файловая диагностика отдаётся одним непагинированным снимком `{ revision, resources, diagnostics }` с утверждёнными состояниями `active | shadowed | switched-off | invalid`. Редактирование файлов, переключение standalone-ресурсов и управление ими из project view не входят в срез.
- Не зависеть от реализации среза 11 и не переносить из неё код tools/hooks. Эта ветка создаёт его фундамент: реестр разрешает любой зарегистрированный вид вклада после project-фильтрации, а model-operation context несёт `projectId`. Будущие plugin tools и hook subscriptions подключаются к этим швам позднее.
- Существующий `GET /api/agents` сохраняется и возвращает базовый каталог без project-owned-ресурсов. Форма создания сессии использует только `GET /api/projects/:projectId/agents`.
- Для сохранённой сессии без применимого агента история и чтение остаются доступны, composer блокируется, а операции, требующие harness, отвечают `409`. Возврат агента через hot reload восстанавливает работу без миграции записи.

---

### Task 1: Общие контракты селекторов, скилов, файлового API и события

**Files:**

- Create: `packages/protocol/src/file-resource.ts`
- Create: `packages/protocol/src/file-resource.test.ts`
- Modify: `packages/protocol/src/tool-pattern.ts`
- Modify: `packages/protocol/src/tool-pattern.test.ts`
- Modify: `packages/protocol/src/contribution.ts`
- Modify: `packages/protocol/src/session.ts`
- Modify: `packages/protocol/src/project.ts`
- Modify: `packages/protocol/src/events.ts`
- Modify: `packages/protocol/src/events.test.ts`
- Modify: `packages/protocol/src/index.ts`
- Modify: `packages/sdk/src/host.ts`
- Modify: `packages/sdk/src/index.ts`
- Modify: `packages/sdk/src/index.test.ts`
- Modify: `docs/public-contract.md`
- Modify: `docs/plugins.md`
- Modify: `docs/event-bus.md`

**Interfaces:**

- Consumes: существующие `AgentToolSelection`, `selectToolNames`, `ContributionRegistration`, `AgentSummary`, `CoreEventPayloads`.
- Produces: `NamePatternSelection`, `AgentSkillSelection`, `SkillContributionRegistration`, `FileResourceSummary`, `FileResourcesSnapshot`, project path helpers и `core.contributions.changed`.

- [ ] **Step 1: Написать падающие тесты общего селектора имён**

В `packages/protocol/src/tool-pattern.test.ts` добавить тесты, которые используют общий API:

```ts
const selection: NamePatternSelection = {
  include: ["github.*", "code-*"],
  exclude: ["*-unsafe"],
};

assert.deepEqual(selectNames(["github.review", "code-safe", "code-unsafe", "notes"], selection), [
  "github.review",
  "code-safe",
]);
assert.deepEqual(selectNames(["read"], { include: [], exclude: [] }), []);
```

Проверить, что `AgentToolSelection` и новый `AgentSkillSelection` совместимы с
`NamePatternSelection`, а `exclude` выигрывает у `include`.

- [ ] **Step 2: Написать падающие тесты wire-контрактов**

В `file-resource.test.ts` проверить пути и точную форму снимка:

```ts
assert.equal(projectAgentsPath("p/1"), "/api/projects/p%2F1/agents");
assert.equal(projectFileResourcesPath("p/1"), "/api/projects/p%2F1/file-resources");

const diagnostic: FileResourceDiagnostic = {
  severity: "error",
  code: "invalid-frontmatter",
  message: "name is required",
  path: "/plugins/github/skills/review/SKILL.md",
  kind: "skill",
};

const resource: FileResourceSummary = {
  kind: "skill",
  name: "review",
  id: "github.review",
  path: "/plugins/github/skills/review/SKILL.md",
  source: "builtin",
  ownership: "plugin",
  scope: "built-in",
  pluginKey: "builtin:github",
  state: "active",
};

const snapshot: FileResourcesSnapshot = {
  revision: 3,
  resources: [resource],
  diagnostics: [diagnostic],
};
assert.equal(snapshot.resources[0]?.ownership, "plugin");
```

Зафиксировать unions:

```ts
export type FileResourceKind = "agent" | "skill";
export type FileResourceState = "active" | "shadowed" | "switched-off" | "invalid";
export type FileResourceDiagnostic = {
  severity: "error" | "warning";
  code: string;
  message: string;
  path: string;
  kind?: FileResourceKind;
  id?: string;
};
export type FileResourceSummary = {
  kind: FileResourceKind;
  name?: string;
  id?: string;
  ownership: "standalone" | "plugin";
  scope: "built-in" | "user" | "project";
  source: string;
  path: string;
  state: FileResourceState;
  pluginKey?: string;
  description?: string;
};
export type FileResourcesSnapshot = {
  revision: number;
  resources: FileResourceSummary[];
  diagnostics: FileResourceDiagnostic[];
};
```

- [ ] **Step 3: Написать падающие тесты SDK и события**

В `packages/sdk/src/index.test.ts` объявить агента без selectors и агента с glob-селекторами:

```ts
await contribute.agent({ id: "safe", instructions: "work" });
await contribute.agent({
  id: "full",
  instructions: "work",
  tools: { include: ["*"], exclude: ["bash"] },
  skills: { include: ["review-*"], exclude: ["*-unsafe"] },
});
```

Ожидать, что хост получает оба объявления без SDK-умолчаний. В `events.test.ts` проверить:

```ts
const event: CoreEvent = {
  type: coreEventTypes.contributionsChanged,
  payload: { revision: 7 },
};
assert.deepEqual(event.payload, { revision: 7 });
```

- [ ] **Step 4: Запустить тесты и подтвердить RED**

Run:

```bash
node --test packages/protocol/src/tool-pattern.test.ts packages/protocol/src/file-resource.test.ts packages/protocol/src/events.test.ts
node --test packages/sdk/src/index.test.ts
```

Expected: FAIL — общих типов, путей, skill registration и события ещё нет; SDK требует `tools` и принимает `skills` списком.

- [ ] **Step 5: Реализовать общий selector и protocol-типы**

В `tool-pattern.ts` ввести:

```ts
export type NamePatternSelection = { include: string[]; exclude: string[] };
export type AgentToolSelection = NamePatternSelection;
export type AgentSkillSelection = NamePatternSelection;

export function selectNames(names: readonly string[], selection: NamePatternSelection): string[] {
  const included = selection.include.map(toRegExp);
  const excluded = selection.exclude.map(toRegExp);
  return names.filter(
    (name) =>
      included.some((pattern) => pattern.test(name)) &&
      !excluded.some((pattern) => pattern.test(name)),
  );
}
```

Оставить `selectToolNames` совместимым alias-обёрткой над `selectNames`. В `contribution.ts` заменить
`AgentContributionRegistration.skills: string[]` на `skills: AgentSkillSelection` и добавить:

```ts
export type SkillContributionRegistration = RegistrationCommon & {
  kind: "skill";
  name: string;
  location: string;
  license?: string;
  compatibility?: string;
  metadata?: Record<string, string>;
  allowedTools?: string[];
  disableModelInvocation: boolean;
};
```

Расширить `ContributionRegistration` новым видом. Общие поля владельца разделить discriminated
union:

```ts
export type ContributionOwnership =
  | {
      ownership: "plugin";
      pluginKey: string;
      pluginId: string;
      source: PluginSource;
    }
  | {
      ownership: "standalone";
      source: string; // точный key нативного или межклиентского корня
      scope: "user" | "project";
      projectId?: string;
    };
```

Plugin-owned-записи сохраняют обязательные `pluginKey/pluginId`; standalone-записи не подделывают
фиктивный плагин. `AgentSummary.pluginKey` становится optional только для standalone-агента.

- [ ] **Step 6: Реализовать API-пути, событие и SDK-типы**

В `project.ts` добавить constants шаблонов и helpers:

```ts
export const projectAgentsPathPattern = `${projectsPath}/:id/agents`;
export const projectFileResourcesPathPattern = `${projectsPath}/:id/file-resources`;
export const projectAgentsPath = (id: string) => `${projectPath(id)}/agents`;
export const projectFileResourcesPath = (id: string) => `${projectPath(id)}/file-resources`;
```

В `events.ts` добавить:

```ts
contributionsChanged: "core.contributions.changed",
// payload
export type ContributionsChanged = { revision: number };
```

В SDK определить optional selectors без умолчаний:

```ts
export type AgentSkillSelection = { include: string[]; exclude?: string[] };
export type AgentContribution = {
  id: string;
  title?: string;
  description?: string;
  instructions: string;
  tools?: AgentToolSelection;
  skills?: AgentSkillSelection;
  model?: string;
  thinkingLevel?: ThinkingLevel;
};
```

Обновить `AgentSummary.skills` до нормализованного `AgentSkillSelection` и сделать `pluginKey`
optional для standalone-агента.

- [ ] **Step 7: Обновить постоянную документацию и проверки**

В `docs/public-contract.md` описать новый SDK selector и wire-типы как действующий контракт. В
`docs/plugins.md` заменить список skill ids у агента на include/exclude glob-селектор и записать
безопасные пустые умолчания. В `docs/event-bus.md` добавить invalidation-only событие
`core.contributions.changed { revision }` и отличие от `core.plugin.contributions`.

Run:

```bash
node --test packages/protocol/src/tool-pattern.test.ts packages/protocol/src/file-resource.test.ts packages/protocol/src/events.test.ts
node --test packages/sdk/src/index.test.ts
pnpm --filter @sovereign/protocol typecheck
pnpm --filter @sovereign/sdk typecheck
pnpm exec prettier --check packages/protocol/src packages/sdk/src docs/public-contract.md docs/plugins.md docs/event-bus.md
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/protocol packages/sdk docs/public-contract.md docs/plugins.md docs/event-bus.md
git commit -m "feat(contributions): define skill and file resource contracts"
```

### Task 2: Общий parser и нерекурсивный discovery файловых определений

**Files:**

- Create: `apps/daemon/src/plugins/file-resource-parser.ts`
- Create: `apps/daemon/src/plugins/file-resource-parser.test.ts`
- Create: `apps/daemon/src/plugins/file-resource-discovery.ts`
- Create: `apps/daemon/src/plugins/file-resource-discovery.test.ts`
- Modify: `apps/daemon/package.json`
- Modify: `pnpm-lock.yaml`
- Create: `docs/file-resources.md`
- Modify: `docs/data-directory.md`

**Interfaces:**

- Consumes: Task 1 `NamePatternSelection`, `FileResourceDiagnostic`, `ThinkingLevel`.
- Produces: `parseAgentFile`, `parseSkillFile`, `discoverFileResources`, `FileResourceDefinition` и diagnostics, используемые plugin loader и standalone service.

- [ ] **Step 1: Добавить YAML dependency**

Добавить в `apps/daemon/package.json`:

```json
"yaml": "^2.9.0"
```

Run: `pnpm install`

Expected: `pnpm-lock.yaml` фиксирует прямую зависимость `@sovereign/daemon` на `yaml`.

- [ ] **Step 2: Написать падающие unit-тесты парсера AGENT.md**

Проверить корректный файл, пустые умолчания, explicit `*`, неизвестное поле, неверный YAML,
повтор ключа, несовпадение directory/name, пустой body и неверный thinking level:

```ts
const parsed = parseAgentFile({
  path: "/agents/code/AGENT.md",
  directoryName: "code",
  text: `---
name: code
description: Works with code
unknown-client-field: ignored
tools:
  include: ["*"]
skills:
  include: ["review-*"]
  exclude: ["*-unsafe"]
thinking-level: medium
---
Read before changing files.
`,
});

assert.equal(parsed.kind, "valid");
if (parsed.kind === "valid") {
  assert.deepEqual(parsed.definition.tools, { include: ["*"], exclude: [] });
  assert.deepEqual(parsed.definition.skills, {
    include: ["review-*"],
    exclude: ["*-unsafe"],
  });
}
```

Для отсутствующих selectors ожидать оба пустыми. Для каждой ошибки ожидать
`{ kind: "invalid", diagnostics: [{ severity: "error", code, message, path }] }` без исключения.
Отдельно создать sparse/oversized fixture: entry размером ровно 1 048 576 байт принимается, а
1 048 577 байт отклоняется с `code: "entry-too-large"` до `readFile`/YAML parse; соседний ресурс
больше 1 МиБ не делает определение некорректным.

- [ ] **Step 3: Написать падающие unit-тесты парсера SKILL.md**

Проверить обязательные поля, directory/name, `description` до 1024 символов, `compatibility` до 500,
`metadata` как string-to-string map, `allowed-tools` как пробельно-разделённую строку,
`disable-model-invocation` как boolean и warning для `_`:

```ts
const parsed = parseSkillFile({
  path: "/skills/code_review/SKILL.md",
  directoryName: "code_review",
  text: `---
name: code_review
description: Review a change
license: MIT
compatibility: Requires git
metadata:
  author: sovereign
allowed-tools: read bash
disable-model-invocation: false
future-field: ignored
---
Follow the review checklist.
`,
});

assert.equal(parsed.kind, "valid");
if (parsed.kind === "valid") {
  assert.deepEqual(parsed.definition.allowedTools, ["read", "bash"]);
  assert.equal(parsed.diagnostics[0]?.code, "nonstandard-underscore");
}
```

Также проверить max length 64, ведущий/замыкающий/двойной дефис и отсутствие frontmatter delimiter.

- [ ] **Step 4: Написать падающие discovery-тесты**

Во временном корне создать:

```text
skills/
  valid/SKILL.md
  broken/SKILL.md
  nested/group/ignored/SKILL.md
  linked -> <external-valid-directory>
```

Проверить, что `discoverFileResources({ kind: "skill", root })`:

- возвращает invalid summary для linked с `unsupported-symlink`, не разыменовывая target;
- возвращает invalid summary для broken;
- не находит nested;
- сортирует по имени директории;
- сохраняет entry path и не считает вложенный `SKILL.md` новым определением;
- продолжает обход после любой неподдерживаемой ссылки.

- [ ] **Step 5: Запустить тесты и подтвердить RED**

Run:

```bash
node --test apps/daemon/src/plugins/file-resource-parser.test.ts apps/daemon/src/plugins/file-resource-discovery.test.ts
```

Expected: FAIL — модулей ещё нет.

- [ ] **Step 6: Реализовать parser**

Определить внутренние types:

```ts
export type AgentFileDefinition = {
  kind: "agent";
  name: string;
  description: string;
  instructions: string;
  tools: NamePatternSelection;
  skills: NamePatternSelection;
  model?: string;
  thinkingLevel?: ThinkingLevel;
};

export type SkillFileDefinition = {
  kind: "skill";
  name: string;
  description: string;
  location: string;
  license?: string;
  compatibility?: string;
  metadata?: Record<string, string>;
  allowedTools?: string[];
  disableModelInvocation: boolean;
};

export type ParsedFileResource<T> =
  | { kind: "valid"; definition: T; diagnostics: FileResourceDiagnostic[] }
  | { kind: "invalid"; diagnostics: FileResourceDiagnostic[] };
```

Вынести `splitFrontmatter(text)`, `parseSelection`, `validateName` и `diagnostic`. Discovery сначала
проверяет `stat.size <= 1_048_576` и только затем читает entry-файл. YAML errors
переводить в code `invalid-frontmatter`; ошибки полей получать codes `invalid-name`,
`name-directory-mismatch`, `missing-description`, `invalid-selector`, `missing-instructions`, а
превышение лимита — `entry-too-large`.

- [ ] **Step 7: Реализовать discovery и документацию форматов**

`discoverFileResources` читает только direct child directories, вызывает format parser и
возвращает:

```ts
export type DiscoveredFileResource = {
  entryPath: string;
  directoryPath: string;
  parsed: ParsedFileResource<AgentFileDefinition | SkillFileDefinition>;
};
```

Discovery использует `lstat`, чтобы не перейти по ссылке на definition directory или entry-файл.
Вложенное дерево остаётся непрозрачными ресурсами определения: loader его не перечисляет, не читает
и не валидирует. Поэтому вложенный `AGENT.md`/`SKILL.md` не запускает второй parser, а ссылка среди
соседних ресурсов не получает специальной диагностики или watcher внешней цели.

Создать `docs/file-resources.md` как постоянный тематический документ. В нём полностью описать:

- форматы `AGENT.md` и `SKILL.md` с готовыми примерами;
- обязательные/необязательные поля и игнорирование неизвестных;
- allowed name alphabet и warning для `_` в скилах;
- плоский discovery, ресурсы рядом, относительные пути, запрет ссылок в entry path и отсутствие
  индексации соседних ресурсов;
- локальность ошибок и коды diagnostics;
- раздел «Почему так» про одну директорию на ресурс, YAML dependency и лимит 1 МиБ только на
  entry-файлы.

В `docs/data-directory.md` добавить `<data-directory>/agents` и `<data-directory>/skills`, не
ссылаясь на служебные документы.

- [ ] **Step 8: Проверить и закоммитить**

Run:

```bash
node --test apps/daemon/src/plugins/file-resource-parser.test.ts apps/daemon/src/plugins/file-resource-discovery.test.ts
pnpm --filter @sovereign/daemon typecheck
pnpm exec eslint apps/daemon/src/plugins/file-resource-parser.ts apps/daemon/src/plugins/file-resource-discovery.ts
pnpm exec prettier --check apps/daemon/package.json apps/daemon/src/plugins docs/file-resources.md docs/data-directory.md pnpm-lock.yaml
```

Expected: PASS.

```bash
git add apps/daemon/package.json apps/daemon/src/plugins pnpm-lock.yaml docs/file-resources.md docs/data-directory.md
git commit -m "feat(resources): parse file-backed agents and skills"
```

### Task 3: Контекстное разрешение вкладов в одном реестре

**Files:**

- Modify: `apps/daemon/src/plugins/contribution-registry.ts`
- Modify: `apps/daemon/src/plugins/contribution-registry.test.ts`
- Modify: `apps/daemon/src/plugins/plugins-snapshot.ts`
- Modify: `apps/daemon/src/plugins/plugins-snapshot.test.ts`
- Modify: `apps/daemon/src/plugins/public.ts`
- Modify: `docs/plugins.md`
- Modify: `docs/architecture.md`

**Interfaces:**

- Consumes: Task 1 contribution kinds/selectors, Task 2 parsed definitions.
- Produces: declaration-based `ContributionRegistry` with `applyPlugin`, `applyStandalone`, `resolvedBase`, `resolvedForProject`, `fileResourcesForProject`, monotonic `revision`.

- [ ] **Step 1: Переписать registry tests под контекст**

Добавить точные cases:

```ts
registry.applyPlugin(builtinHello, [builtinAgent], nothingDisabled);
registry.applyPlugin(dataHello, [dataAgent], nothingDisabled);
registry.applyPlugin(projectHello, [projectAgent], nothingDisabled);
registry.applyPlugin(projectOtherHello, [otherProjectAgent], nothingDisabled);

assert.deepEqual(ids(registry.resolvedBase("agent")), ["hello.agent"]);
assert.deepEqual(ids(registry.resolvedForProject("p1", "agent")), ["hello.agent"]);
assert.equal(registry.resolvedForProject("p1", "agent")[0]?.source, "project:p1");
assert.equal(registry.resolvedForProject("p2", "agent")[0]?.source, "project:p2");
```

Проверить дополнительно:

- project p1 никогда не видит p2;
- фильтрация project происходит до precedence/conflict;
- один и тот же общий алгоритм фильтрует `custom`, `event`, `agent` и `skill`, без switch по kind;
  тест с project-owned `custom/event` доказывает, что будущие `tool` и hook-kind потребуют только
  добавить wire-type, но не менять project resolution;
- standalone `review` и plugin-owned `github.review` сосуществуют;
- standalone roots перекрываются заданным numeric precedence;
- plugin project → data → builtin;
- одинаковые id разных kinds не конфликтуют;
- дубликат file/programmatic одного plugin, kind и declared id исключает только спорный id;
- switched-off plugin file resource не участвует в resolution, но виден как `switched-off`;
- invalid и shadowed видны в `fileResourcesForProject`;
- revision растёт при изменении declarations, diagnostics, active resolution или явном
  `resourceChanged` от watcher, но не при повторном identical scan без файлового события.

- [ ] **Step 2: Запустить registry tests и подтвердить RED**

Run:

```bash
node --test apps/daemon/src/plugins/contribution-registry.test.ts apps/daemon/src/plugins/plugins-snapshot.test.ts
```

Expected: FAIL — реестр пока хранит только plugin programmatic contributions и разрешает один глобальный набор.

- [ ] **Step 3: Ввести declaration model**

Внутренняя запись должна отделять публичную registration от resolution metadata:

```ts
type ContributionDeclaration = {
  key: string; // `${kind}:${id}:${claimKey}`
  identity: string; // `${kind}:${id}`
  registration: ContributionRegistration;
  source: string;
  scope: "built-in" | "user" | "project";
  projectId?: string;
  precedence: number;
  ownership:
    { kind: "plugin"; pluginKey: string; pluginId: string } | { kind: "standalone"; root: string };
  file?: {
    path: string;
    diagnostics: FileResourceDiagnostic[];
  };
  enabled: boolean;
};
```

Реестр хранит снимки по ownership, а `resolve(context)` сначала оставляет plugin-owned built-in/data,
user standalone и только объявления с `projectId === context.projectId`, затем группирует по
`identity`, выбирает highest precedence и исключает equal-rank conflicts. Алгоритм читает только
общую metadata происхождения и identity: он не перечисляет виды вкладов. Фильтр `kind` применяется
после общего resolution как удобство потребителя, а не меняет применимость.

Обновить facade:

```ts
export type ContributionRegistry = {
  revision(): number;
  applyPlugin(
    input: PluginContributionSnapshot,
    options?: { resourceChanged?: boolean },
  ): ContributionApplyOutcome;
  applyStandalone(
    input: StandaloneContributionSnapshot,
    options?: { resourceChanged?: boolean },
  ): void;
  removePlugin(pluginKey: string): void;
  removeStandalone(rootKey: string): void;
  resolvedBase(kind?: ContributionKind): ContributionRegistration[];
  resolvedForProject(projectId: string, kind?: ContributionKind): ContributionRegistration[];
  fileResourcesForProject(projectId: string): FileResourcesSnapshot;
  switchedOff(): ContributionRegistration[];
  conflictsForProject(projectId: string): ContributionConflict[];
};
```

`resourceChanged: true` повышает revision ровно один раз после атомарного apply, даже если parsed
registration совпала с предыдущей. Флаг приходит только из watcher callback, а не из обычного
повторного discovery, поэтому холостой rescan не создаёт событий.

- [ ] **Step 4: Сохранить совместимость plugin snapshot**

`plugins-snapshot.ts` строит административный снимок из plugin declarations/switched-off/conflicts, а
не использует project agents как источник session UI. Существующие поля ответа сохранить; project-
owned объявления не должны исчезнуть из plugin management только потому, что базовый каталог их не
разрешает.

- [ ] **Step 5: Обновить постоянную документацию**

В `docs/plugins.md` описать один declaration registry, project-context resolution, порядок
фильтрации и precedence, раздельные namespaces standalone/plugin-owned и локальный конфликт
file/programmatic. В `docs/architecture.md` записать границу: plugin loader и standalone service
поставляют объявления, session service запрашивает разрешённый снимок по `projectId`.

- [ ] **Step 6: Проверить и закоммитить**

Run:

```bash
node --test apps/daemon/src/plugins/contribution-registry.test.ts apps/daemon/src/plugins/plugins-snapshot.test.ts
pnpm --filter @sovereign/daemon typecheck
pnpm exec eslint apps/daemon/src/plugins/contribution-registry.ts apps/daemon/src/plugins/plugins-snapshot.ts
pnpm exec prettier --check apps/daemon/src/plugins docs/plugins.md docs/architecture.md
```

Expected: PASS.

```bash
git add apps/daemon/src/plugins docs/plugins.md docs/architecture.md
git commit -m "feat(contributions): resolve declarations by project"
```

### Task 4: Plugin-owned agents/skills и миграция базового агента

**Files:**

- Modify: `apps/daemon/src/plugins/plugin-sources.ts`
- Modify: `apps/daemon/src/plugins/plugin-sources.test.ts`
- Modify: `apps/daemon/src/plugins/plugin-supervisor.ts`
- Modify: `apps/daemon/src/plugins/plugin-supervisor.test.ts`
- Modify: `apps/daemon/src/plugins/plugin-watcher.test.ts`
- Create: `apps/daemon/src/plugins/fixtures/file-resources/package.json`
- Create: `apps/daemon/src/plugins/fixtures/file-resources/src/worker.ts`
- Create: `apps/daemon/src/plugins/fixtures/file-resources/agents/helper/AGENT.md`
- Create: `apps/daemon/src/plugins/fixtures/file-resources/skills/review/SKILL.md`
- Create: `apps/daemon/src/plugins/fixtures/file-resource-conflict/package.json`
- Create: `apps/daemon/src/plugins/fixtures/file-resource-conflict/src/worker.ts`
- Create: `apps/daemon/src/plugins/fixtures/file-resource-conflict/agents/agent/AGENT.md`
- Create: `plugins/base-agent/agents/agent/AGENT.md`
- Modify: `plugins/base-agent/src/worker.ts`
- Modify: `plugins/base-agent/src/worker.test.ts`
- Delete: `plugins/base-agent/src/instructions.ts`
- Modify: `docs/plugins.md`
- Modify: `docs/repository-structure.md`
- Modify: `docs/file-resources.md`

**Interfaces:**

- Consumes: Task 2 discovery, Task 3 `applyPlugin` atomic snapshot.
- Produces: `DiscoveredPlugin.fileResources`, supervisor merge of file/programmatic declarations, plugin resource hot reload, file-backed `base-agent.agent`.

- [ ] **Step 1: Написать падающие discovery/supervisor tests**

Проверить, что `discoverPlugins` добавляет к найденному плагину:

```ts
fileResources: {
  definitions: [
    { kind: "agent", name: "helper", entryPath: absoluteAgentPath },
    { kind: "skill", name: "review", entryPath: absoluteSkillPath },
  ],
  invalid: [],
  watchPaths: expect.arrayContaining([pluginDirectory]),
}
```

В supervisor tests проверить:

- до сообщения `activated` ни file-, ни programmatic-вклад не применён;
- после success оба вида применяются одной revision;
- invalid файл не блокирует worker и остальные contributions;
- `disable`, crash, reload и disappearance снимают весь снимок;
- одноимённый file/programmatic agent исключается, skill/другие ids остаются;
- path/reason ошибки попадают в status/file-resource snapshot.

- [ ] **Step 2: Написать падающий watcher test**

Создать `skills/review/references/checklist.md` внутри test plugin, изменить файл через
`repeatUntilSeen`, ожидать directory плагина в callback и повышение revision через
`resourceChanged`, хотя registration не изменилась. Ссылка вместо `skills/review` или `SKILL.md`
получает `unsupported-symlink`, внешний target не наблюдается. После `close()` обычные внутренние
изменения событий не дают.

- [ ] **Step 3: Запустить tests и подтвердить RED**

Run:

```bash
node --test apps/daemon/src/plugins/plugin-sources.test.ts apps/daemon/src/plugins/plugin-supervisor.test.ts apps/daemon/src/plugins/plugin-watcher.test.ts
```

Expected: FAIL — discovery не знает `agents/skills`, supervisor применяет только worker contributions.

- [ ] **Step 4: Подключить file discovery к plugin loader**

Расширить `DiscoveredPlugin`:

```ts
export type DiscoveredPlugin = {
  // existing fields
  fileResources: DiscoveredPluginFileResources;
};
```

`readPluginFolder` после manifest validation вызывает discovery ровно для
`join(directory, "agents")` и `join(directory, "skills")`. Отсутствие каталогов законно.
Все resource paths вычисляются от `directory`, а не от repository root.

- [ ] **Step 5: Применить atomic merged snapshot в supervisor**

В `Supervised` хранить latest `plugin.fileResources`. После `activated` вызвать converter file
definitions → declarations, объединить с `entry.contributed` и передать одним `applyPlugin`.
Проверку дубликатов выполнять по `{ kind, declaredId }` до registration; outcome problems дополнять
структурированными file diagnostics, не останавливая переход в `running`.

При reload заново вызвать `discoverPlugins` до старта worker, чтобы новый файловый снимок не был
копией до изменения. Existing `pluginWatcher` продолжает отдавать plugin directory на любую правку
внутри `agents/`/`skills/`. Дополнительных watcher targets нет: symlink entries не поддерживаются и
не разыменовываются.

Чтобы не повышать contribution revision при произвольной правке `src/`, watcher передаёт структуру:

```ts
type ChangedPluginDirectory = {
  directory: string;
  fileResourcesChanged: boolean;
};
```

`fileResourcesChanged` истинен только для событий с первым внутренним сегментом `agents` или
`skills`. Supervisor передаёт его в `applyPlugin(..., { resourceChanged })`; несколько событий одной
debounce-пачки для одного plugin directory объединяются логическим OR.

- [ ] **Step 6: Мигрировать base agent без смены identity**

Создать `plugins/base-agent/agents/agent/AGENT.md`:

```markdown
---
name: agent
description: Reads and changes files in the project folder, and runs shell commands
tools:
  include: ["*"]
  exclude: []
skills:
  include: []
  exclude: []
---

You are the agent of the Sovereign platform. You work inside one project folder and change files
there on the user's behalf.

Rules of work:

- Read before you write. Look at the surrounding code and follow its style.
- Do what was asked, no more. If the request is ambiguous in a way that changes the result, say so
  instead of guessing.
- Report honestly: what you did, what you checked, what you did not do and why.
- Your tools act on the real machine. A shell command runs for real and its effects are not undone.

Answer in the language the user writes in.
```

Worker оставляет только lifecycle log в `activate`; тест проверяет отсутствие programmatic
contribution и наличие file resource через plugin discovery. Удалить `instructions.ts`.

- [ ] **Step 7: Обновить постоянную документацию**

В `docs/plugins.md`, `docs/repository-structure.md` и `docs/file-resources.md` записать plugin layout,
atomic lifecycle, conflict rule и фактический built-in layout `plugins/<plugin>/{agents,skills}`.
Описать, что production распаковывает каталог плагина целиком в
`<data-directory>/builtin/<version>/<plugin>/`, а loader всегда считает пути от обнаруженной
директории.

- [ ] **Step 8: Проверить и закоммитить**

Run:

```bash
node --test apps/daemon/src/plugins/plugin-sources.test.ts apps/daemon/src/plugins/plugin-supervisor.test.ts apps/daemon/src/plugins/plugin-watcher.test.ts
node --test plugins/base-agent/src/worker.test.ts
pnpm --filter @sovereign/plugin-base-agent typecheck
pnpm --filter @sovereign/daemon typecheck
pnpm exec prettier --check apps/daemon/src/plugins plugins/base-agent docs/plugins.md docs/repository-structure.md docs/file-resources.md
```

Expected: PASS; `base-agent.agent` получается из файла, file/programmatic collision локальна.

```bash
git add apps/daemon/src/plugins plugins/base-agent docs/plugins.md docs/repository-structure.md docs/file-resources.md
git commit -m "feat(plugins): load file-backed agents and skills"
```

### Task 5: Standalone file resource service и hot reload всех корней

**Files:**

- Create: `apps/daemon/src/plugins/file-resource-roots.ts`
- Create: `apps/daemon/src/plugins/file-resource-roots.test.ts`
- Create: `apps/daemon/src/plugins/file-resource-watcher.ts`
- Create: `apps/daemon/src/plugins/file-resource-watcher.test.ts`
- Create: `apps/daemon/src/plugins/standalone-file-resources.ts`
- Create: `apps/daemon/src/plugins/standalone-file-resources.test.ts`
- Modify: `apps/daemon/src/plugins/public.ts`
- Modify: `apps/daemon/src/main.ts`
- Modify: `docs/file-resources.md`
- Modify: `docs/data-directory.md`
- Modify: `docs/repository-structure.md`

**Interfaces:**

- Consumes: project list/availability callbacks, Task 2 discovery, Task 3 `applyStandalone`.
- Produces: ordered `StandaloneResourceRoot[]`, `FileResourceWatcher`, `StandaloneFileResourceService.start/rescan/rearm/close`.

- [ ] **Step 1: Написать падающий тест точного порядка roots**

```ts
assert.deepEqual(
  standaloneResourceRoots({ dataDirectory, homeDirectory, projects, availability }),
  [
    {
      key: "project:p1:agents:sovereign",
      source: "sovereign",
      scope: "project",
      projectId: "p1",
      kind: "agent",
      precedence: 200,
      directory: join(project, ".sovereign", "agents"),
    },
    {
      key: "project:p1:skills:sovereign",
      source: "sovereign",
      scope: "project",
      projectId: "p1",
      kind: "skill",
      precedence: 400,
      directory: join(project, ".sovereign", "skills"),
    },
    {
      key: "project:p1:skills:agents",
      source: "agents",
      scope: "project",
      projectId: "p1",
      kind: "skill",
      precedence: 300,
      directory: join(project, ".agents", "skills"),
    },
    {
      key: "data:agents",
      source: "sovereign",
      scope: "user",
      kind: "agent",
      precedence: 100,
      directory: join(dataDirectory, "agents"),
    },
    {
      key: "data:skills",
      source: "sovereign",
      scope: "user",
      kind: "skill",
      precedence: 200,
      directory: join(dataDirectory, "skills"),
    },
    {
      key: "home:agents:skills",
      source: "agents",
      scope: "user",
      kind: "skill",
      precedence: 100,
      directory: join(homeDirectory, ".agents", "skills"),
    },
  ],
);
```

Archived и missing projects не дают roots; ephemeral available project даёт.

- [ ] **Step 2: Написать падающие watcher tests**

Проверить через temp directories и `repeatUntilSeen`:

- создание отсутствовавшего root под уже существующим parent;
- create/change/delete `AGENT.md`;
- изменение sibling resource;
- появление symlink вызывает rescan и `unsupported-symlink`, но внешняя цель не наблюдается;
- `rearm` перестаёт сообщать старый project root и начинает сообщать новый;
- `close` снимает watchers и debounce timer.

- [ ] **Step 3: Написать падающий service snapshot test**

Поднять service с fake roots и настоящим registry. Проверить последовательность:

```ts
await service.rescan(); // valid appears
assert.deepEqual(ids(registry.resolvedForProject("p1", "skill")), ["review"]);

writeFileSync(skillPath, malformedYaml);
await service.rescan();
assert.deepEqual(registry.resolvedForProject("p1", "skill"), []);
assert.equal(registry.fileResourcesForProject("p1").resources[0]?.state, "invalid");

writeFileSync(skillPath, validSkill);
await service.rescan();
assert.deepEqual(ids(registry.resolvedForProject("p1", "skill")), ["review"]);
```

Проверить atomicity: callback наблюдателя видит либо previous, либо complete next snapshot.

- [ ] **Step 4: Запустить tests и подтвердить RED**

Run:

```bash
node --test apps/daemon/src/plugins/file-resource-roots.test.ts apps/daemon/src/plugins/file-resource-watcher.test.ts apps/daemon/src/plugins/standalone-file-resources.test.ts
```

Expected: FAIL — standalone service отсутствует.

- [ ] **Step 5: Реализовать roots и watcher**

`StandaloneResourceRoot`:

```ts
export type StandaloneResourceRoot = {
  key: string;
  source: "sovereign" | "agents";
  scope: "user" | "project";
  projectId?: string;
  kind: FileResourceKind;
  precedence: number;
  directory: string;
};
```

Watcher использует recursive `fs.watch` только для существующих roots.
Для отсутствующего root ставит non-recursive watchers на существующую цепочку родителей до первого
созданного сегмента. После debounced callback service rescans и при изменении набора roots полностью
переставляет watchers; созданные roots начинают наблюдаться, внешние symlink targets — никогда.

- [ ] **Step 6: Реализовать standalone service и композицию**

```ts
export type StandaloneFileResourceService = {
  start(): Promise<void>;
  rescan(options?: { resourceChanged?: boolean }): Promise<void>;
  rearm(roots: StandaloneResourceRoot[]): Promise<void>;
  close(): void;
};
```

Сериализовать scans цепочкой Promise, как `applyPlugins`, чтобы два всплеска не применили старый
результат после нового. Каждый root даёт отдельный `applyStandalone`; исчезнувшие root keys вызывают
`removeStandalone`. Watcher callback вызывает `rescan({ resourceChanged: true })`; startup,
изменение списка projects и rearm вызывают обычный `rescan()`, где revision растёт только при
реальном изменении snapshot. После изменения `projects` или availability `main.ts` пересчитывает и
plugin-, и standalone-roots. При SIGINT/SIGTERM вызвать `standaloneResources.close()`.

- [ ] **Step 7: Обновить постоянную документацию**

В `docs/file-resources.md` и `docs/data-directory.md` записать все standalone paths и precedence в
том же порядке, hot reload transitions и запрет симлинков. В `docs/repository-structure.md` добавить
новые модули общего файлового слоя и standalone service в ответственность области `plugins` с
оговоркой, что service не является плагином.

- [ ] **Step 8: Проверить и закоммитить**

Run:

```bash
node --test apps/daemon/src/plugins/file-resource-roots.test.ts apps/daemon/src/plugins/file-resource-watcher.test.ts apps/daemon/src/plugins/standalone-file-resources.test.ts
pnpm --filter @sovereign/daemon typecheck
pnpm exec eslint apps/daemon/src/plugins apps/daemon/src/main.ts
pnpm exec prettier --check apps/daemon/src/plugins apps/daemon/src/main.ts docs/file-resources.md docs/data-directory.md docs/repository-structure.md
```

Expected: PASS.

```bash
git add apps/daemon/src/plugins apps/daemon/src/main.ts docs/file-resources.md docs/data-directory.md docs/repository-structure.md
git commit -m "feat(resources): hot-reload standalone agents and skills"
```

### Task 6: Pi runtime — динамический каталог скилов в system prompt

**Files:**

- Modify: `packages/agent-runtime-pi/src/agent-session.ts`
- Modify: `packages/agent-runtime-pi/src/agent-session.test.ts`
- Create: `packages/agent-runtime-pi/src/skills.ts`
- Create: `packages/agent-runtime-pi/src/skills.test.ts`
- Modify: `packages/agent-runtime-pi/src/index.ts`
- Modify: `docs/agent-runtime-contract.md`
- Modify: `docs/file-resources.md`

**Interfaces:**

- Consumes: resolved skill records `{ name, description, location, disableModelInvocation }`.
- Produces: `AgentSkill`, `renderSkillCatalogue`, `AgentSession.setInstructions/setSkills`, per-operation computed system prompt.

- [ ] **Step 1: Написать падающие tests XML-каталога**

В `skills.test.ts` проверить escaping и deterministic order:

```ts
assert.equal(
  renderSkillCatalogue([
    { name: "review&check", description: "Use <carefully>", location: '/tmp/a"b/SKILL.md' },
  ]),
  `<available_skills>\n  <skill>\n    <name>review&amp;check</name>\n    <description>Use &lt;carefully&gt;</description>\n    <location>/tmp/a&quot;b/SKILL.md</location>\n  </skill>\n</available_skills>`,
);
assert.equal(renderSkillCatalogue([]), "");
```

Проверить, что `disableModelInvocation: true` отсутствует, а input array не мутируется.

- [ ] **Step 2: Написать падающий AgentSession test живого обновления**

Создать session с agent instructions, вызвать `setSkills([review])`, запустить scripted model и
проверить фактически полученный system prompt. Затем вызвать `setInstructions("updated")`, заменить
skills на `[deploy]`, запустить второй turn и убедиться, что обе части prompt изменились без
пересоздания session. Удалить skills и проверить, что instructions не получают пустой XML block.

- [ ] **Step 3: Запустить tests и подтвердить RED**

Run:

```bash
node --test packages/agent-runtime-pi/src/skills.test.ts packages/agent-runtime-pi/src/agent-session.test.ts
```

Expected: FAIL — renderer и `setSkills` отсутствуют.

- [ ] **Step 4: Реализовать renderer и dynamic prompt**

```ts
export type AgentSkill = {
  name: string;
  description: string;
  location: string;
  disableModelInvocation?: boolean;
};

export function renderSkillCatalogue(skills: readonly AgentSkill[]): string;
```

В `liveSession` хранить `let instructions = agent.instructions` и `let skills: AgentSkill[] = []`.
Передать `systemPrompt` callback:

```ts
systemPrompt: () => {
  const catalogue = renderSkillCatalogue(skills);
  return catalogue === "" ? instructions : `${instructions}\n\n${catalogue}`;
},
```

Расширить `AgentSession`:

```ts
setInstructions: (instructions: string) => void;
setSkills: (next: AgentSkill[]) => void;
```

Оба метода заменяют значение целиком; `setInstructions` отклоняет пустую строку на границе runtime.
Не использовать Pi `resources.skills` и explicit invocation APIs: runtime нужен только model-driven
XML + обычный `read`.

- [ ] **Step 5: Обновить постоянную документацию**

В `docs/agent-runtime-contract.md` описать progressive disclosure, XML fields, обычный `read`,
динамическое обновление на turn boundary, `disable-model-invocation`, отсутствие slash commands и
обычную compaction. В `docs/file-resources.md` описать runtime-эффект `allowed-tools` (распознано,
сохранено, пока не применяется) и `disable-model-invocation`.

- [ ] **Step 6: Проверить и закоммитить**

Run:

```bash
node --test packages/agent-runtime-pi/src/skills.test.ts packages/agent-runtime-pi/src/agent-session.test.ts
pnpm --filter @sovereign/agent-runtime-pi typecheck
pnpm exec eslint packages/agent-runtime-pi/src
pnpm exec prettier --check packages/agent-runtime-pi/src docs/agent-runtime-contract.md docs/file-resources.md
```

Expected: PASS.

```bash
git add packages/agent-runtime-pi docs/agent-runtime-contract.md docs/file-resources.md
git commit -m "feat(runtime): expose model-driven skill catalogue"
```

### Task 7: Session service — project agents, selectors на каждый turn и missing-agent state

**Files:**

- Modify: `apps/daemon/src/sessions/sessions.ts`
- Modify: `apps/daemon/src/sessions/sessions.test.ts`
- Modify: `apps/daemon/src/sessions/tool-collection.ts`
- Modify: `apps/daemon/src/sessions/tool-collection.test.ts`
- Modify: `apps/daemon/src/sessions/public.ts`
- Modify: `packages/protocol/src/session.ts`
- Modify: `packages/protocol/src/session.test.ts`
- Modify: `packages/sdk/src/sessions.ts`
- Modify: `packages/sdk/src/index.test.ts`
- Modify: `docs/sessions-and-projects.md`
- Modify: `docs/file-resources.md`

**Interfaces:**

- Consumes: `ContributionRegistry.resolvedBase/resolvedForProject`, `selectNames`, `AgentSession.setSkills`.
- Produces: `SessionService.agentsForProject`, live revalidation at create/open/turn,
  `Session.agentAvailable` и `ToolContext.projectId` как шов для будущих project-owned tool sources.

- [ ] **Step 1: Написать падающие service tests project resolution**

Изменить test seam с `contributions: () => ContributionRegistration[]` на:

```ts
contributions: {
  base: () => ContributionRegistration[];
  forProject: (projectId: string) => ContributionRegistration[];
}
```

Проверить:

- global agents endpoint seam видит builtin/data, но не project;
- `agentsForProject("p1")` видит p1 override и не видит p2;
- create повторно проверяет `projectId + agentId` и возвращает refused после удаления declaration;
- programmatic agent без tools/skills получает пустые selectors;
- `skills.include/exclude` применяется к resolved project skills; exclude wins;
- `disableModelInvocation` skill не передаётся runtime;
- перед каждым turn tools и skills разрешаются заново;
- изменение body действующего `AGENT.md` меняет system prompt следующей model operation без
  пересоздания session;
- hot-added skill виден следующему turn, removed skill исчезает.

В `tool-collection.test.ts` добавить source, который записывает полученный context, и проверить,
что session model operation передаёт одновременно точные `projectId` и `folder`. Никаких plugin
tool sources или hook subscriptions в этой ветке не добавлять: тест фиксирует фундамент, который
они будут потреблять.

- [ ] **Step 2: Написать падающие tests missing-agent behavior**

Создать session, убрать agent и refresh/open. Ожидать:

```ts
assert.equal(snapshot.sessions[0]?.agentAvailable, false);
assert.equal((await getSession(sessionId)).agentAvailable, false);
assert.equal((await startTurn(sessionId, { text: "hello" })).status, 409);
assert.match(await responseError(), /agent .* is not available/);
```

Entries, branch, context и stats продолжают отвечать `200`. Вернуть agent и убедиться, что turn
снова принимается без изменения session file.

- [ ] **Step 3: Запустить tests и подтвердить RED**

Run:

```bash
node --test apps/daemon/src/sessions/sessions.test.ts packages/protocol/src/session.test.ts packages/sdk/src/index.test.ts
```

Expected: FAIL — service использует один global callback, Session не сообщает availability.

- [ ] **Step 4: Реализовать resolver boundary**

В `SessionServiceOptions` определить:

```ts
contributions: {
  base(): ContributionRegistration[];
  forProject(projectId: string): ContributionRegistration[];
};
```

Расширить существующий нейтральный контекст сборки инструментов:

```ts
export type ToolContext = {
  projectId: string;
  folder: string;
};
```

`coreToolSource` поле игнорирует; будущий источник среза 11 сможет получить project-resolved
объявления без изменения сигнатуры сборщика.

Добавить helpers:

```ts
const agentsFor = (projectId?: string): AgentContributionRegistration[];
const skillsFor = (projectId: string, agent: AgentContributionRegistration): AgentSkill[];
```

`agentsForProject(projectId)` возвращает summaries. Create/open ищут agent только через project
resolver. `readyForModel` повторно ищет current agent даже для уже открытого live harness; если его
нет, возвращает missing-agent, а если есть — вызывает `session.setInstructions(current.instructions)`
и `session.setSkills(...)` до любой операции модели.

- [ ] **Step 5: Применить dynamic selectors перед turn**

В единственной подготовке операций модели:

```ts
const contributions = options.contributions.forProject(summary.projectId);
const currentAgent = findAgent(contributions, summary.agentId);
if (currentAgent === undefined) return { kind: "missing-agent", agentId: summary.agentId };

const collected = await options.tools.collect({
  projectId: summary.projectId,
  folder: summary.folder,
});
const activeToolNames = selectNames(
  collected.tools.map((tool) => tool.name),
  currentAgent.tools,
);
await session.setTools(toAgentTools(collected.tools), activeToolNames);
session.setInstructions(currentAgent.instructions);
session.setSkills(selectSkills(contributions, currentAgent.skills));
```

Тот же helper использовать для prompt, compact и branch summary, потому что все идут к модели.
Read-only session operations не требуют agent.

- [ ] **Step 6: Добавить wire availability**

В `Session` добавить обязательное `agentAvailable: boolean`. Демон вычисляет его при каждом list/get
из текущего project snapshot; поле не записывается в JSONL. SDK re-export обновить и проверить
compile-time equality.

- [ ] **Step 7: Обновить постоянную документацию**

В `docs/sessions-and-projects.md` описать четыре точки resolution (project list, create, lazy open,
каждая model operation), отсутствие frozen definitions, missing-agent read/write behavior. В
`docs/file-resources.md` описать selectors и безопасное пустое умолчание.

- [ ] **Step 8: Проверить и закоммитить**

Run:

```bash
node --test apps/daemon/src/sessions/sessions.test.ts apps/daemon/src/sessions/tool-collection.test.ts packages/protocol/src/session.test.ts packages/sdk/src/index.test.ts
pnpm --filter @sovereign/daemon typecheck
pnpm --filter @sovereign/protocol typecheck
pnpm --filter @sovereign/sdk typecheck
pnpm exec prettier --check apps/daemon/src/sessions packages/protocol/src/session.ts packages/sdk/src docs/sessions-and-projects.md docs/file-resources.md
```

Expected: PASS.

```bash
git add apps/daemon/src/sessions packages/protocol/src/session.ts packages/protocol/src/session.test.ts packages/sdk docs/sessions-and-projects.md docs/file-resources.md
git commit -m "feat(sessions): resolve agents and skills per project"
```

### Task 8: HTTP endpoints и contribution invalidation

**Files:**

- Create: `apps/daemon/src/projects/project-resources.ts`
- Create: `apps/daemon/src/projects/project-resources.test.ts`
- Modify: `apps/daemon/src/projects/public.ts`
- Modify: `apps/daemon/src/main.ts`
- Modify: `apps/daemon/src/plugins/plugin-supervisor.ts`
- Modify: `apps/daemon/src/plugins/plugin-supervisor.test.ts`
- Modify: `apps/daemon/src/plugins/standalone-file-resources.ts`
- Modify: `apps/daemon/src/plugins/standalone-file-resources.test.ts`
- Modify: `docs/web-api.md`
- Modify: `docs/event-bus.md`

**Interfaces:**

- Consumes: `SessionService.agentsForProject`, registry `fileResourcesForProject/revision`, project store.
- Produces: `GET /api/projects/:id/agents`, `GET /api/projects/:id/file-resources`, publisher `core.contributions.changed`.

- [ ] **Step 1: Написать падающие route tests**

Проверить оба routes table handlers:

```ts
GET /api/projects/p1/agents         -> 200 { agents: [...] }
GET /api/projects/p1/file-resources -> 200 { revision, resources: [...], diagnostics: [...] }
GET /api/projects/missing/agents    -> 404 { error: "not found" }
GET /api/projects/missing/file-resources -> 404
```

Empty project set отвечает `200` с пустыми arrays. Project agents response уже после precedence и
не содержит invalid/shadowed; file resources содержит все states.

- [ ] **Step 2: Написать падающие event tests**

В plugin supervisor и standalone service записывать bus events. Проверить, что любое реальное
изменение registry revision публикует ровно:

```ts
{ type: "core.contributions.changed", payload: { revision: registry.revision() } }
```

Повтор identical snapshot не публикует событие. Существующий `core.plugin.contributions` остаётся
для plugin declarations и не публикуется на standalone-only change.

- [ ] **Step 3: Запустить tests и подтвердить RED**

Run:

```bash
node --test apps/daemon/src/projects/project-resources.test.ts apps/daemon/src/plugins/plugin-supervisor.test.ts apps/daemon/src/plugins/standalone-file-resources.test.ts
```

Expected: FAIL — routes и общий invalidation publisher отсутствуют.

- [ ] **Step 4: Реализовать routes через dependency injection**

Чтобы `projects` не импортировал внутренности `plugins` или `sessions`, options имеют callbacks:

```ts
export type ProjectResourceRouteOptions = {
  projects: Pick<ProjectStore, "find">;
  agents: (projectId: string) => AgentsSnapshot;
  fileResources: (projectId: string) => FileResourcesSnapshot;
};

export function projectResourceRoutes(options: ProjectResourceRouteOptions): Route[];
```

`main.ts` передаёт `sessions.agentsForProject` и `contributions.fileResourcesForProject` и добавляет
routes рядом с `projectsRoutes`.

- [ ] **Step 5: Вынести единый revision publisher**

Создать в composition root callback:

```ts
let publishedContributionRevision = contributions.revision();
const publishContributionChanges = (): void => {
  const revision = contributions.revision();
  if (revision === publishedContributionRevision) return;
  publishedContributionRevision = revision;
  bus.publish(coreEventTypes.contributionsChanged, { revision });
};
```

Передать callback supervisor и standalone service; вызывать после apply/remove. Plugin-specific
publisher продолжает публиковать старое событие только для своей поверхности.

- [ ] **Step 6: Обновить постоянную документацию**

В `docs/web-api.md` добавить routes, exact schemas, 404/empty semantics, назначение legacy
`GET /api/agents` и правило server revalidation в `POST /api/sessions`. В `docs/event-bus.md`
описать refetch selected project по invalidation revision.

- [ ] **Step 7: Проверить и закоммитить**

Run:

```bash
node --test apps/daemon/src/projects/project-resources.test.ts apps/daemon/src/plugins/plugin-supervisor.test.ts apps/daemon/src/plugins/standalone-file-resources.test.ts
pnpm --filter @sovereign/daemon typecheck
pnpm exec eslint apps/daemon/src/projects apps/daemon/src/plugins apps/daemon/src/main.ts
pnpm exec prettier --check apps/daemon/src docs/web-api.md docs/event-bus.md
```

Expected: PASS.

```bash
git add apps/daemon/src docs/web-api.md docs/event-bus.md
git commit -m "feat(api): expose project-scoped agents and file resources"
```

### Task 9: Web — project-first создание сессии

**Files:**

- Modify: `apps/web/src/sessions/api.ts`
- Modify: `apps/web/src/sessions/api.test.ts`
- Modify: `apps/web/src/sessions/use-sessions.ts`
- Modify: `apps/web/src/sessions/use-sessions.test.tsx`
- Modify: `apps/web/src/sessions/new-session-view.tsx`
- Modify: `apps/web/src/sessions/new-session-view.test.tsx`
- Modify: `apps/web/src/App.tsx`
- Modify: `packages/ui-kit/src/i18n/messages/en.ts`
- Modify: `packages/ui-kit/src/i18n/messages/ru.ts`
- Modify: `packages/ui-kit/src/i18n/i18n.test.ts`
- Modify: `docs/web-api.md`
- Modify: `docs/sessions-and-projects.md`

**Interfaces:**

- Consumes: Task 1 `projectAgentsPath`, Task 8 project agents endpoint.
- Produces: `fetchProjectAgents(projectId)`, project-dependent new-session state and reset behavior.

- [ ] **Step 1: Написать падающий API test**

```ts
await fetchProjectAgents("p/1");
expect(calls[0]?.input).toBe("/api/projects/p%2F1/agents");
```

Проверить successful JSON, 404 reason и AbortSignal forwarding. Legacy `fetchAgents` оставить для
потребителей общего каталога, но форма его больше не вызывает.

- [ ] **Step 2: Написать падающие view/controller tests**

Проверить пользовательскую последовательность:

- до выбора project agent select disabled и agents request не выполняется;
- выбор p1 вызывает один fetch p1 и показывает только его agents;
- смена p1 → p2 очищает agent, model и thinking level до defaults, aborts p1 request и fetches p2;
- stale p1 response после p2 игнорируется;
- no agents notice относится к выбранному project;
- preselected project со страницы project detail сразу fetches agents;
- submit использует projectId и agentId текущего project.

Пример ожидания:

```ts
fireEvent.change(screen.getByLabelText("Проект"), { target: { value: "p2" } });
expect(screen.getByLabelText("Агент")).toHaveValue("");
expect(screen.getByLabelText("Модель")).toHaveValue("");
expect(screen.getByLabelText("Уровень размышлений")).toHaveValue("medium");
```

- [ ] **Step 3: Запустить tests и подтвердить RED**

Run:

```bash
pnpm --filter @sovereign/web test -- sessions/api.test.ts sessions/use-sessions.test.tsx sessions/new-session-view.test.tsx
```

Expected: FAIL — форма получает один global agents list.

- [ ] **Step 4: Реализовать project agents state**

В controller держать:

```ts
type ProjectAgentsState = {
  projectId?: string;
  agents?: AgentSummary[];
  loading: boolean;
  failure?: string;
};
```

Один AbortController на текущий request и sequence guard. `NewSessionView` получает callback
`onSelectProject(projectId)` и project agents state; agent `Select` disabled при пустом project или
loading. `pickProject` одним state transition сбрасывает dependent fields до fetch.

- [ ] **Step 5: Подключить preselection из project detail**

`App.tsx` сохраняет route project id при переходе на new-session и передаёт `initialProjectId`.
Прямой `/sessions/new` остаётся без preselection. Смена маршрута очищает transient preselection,
чтобы следующий общий переход не наследовал старый project.

- [ ] **Step 6: Обновить локализацию и постоянную документацию**

Добавить ru/en строки loading/failure/no-agents-for-project и disabled hint. В `docs/web-api.md` и
`docs/sessions-and-projects.md` описать project-first flow как действующее UI behavior, без ссылок на
служебные документы.

- [ ] **Step 7: Проверить и закоммитить**

Run:

```bash
pnpm --filter @sovereign/web test -- sessions/api.test.ts sessions/use-sessions.test.tsx sessions/new-session-view.test.tsx
pnpm --filter @sovereign/ui-kit test -- src/i18n/i18n.test.ts
pnpm --filter @sovereign/web typecheck
pnpm --filter @sovereign/ui-kit typecheck
pnpm exec prettier --check apps/web/src packages/ui-kit/src/i18n docs/web-api.md docs/sessions-and-projects.md
```

Expected: PASS.

```bash
git add apps/web/src packages/ui-kit/src/i18n docs/web-api.md docs/sessions-and-projects.md
git commit -m "feat(web): select agents within the chosen project"
```

### Task 10: Web — project resource diagnostics и недоступный агент сессии

**Files:**

- Modify: `apps/web/src/projects/api.ts`
- Modify: `apps/web/src/projects/api.test.ts`
- Create: `apps/web/src/projects/file-resources-state.ts`
- Create: `apps/web/src/projects/file-resources-state.test.ts`
- Create: `apps/web/src/projects/use-file-resources.ts`
- Create: `apps/web/src/projects/use-file-resources.test.tsx`
- Create: `apps/web/src/projects/file-resources-panel.tsx`
- Create: `apps/web/src/projects/file-resources-panel.test.tsx`
- Modify: `apps/web/src/projects/project-detail-view.tsx`
- Modify: `apps/web/src/projects/project-detail-view.test.tsx`
- Modify: `apps/web/src/sessions/chat-view.tsx`
- Modify: `apps/web/src/sessions/sessions-view.test.tsx`
- Modify: `apps/web/src/sessions/message-composer.tsx`
- Modify: `packages/ui-kit/src/i18n/messages/en.ts`
- Modify: `packages/ui-kit/src/i18n/messages/ru.ts`
- Modify: `packages/ui-kit/src/i18n/i18n.test.ts`
- Modify: `docs/file-resources.md`
- Modify: `docs/sessions-and-projects.md`

**Interfaces:**

- Consumes: `projectFileResourcesPath`, `core.contributions.changed`, `Session.agentAvailable`.
- Produces: project diagnostics panel, event-driven refetch, missing-agent warning/disabled composer.

- [ ] **Step 1: Написать падающие API/state tests**

Проверить `fetchProjectFileResources(projectId)` path/error/signal. В state reducer проверить:

```ts
applyContributionEvent(state, {
  type: "core.contributions.changed",
  payload: { revision: 9 },
});
// => { state: { ...state, stale: true }, refetch: true }
```

Старый response с revision 8 после snapshot revision 9 не применяется. Stream gap также вызывает
refetch.

- [ ] **Step 2: Написать падающие panel tests**

Передать active/shadowed/switched-off/invalid agents и skills. Проверить:

- counts active agents/skills;
- problem list включает diagnostics, shadowed и switched-off;
- каждая строка показывает kind, path, source/ownership/scope и message/state;
- empty snapshot показывает zero counts и no-problems state;
- panel не содержит edit/toggle buttons.

- [ ] **Step 3: Написать падающий missing-agent UI test**

Открыть session с `agentAvailable: false`. Ожидать warning с exact `agentId`, disabled textarea и
submit button; entries/history остаются видны. После rerender `agentAvailable: true` warning исчезает
и composer снова доступен.

- [ ] **Step 4: Запустить tests и подтвердить RED**

Run:

```bash
pnpm --filter @sovereign/web test -- projects/api.test.ts projects/file-resources-state.test.ts projects/use-file-resources.test.tsx projects/file-resources-panel.test.tsx projects/project-detail-view.test.tsx sessions/sessions-view.test.tsx
```

Expected: FAIL — resource UI и availability behavior отсутствуют.

- [ ] **Step 5: Реализовать hook и panel**

`useFileResources(projectId, bus, stream)` подписывается на общий frontend bus, aborts previous fetch
на project change/unmount и применяет только response current sequence. `ProjectDetailView` получает
`fileResources` ReactNode рядом с sessions panel; `App.tsx` создаёт hook только для открытого project.

Panel группирует problems в стабильном порядке `error → warning → state`, затем path. Active counts
считаются только по `state === "active"`; invalid без name/id всё равно показывает path.

- [ ] **Step 6: Реализовать missing-agent composer guard**

`ChatView` передаёт в `MessageComposer` `disabled={!open.summary.agentAvailable}` и показывает
warning до ленты. Guard есть только в UI для обратной связи; backend `409` из Task 7 остаётся
обязательной защитой от stale client.

- [ ] **Step 7: Обновить локализацию и постоянную документацию**

Добавить ru/en strings counts/states/severity/missing agent. В `docs/file-resources.md` описать project
panel и diagnostics visibility. В `docs/sessions-and-projects.md` описать history-preserving blocked
composer и автоматическое восстановление.

- [ ] **Step 8: Проверить и закоммитить**

Run:

```bash
pnpm --filter @sovereign/web test -- projects/api.test.ts projects/file-resources-state.test.ts projects/use-file-resources.test.tsx projects/file-resources-panel.test.tsx projects/project-detail-view.test.tsx sessions/sessions-view.test.tsx
pnpm --filter @sovereign/ui-kit test -- src/i18n/i18n.test.ts
pnpm --filter @sovereign/web typecheck
pnpm --filter @sovereign/ui-kit typecheck
pnpm exec prettier --check apps/web/src packages/ui-kit/src/i18n docs/file-resources.md docs/sessions-and-projects.md
```

Expected: PASS.

```bash
git add apps/web/src packages/ui-kit/src/i18n docs/file-resources.md docs/sessions-and-projects.md
git commit -m "feat(web): show file resources and missing agents"
```

### Task 11: Сквозной hot-reload сценарий, документационный аудит и полная проверка

**Files:**

- Create: `apps/daemon/src/plugins/file-resources.integration.test.ts`
- Modify: `apps/daemon/src/main.ts` только если integration seam обнаружит недостающий lifecycle cleanup
- Modify: `docs/README.md`
- Modify: `docs/runbook.md`
- Review/Modify: `docs/architecture.md`
- Review/Modify: `docs/plugins.md`
- Review/Modify: `docs/sessions-and-projects.md`
- Review/Modify: `docs/agent-runtime-contract.md`
- Review/Modify: `docs/web-api.md`
- Review/Modify: `docs/data-directory.md`
- Review/Modify: `docs/event-bus.md`
- Review/Modify: `docs/repository-structure.md`
- Review/Modify: `docs/public-contract.md`
- Review/Modify: `docs/file-resources.md`

**Interfaces:**

- Consumes: весь реализованный pipeline tasks 1–10.
- Produces: end-to-end доказательство create/change/error/fix/delete, самодостаточная постоянная документация и зелёный `make check`.

- [ ] **Step 1: Написать сквозной integration test**

Поднять настоящие registry, standalone service, plugin supervisor, session service и in-memory bus на
temp data/project roots. Сценарий:

1. project initially видит built-in `base-agent.agent` и не видит project skill;
2. создание `.sovereign/skills/review/SKILL.md` приводит к revision event и skill появляется;
3. project `AGENT.md` с `skills.include: ["review"]` появляется в project agents endpoint;
4. новая session с этим agent получает XML catalog и читает skill обычным `read`;
5. malformed YAML снимает только skill, file-resources показывает error, session/history целы;
6. исправление файла возвращает skill без restart;
7. удаление agent делает `agentAvailable: false` и turn получает `409`;
8. восстановление agent снова разрешает turn;
9. тот же short id в другом project не влияет на первый;
10. `close/stopAll` не оставляют watchers/workers/timers.

Использовать ожидание revision/event вместо fixed sleep. Для filesystem watcher повторять запись до
callback по существующему `repeatUntilSeen` pattern.

- [ ] **Step 2: Запустить integration test и устранить только найденные разрывы композиции**

Run:

```bash
node --test apps/daemon/src/plugins/file-resources.integration.test.ts
```

Expected: PASS. Если RED показывает lifecycle gap, исправить минимальный production seam и добавить
к test точное regression assertion; не добавлять новый behavior за границами сценария.

- [ ] **Step 3: Дописать runbook**

В `docs/runbook.md` добавить практический раздел:

- куда положить user/project/plugin agent или skill;
- минимальные рабочие `AGENT.md` и `SKILL.md`;
- как explicit `include: ["*"]` отличается от отсутствующего selector;
- как проверить hot reload через project view/API;
- как найти invalid/shadowed/switched-off file и исправить path/reason;
- что slash commands и UI editing не поддерживаются.

Текст должен быть достаточен человеку без чтения исходников и без перехода к spec/plan.

- [ ] **Step 4: Провести аудит постоянной документации**

Проверить coverage table вручную:

| Требование                                                    | Постоянный документ                                    |
| ------------------------------------------------------------- | ------------------------------------------------------ |
| Форматы, roots, precedence, identity, diagnostics, hot reload | `docs/file-resources.md`                               |
| Plugin-owned lifecycle и conflicts                            | `docs/plugins.md`                                      |
| Project resolution и missing agent                            | `docs/sessions-and-projects.md`                        |
| Pi catalogue/read/compaction                                  | `docs/agent-runtime-contract.md`                       |
| Routes и wire schemas                                         | `docs/web-api.md`                                      |
| Events/revision/refetch                                       | `docs/event-bus.md`                                    |
| Data layout                                                   | `docs/data-directory.md`                               |
| Module ownership/layout                                       | `docs/architecture.md`, `docs/repository-structure.md` |
| SDK/public types                                              | `docs/public-contract.md`                              |
| Operator workflow                                             | `docs/runbook.md`                                      |

В `docs/README.md` добавить `file-resources.md` в основной тематический список. Удалить временную
строку про дизайн файловых агентов/скилов из списка служебных материалов: действующая точка входа —
тематический документ. Не добавлять в тематические документы ссылок на specs/plans.

- [ ] **Step 5: Автоматически проверить отсутствие служебных ссылок в тематических документах**

Run:

```bash
rg -n "docs/superpowers|superpowers/(specs|plans)|2026-08-02-agent-skills" \
  docs/architecture.md docs/plugins.md docs/sessions-and-projects.md \
  docs/agent-runtime-contract.md docs/web-api.md docs/data-directory.md \
  docs/event-bus.md docs/repository-structure.md docs/public-contract.md \
  docs/file-resources.md docs/runbook.md
```

Expected: no output, exit 1 from `rg` because no matches.

- [ ] **Step 6: Запустить focused regression suites**

Run:

```bash
node --test packages/protocol/src/*.test.ts
node --test packages/sdk/src/*.test.ts
node --test packages/agent-runtime-pi/src/*.test.ts
node --test apps/daemon/src/plugins/*.test.ts apps/daemon/src/sessions/*.test.ts apps/daemon/src/projects/*.test.ts
pnpm --filter @sovereign/web test
pnpm --filter @sovereign/ui-kit test
```

Expected: PASS, no hangs after watcher tests.

- [ ] **Step 7: Запустить полную Definition of Done**

Run:

```bash
make check
git diff --check
git status --short
```

Expected: `make check` PASS; `git diff --check` no output; status содержит только ожидаемые
integration/doc changes этого task.

- [ ] **Step 8: Commit**

```bash
git add apps/daemon/src/plugins/file-resources.integration.test.ts apps/daemon/src/main.ts docs
git commit -m "test(resources): verify project file resource lifecycle"
```

- [ ] **Step 9: Проверить чистую ветку после commit**

Run:

```bash
git status --short --branch
git log --oneline -12
```

Expected: рабочее дерево чистое; история содержит отдельные commits tasks 1–11.
