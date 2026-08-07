# Animated Toggle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the UI Kit checkbox-like `Toggle` with one animated switch and remove duplicate visible labels from toggles inside Settings rows.

**Architecture:** `Toggle` remains the only stateful-looking primitive and the native checkbox remains its source of truth. A new explicit `labelDisplay: "visible" | "tooltip"` presentation prop controls whether its required label is rendered beside the switch or visually hidden and repeated through the existing UI Kit `Tooltip`; application consumers choose the mode, while the switch geometry and animation stay entirely inside UI Kit.

**Tech Stack:** React 19, TypeScript, CSS Modules, Vitest, Testing Library, Vite.

## Global Constraints

- Keep `label` mandatory and keep the native `<input type="checkbox">` semantics.
- Preserve `size="sm" | "xs"`; default size remains `sm` and default label mode remains `visible`.
- Use only UI Kit role and scale tokens for visual values.
- Disable transitions under `prefers-reduced-motion: reduce`.
- Use `labelDisplay="tooltip"` for every Toggle inside `SettingsRow`; standalone consumers retain visible labels.
- Do not change callback payloads, stored preferences, routes, or server APIs.
- Keep the Vite server on port `5274` running throughout implementation.

---

### Task 1: Animated UI Kit switch

**Files:**

- Modify: `packages/ui-kit/src/components/toggle.tsx`
- Modify: `packages/ui-kit/src/components/toggle.module.css`
- Modify: `packages/ui-kit/src/components/rendering.test.tsx`
- Modify: `packages/ui-kit/src/components/interactive-components.test.tsx`
- Modify: `packages/ui-kit/src/styles/styles.test.ts`
- Modify: `packages/ui-kit/src/components/primitives.stories.tsx`

**Interfaces:**

- Consumes: existing `Tooltip`, native checkbox behavior, UI Kit tokens.
- Produces: `ToggleProps.labelDisplay?: "visible" | "tooltip"`, defaulting to `visible`.

- [ ] **Step 1: Write failing behavior and markup tests**

Add tests proving that default markup exposes visible label text, tooltip mode exposes a tooltip plus a visually hidden label, both keep a checkbox named by `label`, and clicking the switch calls `onChange` with the new boolean.

- [ ] **Step 2: Write failing CSS contract tests**

Require an inline-flex rounded track, a circular thumb, checked translation, role-token state colors, focus-visible outline, disabled state, transitions, separate `sm`/`xs` geometry, and a reduced-motion media query that removes transitions.

- [ ] **Step 3: Run the UI Kit tests and verify RED**

Run: `pnpm --filter @sovereign/ui-kit test`

Expected: failures for missing `labelDisplay`, tooltip markup, and switch CSS.

- [ ] **Step 4: Implement the minimal component and CSS**

Add `labelDisplay` to `ToggleProps`. Render the same native checkbox and label in both modes; in tooltip mode visually hide the label text and wrap the labelled switch with `Tooltip`. Replace the square/checkmark CSS with a rounded track and `::after` thumb whose transform follows `:checked`; make size classes own track variables and label font size; add reduced-motion handling.

- [ ] **Step 5: Update the primitive story and verify GREEN**

Show both visible-label and tooltip modes in the existing Toggle story. Run `pnpm --filter @sovereign/ui-kit test && pnpm --filter @sovereign/ui-kit typecheck` and expect all tests and typecheck to pass.

### Task 2: Adopt compact tooltip toggles in Settings

**Files:**

- Modify: `apps/web/src/plugins/plugins-view.tsx`
- Modify: `apps/web/src/plugins/plugin-detail-view.tsx`
- Modify: `apps/web/src/providers/user-provider-form.tsx`
- Modify: `apps/web/src/plugins/plugins-view.test.tsx`
- Modify: `apps/web/src/plugins/plugin-detail-view.test.tsx`
- Modify: `apps/web/src/providers/user-provider-form.test.tsx`
- Modify: `docs/ui-kit.md`

**Interfaces:**

- Consumes: `Toggle labelDisplay="tooltip"` from Task 1.
- Produces: compact Settings controls without duplicate visible labels; standalone `entry-tree.tsx` remains on the default visible mode.

- [ ] **Step 1: Write failing consumer tests**

For Plugins list/detail and provider forms, assert that each Settings toggle still has its accessible checkbox name and exposes matching tooltip content while no duplicate visible label occupies the control column. Retain the existing assertion that toggling a plugin row does not open its detail page.

- [ ] **Step 2: Run the focused web tests and verify RED**

Run: `pnpm --filter @sovereign/web test`

Expected: new tooltip-mode expectations fail while existing behavior remains green.

- [ ] **Step 3: Opt Settings consumers into tooltip mode**

Pass `labelDisplay="tooltip"` to all eight Toggles rendered inside `SettingsRow`: five provider form switches, the Plugins list switch, the plugin master switch, and contribution switches. Do not change the standalone session-tree Toggle.

- [ ] **Step 4: Update public documentation and verify GREEN**

Update `docs/ui-kit.md` to describe the animated track/thumb, explicit label modes, reduced motion, and the rule that Settings rows use tooltip labels. Run focused UI Kit and web tests plus both typechecks.

### Task 3: Full verification and visual QA

**Files:**

- Verify only; modify the files above only if a demonstrated regression requires it.

**Interfaces:**

- Consumes: Tasks 1–2.
- Produces: reviewable, tested implementation and one atomic feature commit.

- [ ] **Step 1: Run repository verification**

Run: `make check && make build && git diff --check`.

- [ ] **Step 2: Inspect all live contexts**

Using the running `http://localhost:5274`, inspect Plugins list/detail and a provider form at wide and narrow viewport widths. Verify switch animation, tooltip on hover and keyboard focus, independent row click behavior, no horizontal overflow, focus ring, and disabled rendering. Inspect the session-tree Toggle to confirm its label remains visible.

- [ ] **Step 3: Request independent review**

Have a read-only reviewer check API compatibility, accessibility, tooltip behavior, motion reduction, all Settings consumers, tests, and documentation. Address every concrete finding and rerun affected checks.

- [ ] **Step 4: Commit**

Run:

```bash
git add packages/ui-kit apps/web/src docs/ui-kit.md docs/superpowers/plans/2026-08-07-animated-toggle.md
git commit -m "feat(ui-kit): replace checkbox toggle with switch"
```
