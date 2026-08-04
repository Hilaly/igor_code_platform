# Sovereign Shell and System Views Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply contextual density and Refined Imperium surface hierarchy to the shell, sidebar, settings, providers, and plugins while preserving all navigation and behavior.

**Architecture:** Consume the visual-foundation tokens and existing UI Kit primitives; keep application CSS responsible only for host and view geometry. Flatten system pages into coherent master–detail/list surfaces, remove unnecessary nested panels, and let the shell express four adjacent surface levels without adding application-owned colours or component styles.

**Tech Stack:** React 19, TypeScript, CSS, UI Kit, Vitest, Testing Library, pnpm workspace.

## Статус выполнения

План завершён: выполнены 5 задач и все 24 шага. Основной диапазон — `a76a70c..6d504e9`, последующие
`48f677d`, `c129ddc`, `0bd9874` и `72abc84` закрыли замечания task-review. Каждый task и весь срез
прошли независимое ревью без оставшихся findings. Финальная проверка всего репозитория повторно
подтвердила тесты, typecheck, ESLint, Prettier и production-build Ladle и web.

## Global Constraints

- Start from the completed and reviewed Sovereign visual-foundation slice.
- Preserve sidebar information architecture, routes, account menu behavior, project/session actions, settings sections, provider/plugin APIs, and the temporarily unavailable right panel on settings.
- Do not change `ShellLayout`, localStorage keys, server contracts, or controller state.
- Application CSS may use only UI Kit role and scale variables; no colour, font, radius, or shadow literals.
- Keep serif to page/section headings; sidebar rows, settings controls, providers, and plugins remain sans-serif.
- Do not modify the agent chat, composer, or tool-call rendering in this slice.
- Use test-first red/green cycles and atomic Conventional Commits in English.

---

## File Map

- `apps/web/src/shell/shell.tsx`: keep shell behavior; add only semantic wrappers/test IDs needed to express brand and page surfaces.
- `apps/web/src/shell/shell.css`: compact shell spacing and separate navigation/page/right-panel surfaces.
- `apps/web/src/shell/shell.test.tsx`: protect unchanged navigation and account behavior after markup refinement.
- `apps/web/src/shell/styles.test.ts`: protect compact geometry and forbid reintroduction of page gradients/cards.
- `apps/web/src/sessions/sidebar-projects.tsx`: preserve tree behavior while using compact actions and accessible full names.
- `apps/web/src/sessions/sidebar-projects.test.tsx`: protect selection, expansion, actions, and long-name accessibility.
- `apps/web/src/settings/settings-view.tsx`: keep URL-driven master–detail semantics; remove duplicate visual mass.
- `apps/web/src/settings/settings.css`: compact settings navigation and use rows/dividers rather than per-field cards.
- `apps/web/src/settings/settings-view.test.tsx`: protect selected section and one active content surface.
- `apps/web/src/providers/providers-view.tsx`, `apps/web/src/providers/providers.css`: flatten provider lists/details without changing authentication behavior.
- `apps/web/src/providers/providers-view.test.tsx`: protect provider navigation and login actions.
- `apps/web/src/plugins/plugins-view.tsx`: replace repeated application-level panels with list/section composition where the object boundary is not needed.
- `apps/web/src/shell/shell.css`: contains plugin view geometry and receives the compact flat composition.
- `docs/ui-kit.md`: record the implemented shell/system composition.
- `docs/README.md`: index this second slice.

### Task 1: Compact shell surface hierarchy

**Files:**

- Modify: `apps/web/src/shell/shell.css`
- Modify: `apps/web/src/shell/styles.test.ts`
- Modify: `apps/web/src/shell/shell.test.tsx`

**Interfaces:**

- Consumes: `pageSurface`, `panelSurface`, `sunkenSurface`, `controlSurface`, compact row and spacing tokens from UI Kit.
- Preserves: all `ShellProps`, resizers, restore buttons, and panel visibility behavior.
- Produces: sidebar = panel surface, central page = page surface, right panel = sunken surface.

- [x] **Step 1: Write failing shell-style assertions**

Extend `styles.test.ts`:

```ts
expect(shell).toMatch(/\.shell-left\s*\{[^}]*background:\s*var\(--sovereign-panel-surface\);/s);
expect(shell).toMatch(/\.shell-page\s*\{[^}]*background:\s*var\(--sovereign-page-surface\);/s);
expect(shell).toMatch(/\.shell-right\s*\{[^}]*background:\s*var\(--sovereign-sunken-surface\);/s);
expect(shell).toMatch(/\.shell-left\s*\{[^}]*gap:\s*var\(--sovereign-space-2\);/s);
```

Keep existing shrink/scroll and settings-layout assertions.

- [x] **Step 2: Run focused tests and verify RED**

Run: `pnpm --filter @sovereign/web test -- styles.test.ts shell.test.tsx`

Expected: FAIL because the right panel still shares the sidebar surface and shell spacing is broader.

- [x] **Step 3: Implement geometry-only shell changes**

Use compact gaps/padding for `.shell-left`, `.shell-left-main`, `.shell-nav`, `.shell-projects`, and
account bottom. Give `.shell-page` a plain page surface and keep `min-width`, overflow, resizers, and
restore positioning unchanged. Keep the right panel visually secondary with `sunkenSurface` or
`panelSurface` plus the existing subtle divider.

- [x] **Step 4: Run focused tests and verify GREEN**

Run: `pnpm --filter @sovereign/web test -- styles.test.ts shell.test.tsx`

Expected: PASS with no behavioral shell test changes except intentional semantic-wrapper queries.

- [x] **Step 5: Commit shell hierarchy**

```bash
git add apps/web/src/shell/shell.css apps/web/src/shell/styles.test.ts apps/web/src/shell/shell.test.tsx
git commit -m "style(web): refine shell surface hierarchy"
```

### Task 2: Dense sidebar projects and account footer

**Files:**

- Modify: `apps/web/src/sessions/sidebar-projects.tsx`
- Modify: `apps/web/src/sessions/sidebar-projects.test.tsx`
- Modify: `apps/web/src/shell/shell.css`
- Modify: `apps/web/src/shell/account-control.tsx`
- Modify: `apps/web/src/shell/account-control.test.tsx`

**Interfaces:**

- Preserves: controlled expansion, selected session route, project/session actions, daemon status dot, and account menu.
- Produces: compact row height, always-readable selection marker, actions revealed without changing tab order, and full names exposed by accessible labels/title.

- [x] **Step 1: Add failing behavior/accessibility tests**

Add a long project and session name; require the rendered tree item and action labels to expose the
complete text even when CSS truncates it. Keep assertions that action clicks do not select or expand
the node. In the account test, require exactly one status dot and one account trigger.

- [x] **Step 2: Run focused tests and verify RED where markup is missing**

Run: `pnpm --filter @sovereign/web test -- sidebar-projects.test.tsx account-control.test.tsx`

Expected: FAIL on missing full-name title/accessible contract; existing behavior assertions remain green.

- [x] **Step 3: Implement compact semantic rows**

Add only `title`/`aria-label` data needed for truncation. Use shell geometry to align project actions,
keep them compact, and apply the UI Kit selected state instead of creating an application-owned
colour. Do not hide keyboard-focusable actions with `display: none`.

- [x] **Step 4: Run sidebar and shell tests**

Run: `pnpm --filter @sovereign/web test -- sidebar-projects.test.tsx account-control.test.tsx shell.test.tsx styles.test.ts`

Expected: PASS.

- [x] **Step 5: Commit the sidebar density**

```bash
git add apps/web/src/sessions/sidebar-projects.tsx apps/web/src/sessions/sidebar-projects.test.tsx apps/web/src/shell/account-control.tsx apps/web/src/shell/account-control.test.tsx apps/web/src/shell/shell.css
git commit -m "style(web): compact sidebar session navigation"
```

### Task 3: Flat settings master–detail composition

**Files:**

- Modify: `apps/web/src/settings/settings-view.tsx`
- Modify: `apps/web/src/settings/settings-view.test.tsx`
- Modify: `apps/web/src/settings/settings.css`
- Modify: `apps/web/src/shell/styles.test.ts`

**Interfaces:**

- Preserves: required URL-driven `section`, five sections, active content, and narrow horizontal navigation.
- Produces: compact sidebar, serif page/section headings through UI Kit, and divided rows without nested card chrome.

- [x] **Step 1: Write failing structure and style tests**

Require one `h1` for the active section, navigation with `aria-current`, and one active content node.
Assert CSS uses the compact row token for settings nav, subtle dividers for setting groups, and no
`.settings` descendant uses elevation or a panel-style outer radius.

- [x] **Step 2: Run focused tests and verify RED**

Run: `pnpm --filter @sovereign/web test -- settings-view.test.tsx styles.test.ts`

Expected: FAIL on compact/divider rules and any duplicate page-heading structure that remains.

- [x] **Step 3: Implement the flat settings composition**

Keep the existing two-column markup and route mapping. Use a small navigation column, compact rows,
one divider between master/detail, and a readable content width. Group appearance and daemon fields
with spacing and separators; do not wrap every control in `Panel`.

- [x] **Step 4: Verify wide and narrow behavior**

Run: `pnpm --filter @sovereign/web test -- settings-view.test.tsx styles.test.ts`

Expected: PASS for both grid and `<40rem` horizontal-navigation contract.

- [x] **Step 5: Commit settings visuals**

```bash
git add apps/web/src/settings/settings-view.tsx apps/web/src/settings/settings-view.test.tsx apps/web/src/settings/settings.css apps/web/src/shell/styles.test.ts
git commit -m "style(web): flatten settings composition"
```

### Task 4: Provider and plugin system lists

**Files:**

- Modify: `apps/web/src/providers/providers-view.tsx`
- Modify: `apps/web/src/providers/providers-view.test.tsx`
- Modify: `apps/web/src/providers/providers.css`
- Modify: `apps/web/src/plugins/plugins-view.tsx`
- Create: `apps/web/src/plugins/plugins-view.test.tsx`
- Modify: `apps/web/src/shell/shell.css`

**Interfaces:**

- Preserves: provider detail routes, login/logout controls, plugin toggles, contribution toggles, failures, and diagnostics.
- Produces: coherent list/section surfaces with cards only around independently addressable provider/plugin objects.

- [x] **Step 1: Add failing semantic-list tests**

For providers, assert the list remains navigable as whole rows and detail actions are not nested in
the row button. Create a jsdom plugin-view test with the strict core translator and this minimum
snapshot:

```ts
const snapshot: PluginsSnapshot = {
  revision: 1,
  plugins: [
    {
      key: "data:example",
      id: "example",
      source: "data",
      directory: "/plugins/example",
      state: "running",
    },
  ],
  contributions: [
    {
      kind: "custom",
      ownership: "plugin",
      pluginKey: "data:example",
      pluginId: "example",
      source: "data",
      id: "example.action",
      declaredId: "action",
      title: "Example action",
    },
  ],
  switchedOffContributions: [],
  conflicts: [],
  enablement: { "data:example": { enabled: true, disabledContributions: [] } },
};
```

Assert one plugin section/heading, one contribution list item, visible running state and directory,
and working plugin/contribution toggles. Extend `styles.test.ts` with compact plugin-layout rules;
this style assertion is the intentional RED condition, while the new DOM test locks existing behavior.

- [x] **Step 2: Run focused tests and verify RED**

Run: `pnpm --filter @sovereign/web test -- providers-view.test.tsx plugins-view.test.tsx styles.test.ts`

Expected: existing behavior stays green; new list-structure assertions fail on panel-heavy markup.

- [x] **Step 3: Flatten only repeated inner surfaces**

Keep a boundary around one provider/plugin when it is a standalone object. Replace nested panels for
contributions, facts, or controls with list rows, dividers, and headings. Use existing UI Kit `List`,
`ListRow`, `Text`, `Heading`, `Badge`, `Toggle`, and `Notice`; add no application primitive.

- [x] **Step 4: Run system-view verification**

Run:

```bash
pnpm --filter @sovereign/web test -- providers-view.test.tsx plugins-view.test.tsx settings-view.test.tsx shell.test.tsx styles.test.ts
pnpm --filter @sovereign/web typecheck
```

Expected: PASS.

- [x] **Step 5: Commit providers and plugins**

```bash
git add apps/web/src/providers apps/web/src/plugins apps/web/src/shell/shell.css
git commit -m "style(web): refine system management lists"
```

### Task 5: Document and verify the system-view slice

**Files:**

- Modify: `docs/ui-kit.md`
- Modify: `docs/README.md`

**Interfaces:**

- Documents: implemented shell hierarchy, compact sidebar, settings rows, provider/plugin boundaries, and rejected per-view styling.
- Produces: reviewed base for the agent-session slice.

- [x] **Step 1: Update documentation and plan index**

Rewrite the shell/settings/provider/plugin visual descriptions in `docs/ui-kit.md` to match the
implemented flat composition. Record why card boundaries remain only for standalone objects.

- [x] **Step 2: Run complete web verification**

Run:

```bash
pnpm --filter @sovereign/web test
pnpm --filter @sovereign/web typecheck
pnpm eslint apps/web
pnpm prettier --check apps/web docs/ui-kit.md docs/README.md
pnpm --filter @sovereign/web build
git diff --check
```

Expected: all commands exit 0 with no new warnings.

- [x] **Step 3: Commit documentation**

```bash
git add docs/ui-kit.md docs/README.md
git commit -m "docs(web): record refined system views"
```

- [x] **Step 4: Request independent review**

Dispatch a reviewer subagent with the spec, the foundation plan/commit, this plan, and the full diff.
Fix findings with focused tests and repeat review until no findings remain.
