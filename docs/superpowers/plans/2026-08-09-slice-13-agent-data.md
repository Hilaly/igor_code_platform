# Slice 13 Agent Data Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Передать папку файлового агента в system prompt и научить встроенный `base-agent`
самостоятельно читать проектный `AGENTS.md`.

**Architecture:** Parser сохраняет абсолютный путь `AGENT.md`, реестр переносит его как необязательную
метаинформацию файлового вклада, а sessions service передаёт в runtime только `dirname`. Runtime
собирает prompt из независимых renderer-ов и обновляет directory перед каждой операцией модели.

**Tech Stack:** TypeScript, Node.js test runner, Pi agent harness, pnpm workspace.

## Global Constraints

- Ядро не читает и не подмешивает содержимое проектного `AGENTS.md`.
- Программный агент без файлового `AGENT.md` не получает `<agent_data>`.
- Порядок prompt: instructions, `<agent_data>`, `<available_skills>`.
- XML-метасимволы экранируются.
- Hot reload применяется к следующей model operation без пересоздания сессии.
- HTTP и JSONL-контракты не расширяются.

---

### Task 1: Renderer данных агента

**Files:**

- Create: `packages/agent-runtime-pi/src/xml.ts`
- Create: `packages/agent-runtime-pi/src/agent-data.ts`
- Create: `packages/agent-runtime-pi/src/agent-data.test.ts`
- Modify: `packages/agent-runtime-pi/src/skills.ts`
- Modify: `packages/agent-runtime-pi/src/skills.test.ts`

**Interfaces:**

- Produces: `escapeXml(value: string): string`.
- Produces: `renderAgentData(directory?: string): string`.
- `renderSkillCatalogue` продолжает выдавать байт-в-байт тот же XML.

- [x] **Step 1: Написать красные тесты renderer-а.**
      Проверить отсутствие wrapper без directory и экранирование всех пяти XML-метасимволов.
- [x] **Step 2: Запустить**
      `pnpm --filter @sovereign/agent-runtime-pi exec node --test src/agent-data.test.ts`
      и увидеть ожидаемое падение из-за отсутствующего модуля.
- [x] **Step 3: Реализовать `xml.ts` и `agent-data.ts`, перевести `skills.ts` на общий helper.**
- [x] **Step 4: Запустить**
      `pnpm --filter @sovereign/agent-runtime-pi exec node --test src/agent-data.test.ts src/skills.test.ts`
      и получить PASS.
- [x] **Step 5: Закоммитить renderer отдельным коммитом.**

### Task 2: Файловый путь в parser и реестре

**Files:**

- Modify: `apps/daemon/src/plugins/file-resource-parser.ts`
- Modify: `apps/daemon/src/plugins/file-resource-parser.test.ts`
- Modify: `packages/protocol/src/contribution.ts`
- Modify: `apps/daemon/src/plugins/plugin-supervisor.ts`
- Modify: `apps/daemon/src/plugins/plugin-supervisor.test.ts`
- Modify: `apps/daemon/src/plugins/standalone-file-resources.ts`
- Modify: `apps/daemon/src/plugins/standalone-file-resources.test.ts`

**Interfaces:**

- `AgentFileDefinition.location: string` — точный входной путь `AGENT.md`.
- `AgentContributionRegistration.location?: string` — только для file-backed registrations.

- [x] **Step 1: Дополнить parser-тест точным `location` и тесты обеих registration-фабрик.**
- [x] **Step 2: Запустить адресные daemon-тесты и подтвердить красное состояние.**
- [x] **Step 3: Добавить поле в типы и обе registration-фабрики.**
- [x] **Step 4: Запустить**
      `pnpm --filter @sovereign/daemon exec node --test src/plugins/file-resource-parser.test.ts src/plugins/plugin-supervisor.test.ts src/plugins/standalone-file-resources.test.ts`.
- [x] **Step 5: Закоммитить перенос location отдельным коммитом.**

### Task 3: Runtime system prompt и live update

**Files:**

- Modify: `packages/agent-runtime-pi/src/agent-session.ts`
- Modify: `packages/agent-runtime-pi/src/agent-session.test.ts`

**Interfaces:**

- `AgentDefinition.directory?: string`.
- `AgentSession.setAgentDirectory(directory?: string): void`.
- `systemPrompt` соединяет три непустые секции в утверждённом порядке.

- [x] **Step 1: Расширить runtime-тест: первый prompt содержит все три секции, второй меняет
      directory и skills, третий убирает оба необязательных блока.**
- [x] **Step 2: Запустить**
      `pnpm --filter @sovereign/agent-runtime-pi exec node --test src/agent-session.test.ts`
      и увидеть расхождение prompt/API.
- [x] **Step 3: Реализовать поле, mutator и композицию через `renderAgentData`.**
- [x] **Step 4: Повторить runtime-тест и typecheck пакета.**
- [x] **Step 5: Закоммитить runtime-часть отдельным коммитом.**

### Task 4: Sessions service и hot reload

**Files:**

- Modify: `apps/daemon/src/sessions/sessions.ts`
- Modify: `apps/daemon/src/sessions/sessions.test.ts`

**Interfaces:**

- `agentDefinition(agent)` передаёт `{ id, instructions, directory? }`, где directory равен
  `dirname(agent.location)`.
- `applyRuntimeDefinitions` вызывает `setAgentDirectory` перед `setSkills`.

- [x] **Step 1: Расширить test harness записью применённых directories и вызовов mutator-а.**
- [x] **Step 2: Красным тестом доказать create/open и повторное разрешение нового/отсутствующего
      location перед queued operation.**
- [x] **Step 3: Реализовать единый helper построения `AgentDefinition` и live mutator.**
- [x] **Step 4: Запустить `pnpm --filter @sovereign/daemon exec node --test src/sessions/sessions.test.ts`.**
- [x] **Step 5: Закоммитить seam демона отдельным коммитом.**

### Task 5: Base agent, интеграция и нормативные документы

**Files:**

- Modify: `plugins/base-agent/agents/agent/AGENT.md`
- Modify: `plugins/base-agent/src/index.test.ts` или ближайший тест пакета
- Modify: `apps/daemon/src/plugins/file-resources.integration.test.ts`
- Modify: `docs/agent-runtime-contract.md`
- Modify: `docs/file-resources.md`
- Modify: `docs/sessions-and-projects.md`
- Modify: `docs/roadmap.md`

**Interfaces:**

- Base prompt требует `read` проектного и более близкого `AGENTS.md`, но не требует loader-а ядра.
- Интеграционный scripted model видит directory файлового project-agent.

- [x] **Step 1: Добавить красный контрактный тест встроенного prompt и интеграционную проверку
      `<agent_data>`.**
- [x] **Step 2: Обновить `AGENT.md` и нормативные документы по фактическому контракту.**
- [x] **Step 3: Запустить адресные тесты base-agent и file-resources integration.**
- [x] **Step 4: Запустить полный `make check`.**
- [x] **Step 5: Отметить выполненные пункты плана и закоммитить завершение среза.**
