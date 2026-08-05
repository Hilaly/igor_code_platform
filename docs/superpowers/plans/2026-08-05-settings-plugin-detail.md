# Settings and Plugin Detail Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement the approved Refined Imperium settings shell across all settings sections and add an addressable `/settings/plugins/:pluginKey` detail page while preserving existing behavior and API contracts.

**Architecture:** Keep `PluginsState` and the existing `writePluginPreferences` API as the source of truth. Extend the local router with an administrative plugin-detail page distinct from `/p/...` plugin-contributed pages; compose list/detail views through `SettingsView` and `PageView`. Replace per-plugin `Panel` composition with compact rows and move contribution controls plus diagnostics into `PluginDetailView`.

**Tech Stack:** React 19, TypeScript, Vitest + Testing Library, CSS Modules/role tokens from `@sovereign/ui-kit`, custom history router, pnpm workspace.

## Global Constraints

- Work only in `/Users/user/repos/sovereign_platform_node/.worktrees/settings-plugin-detail` on `feat/settings-plugin-detail`.
- Preserve existing plugin snapshot, preferences payload, API routes, stream behavior, provider routes, and `/p/<pluginId>/<pageId>/*` plugin pages.
- Use UI-kit primitives and semantic role/scale tokens; no new color literals in application CSS.
- Follow TDD: each production change has a failing test observed before implementation.
- Keep documentation in the same commit as the behavior it documents; use Russian docs and English identifiers/commits.
- Existing baseline failure: `apps/web/src/sessions/sidebar-projects.test.tsx` has one unrelated flaky assertion about `project is busy`; do not modify it in this feature.

## File Map

- Modify `apps/web/src/router.ts` and `apps/web/src/router.test.ts`: add `settings-plugin` page parsing/serialization with encoded plugin keys and unknown-key-safe routing.
- Modify `apps/web/src/shell/page.tsx` and its tests if present: route the administrative detail view through the page composition.
- Create `apps/web/src/plugins/plugin-detail-view.tsx`: render facts, lifecycle/problem notices, plugin toggle, contribution toggles and technical disclosures.
- Create `apps/web/src/plugins/plugin-detail-view.test.tsx`: component contract for running, failed, disabled and forgotten contributions plus callbacks.
- Modify `apps/web/src/plugins/plugins-view.tsx` and `apps/web/src/plugins/plugins-view.test.tsx`: compact plugin rows, open-detail callback, preserved list states and no contribution disclosure in the overview.
- Modify `apps/web/src/App.tsx`: pass plugin detail/list callbacks and route selection; keep one `usePlugins` state and write handler.
- Modify `apps/web/src/settings/settings-view.tsx`, `apps/web/src/settings/settings.css`, and tests: approved top context bar, compact local navigation, flat content geometry, detail-aware heading/breadcrumb slot, and responsive layout.
- Modify `apps/web/src/plugins/plugins.css` and `apps/web/src/shell/styles.test.ts` as needed: list/detail placement using only UI-kit roles and scale tokens.
- Modify `packages/ui-kit/src/i18n/messages/en.ts` and `ru.ts`: labels for plugin detail and compact list actions.
- Modify `docs/ui-kit.md` and `docs/README.md`: describe implemented settings/detail contract and link the plan.

### Task 1: Canonical administrative plugin-detail route

**Files:**
- Modify: `apps/web/src/router.test.ts`
- Modify: `apps/web/src/router.ts`

**Interfaces:**
- Produce page union member `{ kind: "settings-plugin"; pluginKey: string }`.
- `matchPage("/settings/plugins/data%3Ausage")` returns `{ kind: "settings-plugin", pluginKey: "data:usage" }`.
- `pathOf({ kind: "settings-plugin", pluginKey: "data:usage" })` returns `/settings/plugins/data%3Ausage`.

- [ ] Write failing tests for encoded colon keys, dot-segment-safe encoding, round-trip path serialization, and `/settings/plugins` remaining the list route.
- [ ] Run `pnpm --filter @sovereign/web test -- router.test.ts`; expect failures because the route member and matcher do not exist.
- [ ] Implement the minimal route branch before generic settings branches, reusing `encodeProviderId`/`decodeProviderId` only after extracting a named generic key helper if necessary.
- [ ] Run the focused router tests and then `pnpm --filter @sovereign/web test -- router.test.ts router-navigation.test.ts`; expect all route assertions to pass.
- [ ] Commit `feat(web): add plugin settings detail route`.

### Task 2: Detail view contract and contribution data projection

**Files:**
- Create: `apps/web/src/plugins/plugin-detail-view.test.tsx`
- Create: `apps/web/src/plugins/plugin-detail-view.tsx`

**Interfaces:**
- `PluginDetailViewProps` consumes `state: PluginsState`, `pluginKey: string`, `onBack: () => void`, `onSwitch: (pluginKey: string, preferences: PluginPreferences) => void`, and `translator`.
- Detail derives `PluginStatus`, current enablement, active/switched-off plugin-owned contributions, and forgotten disabled IDs from the snapshot; it never fetches independently.

- [ ] Build a fixture with one running plugin, one event contribution with `payloadSchema`, one agent contribution, one switched-off contribution, one forgotten ID, and a contribution problem.
- [ ] Write failing component tests for facts/lifecycle/path, plugin toggle payload, contribution toggle payload, technical disclosure, forgotten contribution notice, and not-found state.
- [ ] Run `pnpm --filter @sovereign/web test -- plugin-detail-view.test.tsx`; expect failures because the component is absent.
- [ ] Implement a semantic detail view with one page heading, `←` back action, facts rows, `Notice` for `reason`/`contributionProblems`, `Toggle` controls, and `Disclosure`/`CodeBlock` payloads.
- [ ] Run the focused detail test; then add loading/failure behavior tests only if the component contract requires it (the existing settings shell owns section-level loading).
- [ ] Commit `feat(web): add plugin settings detail view`.

### Task 3: Compact plugin overview with navigation

**Files:**
- Modify: `apps/web/src/plugins/plugins-view.test.tsx`
- Modify: `apps/web/src/plugins/plugins-view.tsx`
- Modify: `apps/web/src/plugins/plugins.css`

**Interfaces:**
- Extend `PluginsViewProps` with `onOpen: (pluginKey: string) => void`.
- Overview renders one compact row per `PluginStatus`; row action/open click calls `onOpen` and does not render contribution toggles or technical disclosures.
- Existing stale, failure, conflicts, empty, and lifecycle badge semantics remain.

- [ ] Add failing tests proving list rows expose plugin name/key/state, `onOpen` receives the exact key, and contribution controls are absent from the list.
- [ ] Run the focused plugin tests; observe the expected failures against the current `Panel`/inline-contribution implementation.
- [ ] Replace `PluginPanel` overview rendering with compact semantic rows while retaining conflict/problem notices at list level.
- [ ] Keep the existing plugin toggle available in the overview only if it fits the approved compact-row action model; otherwise put it beside the row action with an accessible label and identical callback payload.
- [ ] Update CSS to use flat rows, separators, mono metadata, and no custom panel chrome; run focused plugin tests plus `styles.test.ts`.
- [ ] Commit `refactor(web): compact plugin settings list`.

### Task 4: Settings shell and page composition

**Files:**
- Modify: `apps/web/src/settings/settings-view.test.tsx`
- Modify: `apps/web/src/settings/settings-view.tsx`
- Modify: `apps/web/src/settings/settings.css`
- Modify: `apps/web/src/shell/page.tsx`
- Modify: `apps/web/src/App.tsx`

**Interfaces:**
- `SettingsView` keeps `section` URL-driven and accepts a detail-aware `plugins` node; `App` selects list/detail by page kind without duplicating plugin state.
- `PageView` accepts a `settingsPlugin` node and returns it for `kind === "settings-plugin"`.

- [ ] Add failing tests for SettingsView's context bar/breadcrumb slot, one heading, active Plugins navigation on detail, and PageView routing of `settings-plugin`.
- [ ] Run focused settings/page tests; expect failures against the current generic heading-only composition.
- [ ] Implement the flat top bar and content slots; route `/settings/plugins/:pluginKey` with `rightUnavailable` still active and `Plugins` selected.
- [ ] Wire `PluginsView.onOpen` to `navigation.navigate({ kind: "settings-plugin", pluginKey })`, detail back to `{ kind: "settings", section: "plugins" }`, and keep all existing provider routes unchanged.
- [ ] Run focused tests and `pnpm --filter @sovereign/web typecheck`.
- [ ] Commit `feat(web): compose settings plugin detail route`.

### Task 5: Localization, visual polish, and documentation

**Files:**
- Modify: `packages/ui-kit/src/i18n/messages/en.ts`
- Modify: `packages/ui-kit/src/i18n/messages/ru.ts`
- Modify: `apps/web/src/settings/settings.css`
- Modify: `apps/web/src/plugins/plugins.css`
- Modify: `docs/ui-kit.md`
- Modify: `docs/README.md`

- [ ] Add failing translation assertions for new list/detail labels and contribution kind fallback coverage.
- [ ] Run focused i18n/component tests and observe missing-key diagnostics.
- [ ] Add complete English/Russian messages for breadcrumbs, back action, facts, contribution sections, technical data, not-found, and compact row actions.
- [ ] Tune spacing, separators, serif/sans/mono roles, and responsive behavior to match the approved reference; do not add literal colors or one-off component chrome.
- [ ] Update `docs/ui-kit.md` with the implemented settings/detail contract and the reason the overview is compact.
- [ ] Run `pnpm prettier --write` only on touched files, then `pnpm prettier --check .`, `pnpm eslint .`, and `git diff --check`.
- [ ] Commit `style(web): align settings detail with imperium reference`.

### Task 6: Full verification and live visual QA

**Files:**
- No new source files; verify all touched files.

- [ ] Run targeted web tests for router, settings, plugins, detail, shell styles, and App composition.
- [ ] Run `pnpm -r typecheck`, `pnpm eslint .`, `pnpm prettier --check .`, `pnpm --filter @sovereign/web build`, and `git diff --check`.
- [ ] Start the daemon/web app using `docs/runbook.md`, open `/settings/appearance`, `/settings/plugins`, and `/settings/plugins/<encoded-key>` in the browser, and capture screenshots at wide and narrow widths.
- [ ] Verify the live detail visually against the supplied reference: warm dark surfaces, thin gold borders, serif heading, purple active state, flat rows, mono metadata, and no nested-card clutter.
- [ ] Record the pre-existing sidebar-projects baseline failure separately if it still reproduces; do not claim the full monorepo suite is green unless that test passes.
- [ ] Commit only any final verification/documentation adjustment as `chore(web): verify settings plugin detail`.

