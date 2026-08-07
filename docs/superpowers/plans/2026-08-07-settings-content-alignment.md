# Settings Content Alignment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Align every Settings section and nested detail page with the existing Appearance visual contract.

**Architecture:** Preserve the shared `SettingsView`/`SettingsPage` shell and normalize subject content with flat rows and separators. Keep routing and data behavior unchanged while making Projects and Providers object rows fully clickable.

**Tech Stack:** React 19, TypeScript, CSS Modules and application CSS, Vitest, Testing Library, Vite.

## Global Constraints

- Work only in the isolated `feat/settings-tabs-alignment` worktree.
- Preserve all API payloads, routes, forms and toggle behavior.
- Use only UI-kit tokens for visual values.
- Verify wide and narrow Settings layouts visually.

---

### Task 1: System sections

**Files:**

- Modify: `apps/web/src/settings/daemon-section.tsx`
- Modify: `apps/web/src/settings/diagnostics-section.tsx`
- Modify: `apps/web/src/settings/settings.css`
- Test: `apps/web/src/settings/*.test.tsx`

- [ ] Write render tests for Appearance-aligned rows and states.
- [ ] Run the focused tests and confirm the new expectations fail.
- [ ] Implement flat property and diagnostic rows.
- [ ] Run the focused tests and typecheck.

### Task 2: Projects and Providers

**Files:**

- Modify: `apps/web/src/projects/projects-view.tsx`
- Modify: `apps/web/src/projects/projects.css`
- Modify: `apps/web/src/providers/providers-view.tsx`
- Modify: `apps/web/src/providers/providers.css`
- Test: corresponding component tests.

- [ ] Write tests proving the whole object rows navigate to details and nested actions remain usable.
- [ ] Run focused tests and confirm the expectations fail for the current geometry.
- [ ] Normalize list and detail geometry to the Appearance rhythm.
- [ ] Run focused tests and typecheck.

### Task 3: Plugins and plugin details

**Files:**

- Modify: `apps/web/src/plugins/plugins-view.tsx`
- Modify: `apps/web/src/plugins/plugin-detail-view.tsx`
- Modify: `apps/web/src/settings/settings.css`
- Test: corresponding component tests.

- [ ] Write tests for flat list and detail structure.
- [ ] Run focused tests and confirm the new expectations fail.
- [ ] Implement aligned rows, facts and contribution groups.
- [ ] Run focused tests and typecheck.

### Task 4: Integration and visual verification

**Files:**

- Modify: `docs/ui-kit.md` only if the implemented contract needs clarification.
- Modify: `docs/README.md` to index this design and plan.

- [ ] Run workspace tests, typecheck, ESLint, Prettier, web build and `git diff --check`.
- [ ] Launch the web application and inspect every Settings list and detail at wide and narrow widths.
- [ ] Fix observed alignment regressions and repeat the full verification.
- [ ] Commit the complete atomic change.
