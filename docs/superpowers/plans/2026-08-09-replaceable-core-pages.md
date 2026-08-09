# Replaceable Core Pages Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every Settings section a replaceable core place and record the platform-wide rule for route-level core pages.

**Architecture:** Add one `core.settings.<section>` single place for each Settings section. `App.tsx` owns data/controllers and passes each built-in section view through `HostPlace`; plugins replace only the provider while the route and Settings frame remain core-owned.

**Tech Stack:** TypeScript, React 19, Vitest, protocol place registry, browser SDK `HostPlace`, Markdown project docs.

## Global Constraints

- Keep Settings routes stable as `/settings/<section>`.
- Preserve built-in fallback on missing, disabled, disputed, failed, or unloaded replacements.
- Keep `PlaceContext` window-wide for Settings; do not expose internal App props as public plugin API.
- Run web tests with `NODE_OPTIONS=--no-experimental-webstorage` under Node 25; project requires Node >=24.

### Task 1: Define the public rule and core Settings places

**Files:**

- Modify: `CLAUDE.md`
- Modify: `docs/ui-extension-model.md`
- Modify: `docs/public-contract.md`
- Modify: `docs/ui-kit.md`
- Modify: `packages/protocol/src/places.ts`
- Test: `packages/protocol/src/places.test.ts`

- [x] Add a failing assertion that all Settings core places are present and single/replaceable.
- [x] Add `core.settings.appearance`, `core.settings.usage`, `core.settings.daemon`, and `core.settings.diagnostics`.
- [x] Document the rule, scope, fallback, and new public place names.
- [x] Run protocol tests and confirm the new registry assertion passes.

### Task 2: Route every Settings section through HostPlace

**Files:**

- Modify: `apps/web/src/App.tsx`
- Test: `apps/web/src/App.test.tsx`
- Test: `apps/web/src/places/place-host.test.tsx`

- [x] Add a failing App-level test that Usage receives the canonical Settings context and built-in content through `HostPlace`.
- [x] Create one memoized window-wide Settings context and render Appearance, Usage, Daemon, and Diagnostics through `HostPlace` with built-in nodes.
- [x] Keep existing Projects, Providers, and Plugins HostPlace behavior unchanged.
- [x] Run the targeted web tests with the Node webstorage flag.

### Task 3: Verify the full contract

**Files:**

- No production files.

- [x] Run `make check`.
- [x] Run `make build`.
- [x] Run `git diff --check`.
- [x] Inspect the diff and confirm the main checkout remains on `main` while the feature branch is isolated in the worktree.
