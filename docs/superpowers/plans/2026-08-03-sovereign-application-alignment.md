# Sovereign Application Alignment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Align all remaining existing pages and states with the approved visual language and remove application-level card/typography workarounds.

**Architecture:** Audit only current shipped views after the foundation, shell, and session slices. Replace unnecessary panels with UI Kit list/section composition, preserve cards around standalone objects, and strengthen the CSS discipline tests so future application code cannot reintroduce local fonts, radii, shadows, or decorative effects.

**Tech Stack:** React 19, TypeScript, CSS, UI Kit, Vitest, Testing Library, Ladle, pnpm workspace.

## Статус выполнения

План завершён: выполнены 4 задачи и все 20 шагов. Прикладные изменения находятся в коммитах
`a168701..3b1f554`, исходное завершение среза задокументировано в `f5557ec`, а замечания финального
ревью закрыты в `7557a88..49d0874`. Live QA повторён после исправления тёмных контролов каталога;
полная матрица `test`, `typecheck`, ESLint, Prettier, Ladle build, web build и `git diff --check`
пройдена на итоговом дереве. Независимый scoped re-review не оставил открытых замечаний.

## Global Constraints

- Start from the completed and reviewed first three visual-language slices.
- Change no route, API, controller, data model, feature set, or plugin contract.
- Do not add the illustrative kanban, analytics dashboard, or plugin editor from the design exploration.
- Keep cards only around standalone objects or concise metric summaries; use sections, lists, spacing, and dividers for repeated rows.
- Application CSS owns layout only and may not declare font families, colour literals, radii, shadows, gradients, blur, or bespoke interaction states.
- Preserve all empty/loading/stale/failure/disabled states and their accessible names.
- New cold/pink colour scheme remains out of scope.
- Use test-first red/green cycles and atomic Conventional Commits in English.

---

## File Map

- `apps/web/src/projects/projects-view.tsx`, `project-detail-view.tsx`, `file-resources-panel.tsx`: remove unnecessary nested panel chrome while preserving standalone project/resource boundaries.
- `apps/web/src/projects/*.test.tsx`: protect search, create, archive, detail navigation, resources, and failures.
- `apps/web/src/projects/projects.css`: compact toolbars, forms, rows, and detail sections.
- `apps/web/src/sessions/new-session-view.tsx`, `archive-sessions-view.tsx`, `session-route-view.tsx`: align forms, grouped archive rows, loading/empty/error states.
- `apps/web/src/sessions/*.test.tsx`: protect existing behavior and semantic section structure.
- `apps/web/src/sessions/sessions.css`: compact non-chat session pages without touching approved chat rules.
- `apps/web/src/login/login-view.tsx`, `apps/web/src/login/login.css`: align the authentication surface while retaining the necessary standalone form panel.
- `apps/web/src/login/login-view.test.tsx`: protect form submission and failure semantics.
- `packages/ui-kit/src/components/{dialog,notice,state,toast}.module.css`: apply the final restrained geometry to canonical shared states.
- `packages/ui-kit/src/components/primitives.stories.tsx`: canonical empty/loading/error/dialog states.
- `apps/web/src/shell/styles.test.ts`: forbid application-owned visual-system properties and protect final layouts.
- `packages/ui-kit/src/styles/styles.test.ts`: ensure every visual token still has a real consumer.
- `docs/ui-kit.md`, `docs/README.md`: record completion and index this final slice.

The preceding session slice already enforces the application boundary against local font families,
radii, shadows, gradients, and backdrop filters. Every task below reruns that contract together with
its focused view tests.

### Task 1: Project index and detail alignment

**Files:**

- Modify: `apps/web/src/projects/projects-view.tsx`
- Modify: `apps/web/src/projects/project-detail-view.tsx`
- Modify: `apps/web/src/projects/file-resources-panel.tsx`
- Modify: `apps/web/src/projects/projects-view.test.tsx`
- Modify: `apps/web/src/projects/project-detail-view.test.tsx`
- Modify: `apps/web/src/projects/file-resources-panel.test.tsx`
- Modify: `apps/web/src/projects/projects.css`

**Interfaces:**

- Preserves: project search, creation, conflicts, archive/remove/rename, detail navigation, session count, agents/skills/resources, and loading/failure states.
- Produces: one page heading, one compact toolbar, list rows for repeated projects/resources, and cards only for standalone create/conflict/detail objects.

- [x] **Step 1: Add failing semantic composition tests**

Assert the active project list is one named list, each project remains one selectable row with a
separate actions menu, archived projects remain inside their disclosure, and file resources are
grouped by semantic section rather than nested unnamed panels. Keep all existing interaction tests.

- [x] **Step 2: Run focused tests and verify RED**

Run: `pnpm --filter @sovereign/web test -- projects-view.test.tsx project-detail-view.test.tsx file-resources-panel.test.tsx`

Expected: new structure assertions fail on panel-heavy markup; behavior tests stay green.

- [x] **Step 3: Flatten repeated project/resource structures**

Remove the `Panel` around the ordinary project list unless the list itself is the only standalone
object on the page; use a section label and dividers instead. Keep conflict/create surfaces bounded
because they are temporary independent tasks. Apply the same rule to project detail resources.

- [x] **Step 4: Run project verification**

Run:

```bash
pnpm --filter @sovereign/web test -- projects-view.test.tsx project-detail-view.test.tsx file-resources-panel.test.tsx styles.test.ts
pnpm --filter @sovereign/web typecheck
```

Expected: PASS.

- [x] **Step 5: Commit project alignment**

```bash
git add apps/web/src/projects apps/web/src/shell/styles.test.ts
git commit -m "style(web): align project views"
```

### Task 2: New and archived session pages

**Files:**

- Modify: `apps/web/src/sessions/new-session-view.tsx`
- Modify: `apps/web/src/sessions/new-session-view.test.tsx`
- Modify: `apps/web/src/sessions/archive-sessions-view.tsx`
- Modify: `apps/web/src/sessions/archive-sessions-view.test.tsx`
- Modify: `apps/web/src/sessions/session-route-view.tsx`
- Modify: `apps/web/src/sessions/session-route-view.test.tsx`
- Modify: `apps/web/src/sessions/sessions.css`

**Interfaces:**

- Preserves: separate new-session route, project/agent/model/thinking selection, first prompt, archive grouping, restore/remove/open, direct archived chat, and all refusals.
- Produces: readable page headings, compact form rhythm, flat archive group lists, and consistent states.

- [x] **Step 1: Add failing layout-semantic tests**

Require one form heading and one form region for new session; each archive project is a section with
one heading and one list; loading/empty/error states keep the same accessible labels. Do not assert
CSS hashes or visual text not supplied by translations.

- [x] **Step 2: Run focused tests and verify RED**

Run: `pnpm --filter @sovereign/web test -- new-session-view.test.tsx archive-sessions-view.test.tsx session-route-view.test.tsx`

Expected: new semantic-region assertions fail where wrappers are generic.

- [x] **Step 3: Implement compact form/list composition**

Use existing UI Kit `Form`, `Field`, `List`, `ListRow`, `Heading`, `Notice`, and state components.
Keep the form width readable, tighten vertical rhythm, and use dividers rather than group cards in
the archive. Do not change any form readiness or action flow.

- [x] **Step 4: Run session-page verification**

Run: `pnpm --filter @sovereign/web test -- new-session-view.test.tsx archive-sessions-view.test.tsx session-route-view.test.tsx styles.test.ts && pnpm --filter @sovereign/web typecheck`

Expected: PASS.

- [x] **Step 5: Commit session-page alignment**

```bash
git add apps/web/src/sessions apps/web/src/shell/styles.test.ts
git commit -m "style(web): align session management pages"
```

### Task 3: Authentication and shared states

**Files:**

- Modify: `apps/web/src/login/login-view.tsx`
- Modify: `apps/web/src/login/login-view.test.tsx`
- Modify: `apps/web/src/login/login.css`
- Modify: `packages/ui-kit/src/components/dialog.module.css`
- Modify: `packages/ui-kit/src/components/notice.module.css`
- Modify: `packages/ui-kit/src/components/state.module.css`
- Modify: `packages/ui-kit/src/components/toast.module.css`
- Modify: `packages/ui-kit/src/components/primitives.stories.tsx`
- Modify: `packages/ui-kit/src/styles/styles.test.ts`

**Interfaces:**

- Preserves: login submission, validation/failure, dialogs, notices, empty/loading states, and toast behavior.
- Produces: one restrained standalone login surface and consistent flat shared states across all views.

- [x] **Step 1: Add failing canonical-state assertions**

In login tests, require one named form and unchanged failure alert. In Ladle, add one `SystemStates`
story that renders loading, empty, danger notice, confirmation dialog trigger, and toast trigger on
the page surface. Extend stylesheet tests to require plain semantic surfaces and no removed effects.

- [x] **Step 2: Run focused tests and verify RED**

Run: `pnpm --filter @sovereign/ui-kit test -- styles.test.ts rendering.test.tsx && pnpm --filter @sovereign/web test -- login-view.test.tsx styles.test.ts`

Expected: FAIL on story/style contracts that still assume decorative panels/effects.

- [x] **Step 3: Align shared-state primitives**

Use moderate radii, semantic borders, and elevation only where the state is actually overlaid. Keep
the login form as one standalone bounded surface; do not add decorative background layers. Preserve
focus traps, alert roles, toast live regions, and button behavior.

- [x] **Step 4: Run shared-state verification**

Run:

```bash
pnpm --filter @sovereign/ui-kit test
pnpm --filter @sovereign/web test -- login-view.test.tsx styles.test.ts
pnpm --filter @sovereign/ui-kit typecheck
pnpm --filter @sovereign/web typecheck
pnpm --filter @sovereign/ui-kit exec ladle build
```

Expected: PASS.

- [x] **Step 5: Commit shared states**

```bash
git add apps/web/src/login packages/ui-kit/src/components packages/ui-kit/src/styles/styles.test.ts
git commit -m "style(ui-kit): align shared application states"
```

### Task 4: Final documentation and full-system verification

**Files:**

- Modify: `docs/ui-kit.md`
- Modify: `docs/README.md`
- Modify: `docs/backlog.md` only for visual issues deliberately deferred after live verification.

**Interfaces:**

- Documents: completed visual-language rollout and any measured deferrals.
- Produces: branch ready for final independent review and integration.

- [x] **Step 1: Perform live visual QA before documenting completion**

Run the web app and Ladle. Check dark and light Imperium, Nord, OLED, and Sage at smaller/default/larger
scale for: sidebar selection, settings, provider/plugin lists, session chat/tool blocks/composer,
projects, new/archive sessions, login, dialogs, notices, and narrow containers. Record only real
remaining defects in `docs/backlog.md`; do not write speculative polish tasks.

- [x] **Step 2: Update durable documentation**

Rewrite any remaining obsolete card/glass/Unbounded descriptions in `docs/ui-kit.md`. State that the
four-slice rollout is complete and link the spec plus all plans from `docs/README.md`.

- [x] **Step 3: Run full repository verification**

Run:

```bash
pnpm -r test
pnpm -r typecheck
pnpm eslint .
pnpm prettier --check .
pnpm --filter @sovereign/ui-kit exec ladle build
pnpm --filter @sovereign/web build
git diff --check
```

Expected: all commands exit 0 with no new warnings; build artifacts remain ignored and untracked.

- [x] **Step 4: Commit final documentation**

```bash
git add docs/ui-kit.md docs/README.md docs/backlog.md
git commit -m "docs(ui-kit): complete visual language rollout"
```

- [x] **Step 5: Request independent review and repeat until clean**

Dispatch a reviewer subagent with the original visual-language spec, all four plans, live-QA notes,
and the complete diff from the pre-rollout base. Fix every actionable finding with a focused test,
rerun the full verification, and repeat review until the reviewer reports no findings.
