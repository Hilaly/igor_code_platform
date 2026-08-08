# Sovereign Clean-Slate Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace every application and UI Kit stylesheet with a coherent Refined Imperium visual
system while preserving all existing behavior, routes, state, accessibility, and responsive
contracts.

**Architecture:** Keep the existing palette → semantic roles → document CSS variables pipeline and
React component boundaries. Rebuild the visual foundation first, then every UI Kit CSS Module, then
the six application stylesheets; add only the minimal structural React hooks that CSS cannot express.
Verify each slice with real component behavior and finish with browser QA across routes, schemes,
scales, widths, and interaction states.

**Tech Stack:** React 19, TypeScript 5.8, CSS Modules, plain CSS, Fontsource, Vitest, Testing Library,
Ladle, Vite, pnpm 11, Node 24.

## Статус на 2026-08-08

- Tasks 1–8 выполнены и разбиты на атомарные коммиты.
- Все 59 исходных CSS-файлов отличаются от baseline `b9146f8`; текущий шестидесятый файл принадлежит
  новому публичному `AppearancePreview`.
- `make check`, `make build`, production-сборка Ladle и репрезентативная browser QA wide/narrow
  завершены. Независимое итоговое ревью ветки выполняется последним шагом Task 10.
- Task 9 не начат: маршрут и точные определения аналитики требуют явного решения владельца продукта.

## Global Constraints

- Work on branch `feature/frontend_redesign_antigravity`; preserve the pre-existing WIP instead of
  reverting it.
- Replace the complete contents of all 59 source CSS files listed in the design; do not append a
  compatibility layer over old rules.
- Preserve every existing route, controller, request, persisted key, server contract, and business
  behavior.
- Preserve named landmarks, one document heading, ARIA state, live regions, focus management,
  keyboard operation, pointer/keyboard modality behavior, and reduced motion.
- Component and application CSS consumes semantic role and scale variables; color literals remain
  confined to `packages/ui-kit/src/tokens/**`.
- Keep all four shipped schemes and both variants working; geometry must not depend on a scheme.
- Use Source Serif 4 for display/editorial text, Onest for interface text, and IBM Plex Mono for
  machine text.
- Keep cards for standalone objects/tasks only; repeated objects use flat rows and dividers.
- Do not invent UI controls or analytics values that the product cannot perform or compute exactly.
- Use Node `/Users/user/.nvm/versions/node/v24.18.0/bin` for every verification command.
- Use test-first red/green cycles for behavior/API/DOM changes. CSS-only replacement uses failing
  visual-contract tests before the replacement and browser verification after it.
- Make small atomic Conventional Commits in English. Do not push or create a pull request.

---

## File Structure

### Visual foundation

- `packages/ui-kit/src/tokens/{palette,roles}.ts`: semantic color vocabulary, including a rare
  secondary action role.
- `packages/ui-kit/src/tokens/schemes/imperium.ts`: exact Refined Imperium palette literals.
- `packages/ui-kit/src/tokens/tokens.test.ts`: palette, contrast, and role coverage.
- `packages/ui-kit/src/styles/{index,scale,tokens,effects,reset}.css`: font imports, public scale,
  geometry tokens, elevation, global reset, base typography.
- `packages/ui-kit/src/styles/styles.test.ts`: executable stylesheet discipline and state contracts.
- `packages/ui-kit/.ladle/{components.tsx,components.module.css,components.test.tsx}`: scheme/variant/
  scale harness for live QA.

### UI Kit component styles

- Foundation primitives: `button`, `input`, `select`, `field`, `form`, `toggle`, `radio-group`,
  `segmented-control`, `slider`, `link`, `icon`, `icons`, `text`, `code`, `badge`, `status-dot`.
- Surfaces and feedback: `panel`, `raised-surface`, `notice`, `state`, `skeleton`, `progress`,
  `streaming-text`, `toast`, `dialog`.
- Navigation and overlays: `menu`, `popover`, `tooltip`, `tabs`, `breadcrumbs`, `accordion`,
  `disclosure`, `list`, `tree`, `tree-context-card`, `view-header`.
- Rich controls and content: `combobox`, `multi-select`, `model-picker`, `next-turn-picker`,
  `file-picker`, `markdown`, `message-feed`, `tool-call`, `duration-timer`, `brand-lockup`,
  `settings-frame`.

### Application styles and structural hooks

- `apps/web/src/shell/{shell.css,shell.tsx,styles.test.ts}` and `apps/web/src/App.tsx`: shell, brand,
  sidebar, header, panels, resizers.
- `apps/web/src/login/login.css`: authentication layout.
- `apps/web/src/sessions/sessions.css` plus session components/tests: chat, composer, usage strip,
  new/archive/tree pages.
- `apps/web/src/settings/settings.css`, settings and plugin components/tests: all Settings sections,
  plugin detail, diagnostics, live appearance preview.
- `apps/web/src/projects/projects.css`: project index/detail/resources and dialogs.
- `apps/web/src/providers/providers.css`: provider index/detail/login/create/edit/model rows.
- `packages/ui-kit/src/i18n/messages/{en,ru}.ts`: only copy needed by genuinely added structure.

### Documentation

- `docs/ui-kit.md`: current visual-system contract and rationale.
- `docs/README.md`: spec and plan index.
- `docs/backlog.md`: only defects observed and deliberately deferred during live QA.

---

### Task 1: Refined Imperium roles and global CSS foundation

**Files:**

- Modify: `packages/ui-kit/src/tokens/roles.ts`
- Modify: `packages/ui-kit/src/tokens/schemes/imperium.ts`
- Modify: `packages/ui-kit/src/tokens/tokens.test.ts`
- Replace: `packages/ui-kit/src/styles/index.css`
- Replace: `packages/ui-kit/src/styles/scale.css`
- Replace: `packages/ui-kit/src/styles/tokens.css`
- Replace: `packages/ui-kit/src/styles/effects.css`
- Replace: `packages/ui-kit/src/styles/reset.css`
- Modify: `packages/ui-kit/src/styles/styles.test.ts`

**Interfaces:**

- Preserves: 15-key palette, token contract major `2`, `deriveRoles`, `applyRoles`, `applyScale`,
  existing public role names and all four scheme identifiers.
- Produces: exact dark Refined Imperium surface/accent/secondary hierarchy and a semantic secondary
  action family usable by UI Kit without component color literals.
- Consumed by: all later CSS tasks.

- [x] **Step 1: Write failing role, palette, and global-style behavior tests**

  Add literal expected dark Imperium values to `tokens.test.ts`, extend the role-pair contrast matrix
  for any new secondary action roles, and update `styles.test.ts` to exercise the new token consumers
  rather than grep obsolete geometry. Name the mutations: wrong dark palette, incomplete derived role,
  unreadable action text, missing Onest fallback, and reintroduced decorative effect.

- [x] **Step 2: Run focused tests and verify RED**

  Run:

  ```bash
  PATH=/Users/user/.nvm/versions/node/v24.18.0/bin:$PATH \
    pnpm --filter @sovereign/ui-kit test -- tokens.test.ts styles.test.ts
  ```

  Expected: FAIL on the old palette/roles/global style contract for the exact named mutations.

- [x] **Step 3: Replace the five global CSS files and implement roles**

  Recreate each file from an empty body. Preserve imports and public custom-property names, declare
  only used geometry/motion/elevation tokens, add `"Onest"` fallback, and keep reduced-motion and
  global focus/selection/scrollbar behavior. Put exact colors only in `imperium.ts`.

- [x] **Step 4: Verify GREEN and contrast**

  Run the focused tests plus UI Kit typecheck. Expected: all pass with every derived text/surface pair
  at or above the repository contrast threshold.

- [x] **Step 5: Commit the foundation**

  ```bash
  git add packages/ui-kit/src/tokens packages/ui-kit/src/styles
  git commit -m "feat(ui-kit): rebuild Refined Imperium foundation"
  ```

### Task 2: Core controls clean-slate CSS Modules

**Files:**

- Replace: `packages/ui-kit/src/components/{button,input,select,field,form,toggle,radio-group,segmented-control,slider,link,icon,icons,text,code,badge,status-dot}.module.css`
- Modify: `packages/ui-kit/src/components/button.tsx`
- Modify: `packages/ui-kit/src/components/interactive-components.test.tsx`
- Modify: `packages/ui-kit/src/styles/styles.test.ts`

**Interfaces:**

- Preserves: every existing prop, label, tone, size, pressed/checked/invalid/disabled state, native
  semantics, focus behavior, and runtime custom property.
- Produces: optional semantic secondary/gold `Button` tone for the real send action.
- Consumed by: every screen and rich component.

- [x] **Step 1: Add failing interaction tests for the new action tone and state matrix**

  Render the real `Button`, Toggle, inputs, selections, segmented and radio controls. Assert native
  role/state/disabled behavior and that the new tone is addressable through the public component
  API. Do not assert CSS hashes.

- [x] **Step 2: Run focused tests and verify RED**

  Run interactive/rendering/style tests. Expected: the secondary action tone is absent and the new
  visual-state contract rejects the old modules.

- [x] **Step 3: Recreate all 17 modules from empty files**

  Cover hover, focus-visible, active, disabled, pressed/checked, invalid, sizes, icon-only and reduced
  motion. Preserve `--toggle-*`, segmented index/count, slider thumb and textarea runtime contracts.

- [x] **Step 4: Verify controls**

  Run UI Kit tests/typecheck and build Ladle. Expected: all control behavior remains green and the
  catalogue builds.

- [x] **Step 5: Commit core controls**

  ```bash
  git add packages/ui-kit/src/components packages/ui-kit/src/styles/styles.test.ts
  git commit -m "style(ui-kit): rebuild core controls"
  ```

### Task 3: Surfaces, feedback, navigation, and overlays clean-slate CSS Modules

**Files:**

- Replace: `packages/ui-kit/src/components/{panel,raised-surface,notice,state,skeleton,progress,streaming-text,toast,dialog,menu,popover,tooltip,tabs,breadcrumbs,accordion,disclosure,list,tree,tree-context-card,view-header}.module.css`
- Modify: corresponding component tests only where a structural behavior regression is exposed.
- Modify: `packages/ui-kit/src/styles/styles.test.ts`

**Interfaces:**

- Preserves: overlay placement, focus trap, menu/tree roving focus, portal positions, disclosures,
  tooltip pointer/keyboard modality, toast/live regions, tones, selected/expanded/open states, and
  every runtime positioning property.
- Produces: flat system surfaces, purple selected rows, restrained overlay elevation, thin context
  header and consistent feedback states.

- [x] **Step 1: Add failing behavior contracts for stateful surfaces**

  Exercise real Dialog, Menu, Tooltip, Tree, Disclosure, Tabs, Notice and Toast interactions. Each
  test names a break that would matter after a rewrite: trapped focus lost, pointer-focus leaks a
  tooltip, expanded state hidden, selected row loses semantics, or alert/live region disappears.

- [x] **Step 2: Verify RED against the intended clean-slate visual contract**

  Run focused component and stylesheet tests. Expected: new surface/state requirements fail while
  unchanged behavior tests establish the baseline.

- [x] **Step 3: Recreate all 21 modules from empty files**

  Preserve CSS variable positions and state selectors; rebuild appearance using only roles and scale.
  Keep elevation only for actual raised/overlay surfaces and make reduced motion deterministic.

- [x] **Step 4: Verify surfaces and overlays**

  Run all UI Kit tests, typecheck and Ladle build. Expected: 0 failures and no console/build warnings.

- [x] **Step 5: Commit surface/navigation modules**

  ```bash
  git add packages/ui-kit/src/components packages/ui-kit/src/styles/styles.test.ts
  git commit -m "style(ui-kit): rebuild surfaces and navigation"
  ```

### Task 4: Rich controls, editorial chat, and Settings frame clean-slate CSS Modules

**Files:**

- Replace: `packages/ui-kit/src/components/{combobox,multi-select,model-picker,next-turn-picker,file-picker,markdown,message-feed,tool-call,duration-timer,brand-lockup,settings-frame}.module.css`
- Modify: `packages/ui-kit/src/components/settings-frame.tsx`
- Modify: rich component tests and `rendering.test.tsx`
- Replace: `packages/ui-kit/.ladle/components.module.css`
- Modify: `packages/ui-kit/.ladle/components.tsx`
- Modify: `packages/ui-kit/.ladle/components.test.tsx`
- Modify: `packages/ui-kit/src/components/{chat,primitives,ported}.stories.tsx`

**Interfaces:**

- Preserves: model catalogue loading/failure/expansion, picker placements, Markdown sanitization,
  feed live region/stickiness, ToolCall disclosure and states, Settings row full-target semantics,
  Settings breakpoints, and public component props.
- Produces: editorial agent voice, coffee human bubble, machine execution blocks, `SETTINGS` label,
  Refined Imperium component catalogue and live scheme/variant/scale QA harness.

- [x] **Step 1: Add failing rich-component behavior tests**

  Render real chat/tool/pickers/settings components. Protect all existing behaviors and add semantic
  assertions for visible Settings navigation heading and the machine block's running/done/failed
  text—not source-string or CSS-hash assertions.

- [x] **Step 2: Run focused tests and verify RED**

  Expected: the intended Settings/context structure or visual-state contract is missing while legacy
  behavior tests remain green.

- [x] **Step 3: Recreate the 11 modules and Ladle style from empty files**

  Implement all picker/open/selected/loading/failure states, editorial typography, human/service
  roles, technical blocks, Settings responsive master-detail, long-id overflow and catalogue layout.
  Correct the WIP Settings selected-text contrast: soft `accentSurface` uses normal readable text.

- [x] **Step 4: Verify rich UI Kit and catalogue**

  Run the complete UI Kit suite, typecheck and Ladle production build. Expected: all pass.

- [x] **Step 5: Commit rich components**

  ```bash
  git add packages/ui-kit
  git commit -m "style(ui-kit): rebuild rich application components"
  ```

### Task 5: Shell, sidebar, header, and login clean-slate redesign

**Files:**

- Replace: `apps/web/src/shell/shell.css`
- Replace: `apps/web/src/login/login.css`
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/shell/shell.tsx`
- Modify: `apps/web/src/shell/page.tsx`
- Modify: shell/login tests and `apps/web/src/shell/styles.test.ts`

**Interfaces:**

- Preserves: Shell props, left/right visibility, unavailable right panel, stored widths, resizers,
  restore buttons, account actions/status, header ownership, Login credentials and every route.
- Produces: `◆ Sovereign` brand, new-session primary action, dense purple sidebar selection, thin
  contextual header, centered login surface.

- [x] **Step 1: Add failing shell composition tests**

  Require the real sidebar to render BrandLockup/brand semantics and retain named navigation,
  resizers, account menu and header. Update CSS behavior tests to assert shrink/scroll/responsive
  outcomes of the new contract instead of exact old rule order.

- [x] **Step 2: Run shell/login tests and verify RED**

  Expected: missing new brand/context structure; existing behavior tests remain the regression net.

- [x] **Step 3: Recreate `shell.css` and `login.css` from empty files**

  Remove dead plugin/shell selectors, move plugin reasons to Settings ownership, and implement all
  hidden/visible/contained/page/resizer/focus/narrow states. Make only minimal TSX structure changes.

- [x] **Step 4: Verify shell and login**

  Run shell, layout, page, account, router, Login and web style tests plus web typecheck.

- [x] **Step 5: Commit shell/login**

  ```bash
  git add apps/web/src/App.tsx apps/web/src/shell apps/web/src/login
  git commit -m "style(web): rebuild shell and authentication"
  ```

### Task 6: Agent session, composer, and session-management clean-slate redesign

**Files:**

- Replace: `apps/web/src/sessions/sessions.css`
- Modify: `apps/web/src/sessions/message-composer.tsx`
- Modify: session tests and `apps/web/src/shell/styles.test.ts`

**Interfaces:**

- Preserves: session route states, feed order/live updates, hover/focus actions, copy/label/fork,
  queues, append/send/stop, model/reasoning picker, usage data, textarea growth, new-session and archive
  flows, tree drawer and all refusals.
- Produces: editorial chat, clean machine register, gold send action, bottom composer, compact
  management pages and narrow-container behavior.

- [x] **Step 1: Add failing composer/session visual-contract tests**

  Protect the real action set and assign only send the new secondary action tone. Assert all actions
  still invoke their existing callbacks and retain accessible names; protect contained layout and
  textarea-only overflow through observable rendered structure plus browser checks.

- [x] **Step 2: Run focused tests and verify RED**

  Expected: Send lacks secondary action tone or new structural hook. Existing 235 session tests remain
  green except the intentional new assertion.

- [x] **Step 3: Recreate `sessions.css` from an empty file**

  Cover every inventoried selector and state, including previously unstyled form/archive wrappers.
  Preserve contained Shell, feed scroll, composer bottom position, 2–12 row textarea, container
  queries, message action modality and usage warning/danger states.

- [x] **Step 4: Verify all session behavior**

  Run every session test, router tests, web styles and typecheck. Expected: all pass.

- [x] **Step 5: Commit sessions**

  ```bash
  git add apps/web/src/sessions apps/web/src/shell/styles.test.ts
  git commit -m "style(web): rebuild agent session surfaces"
  ```

### Task 7: Settings, Appearance preview, and Plugin Detail clean-slate redesign

**Files:**

- Replace: `apps/web/src/settings/settings.css`
- Modify: `apps/web/src/settings/appearance-section.tsx`
- Modify: `apps/web/src/settings/settings-view.tsx`
- Modify: `apps/web/src/plugins/plugin-detail-view.tsx`
- Modify: Settings/plugin tests and translations only as required.

**Interfaces:**

- Preserves: six Settings routes, URL-selected section, full-row nested action behavior, Appearance
  persistence, config writes, plugin/preferences writes, contribution disclosure, diagnostics and all
  loading/stale/failure/not-found states.
- Produces: Refined master-detail, context chain, live Imperium preview/swatches, plugin hero/facts/
  warning/contributions layout.

- [x] **Step 1: Add failing semantic tests for Appearance preview and Plugin Detail**

  Require a named live preview that reflects the selected scheme label and exposes semantic swatches
  accessibly; require Plugin Detail's header/facts/contribution sections without changing switch
  payloads. Protect the one-heading contract.

- [x] **Step 2: Run focused tests and verify RED**

  Expected: preview is absent and the new detail grouping assertion fails.

- [x] **Step 3: Implement minimal structure and recreate `settings.css` from empty**

  Preserve the previous agent's useful WIP intent but rewrite the final file wholly. Own plugin
  selectors here, cover every section and narrow layout, and remove dead project selectors.

- [x] **Step 4: Verify Settings and plugins**

  Run all Settings, plugins, appearance, router and style tests plus typecheck.

- [x] **Step 5: Commit Settings and plugins**

  ```bash
  git add apps/web/src/settings apps/web/src/plugins packages/ui-kit/src/i18n
  git commit -m "style(web): rebuild settings and plugin detail"
  ```

### Task 8: Projects and providers clean-slate redesign

**Files:**

- Replace: `apps/web/src/projects/projects.css`
- Replace: `apps/web/src/providers/providers.css`
- Modify: project/provider TSX only for missing semantic wrappers.
- Modify: project/provider tests and `apps/web/src/shell/styles.test.ts`.

**Interfaces:**

- Preserves: every project/provider list/detail/form/login/model/resource action and all loading,
  stale, conflict, not-found, validation, busy and destructive states.
- Produces: consistent Settings rows, dense facts/marks, readable forms, resource diagnostics and
  responsive detail layouts.

- [x] **Step 1: Add failing semantic/responsive contracts**

  Protect real named lists/sections/toolbars, full-row selection with independent actions, form
  labels/errors and long-path accessible values. Add structure only where current generic wrappers do
  not expose a real region.

- [x] **Step 2: Run focused tests and verify RED**

  Expected: only intentional new semantic assertions fail.

- [x] **Step 3: Recreate both CSS files from empty**

  Cover every inventoried class/state and keyboard-only tooltip reveal. Keep application CSS limited
  to geometry and role/scale consumers.

- [x] **Step 4: Verify projects/providers**

  Run all project/provider tests, web styles and typecheck.

- [x] **Step 5: Commit projects/providers**

  ```bash
  git add apps/web/src/projects apps/web/src/providers apps/web/src/shell/styles.test.ts
  git commit -m "style(web): rebuild projects and providers"
  ```

### Task 9: Usage analytics screen (blocked on owner decision)

**Files:**

- Candidate Modify: `apps/web/src/router.ts`, router tests, `apps/web/src/App.tsx`
- Candidate Create: `apps/web/src/usage/{usage-view,usage-state,usage-api}.ts[x]` and tests
- Candidate Modify: Settings view/types/translations and the relevant clean-slate CSS owner.

**Interfaces:**

- Candidate consumes: existing session list and per-session exact stats endpoints.
- Must not produce: guessed request counts, guessed coverage, fake daily buckets, or a new daemon/API
  contract without explicit owner approval.

- [ ] **Step 1: Record the owner's placement/data decision**

  Recommended: `/settings/usage`, client aggregation of exact existing data. If exact daily/request/
  coverage definitions need unavailable data, stop and present the minimal protocol/API alternatives.

- [ ] **Step 2: Write failing route/state/view tests from the approved definitions**

- [ ] **Step 3: Implement the smallest exact data path and screen**

- [ ] **Step 4: Verify route, state, accessibility, loading/failure/empty and chart/table rendering**

- [ ] **Step 5: Commit analytics separately**

### Task 10: Full browser QA, documentation, and independent review

**Files:**

- Modify: `docs/ui-kit.md`
- Modify: `docs/README.md`
- Modify: `docs/backlog.md` only for observed deferrals.
- Modify: any file required by defects reproduced during QA, with a failing regression test first for
  behavioral defects.

**Interfaces:**

- Produces: documented current visual system, fresh verification evidence, clean independent review,
  and an atomic committed branch.

- [x] **Step 1: Prove every CSS file was wholly replaced**

  Compare all 59 source CSS blobs with the starting commit and review each final file for historical
  selector/comment residue. Confirm every current TSX CSS class is styled or intentionally layout-free,
  and every final selector has a current consumer or documented pseudo/state purpose.

- [x] **Step 2: Run full automated verification on Node 24**

  ```bash
  PATH=/Users/user/.nvm/versions/node/v24.18.0/bin:$PATH make check
  PATH=/Users/user/.nvm/versions/node/v24.18.0/bin:$PATH make build
  PATH=/Users/user/.nvm/versions/node/v24.18.0/bin:$PATH \
    pnpm --filter @sovereign/ui-kit exec ladle build
  git diff --check
  ```

  Expected: all commands exit 0, no failures and no new warnings.

- [x] **Step 3: Run browser QA matrix**

  Start web and Ladle. Inspect every available route and canonical component story in Imperium dark/
  light, all three scales, wide/narrow containers; smoke Nord/OLED/Sage light/dark. Exercise hover,
  keyboard focus, menus, dialogs, disclosures, selected/pressed/disabled, loading/empty/warning/danger,
  long strings and textarea growth. Save representative screenshots as ignored review artifacts.

- [x] **Step 4: Fix every reproduced defect and repeat the affected matrix**

  Behavioral defects receive a red/green regression test. CSS-only defects receive a focused
  visual-contract test when behavior can be expressed reliably, plus fresh browser evidence.

- [x] **Step 5: Update durable documentation and commit it**

  Rewrite obsolete visual descriptions in `docs/ui-kit.md`, update the spec/plan status and index,
  and record only real deliberate deferrals in `docs/backlog.md`.

- [ ] **Step 6: Request independent whole-branch review**

  Give the reviewer the design, this plan, merge-base and HEAD. Fix every Critical/Important finding
  in one wave, run a scoped re-review, then repeat the full verification commands.

- [ ] **Step 7: Finalize the branch**

  Confirm `git status`, atomic Conventional Commits, current docs, and no untracked build artifacts.
