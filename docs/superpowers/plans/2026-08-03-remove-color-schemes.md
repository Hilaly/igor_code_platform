# Color Scheme Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove obsolete built-in color schemes and make `imperium` the sole default and fallback scheme.

**Architecture:** Keep scheme ownership in UI Kit's `shippedSchemes`; remove obsolete scheme modules and exports, then update protocol defaults and web fallback to import `imperiumScheme`. Keep plugin-provided schemes and the existing token contract unchanged.

**Tech Stack:** TypeScript, React, Vitest, pnpm workspaces, Markdown documentation.

## Global Constraints

- Keep scheme identifier `imperium`; do not rename it.
- Remove `base`, `neutral`, `obsidian`, `terminal`, and `check` from the built-in package and UI choice list.
- Keep `imperium`, `nord`, `oled`, and `sage` in `shippedSchemes`, with `imperium` first.
- Set protocol default and built-in fallback to `imperium`.
- Do not add migration or compatibility aliases for removed identifiers.
- Do not change palette/token contracts or the color values of retained schemes.

---

### Task 1: Change protocol default to Imperium

**Files:**
- Modify: `packages/protocol/src/settings.ts`
- Test: `packages/protocol/src/settings.test.ts`
- Modify: `apps/daemon/src/settings/appearance-preferences.test.ts`

**Interfaces:**
- Produces `builtInColorScheme === "imperium"` and `defaultAppearance.colorScheme === "imperium"` for all consumers.

- [ ] **Step 1: Write the failing test**

Change the existing empty-preferences and missing-fields assertions from `base` to `imperium`, and add:

```ts
it("uses Imperium as the built-in appearance", () => {
  assert.equal(builtInColorScheme, "imperium");
  assert.equal(defaultPreferences.appearance.colorScheme, "imperium");
});
```

Update daemon appearance fixture expectations that represent defaults from `base` to `imperium`.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @sovereign/protocol test -- settings.test.ts`

Expected: FAIL because the current built-in identifier is `base`.

- [ ] **Step 3: Write minimal implementation**

In `packages/protocol/src/settings.ts`, change only the built-in identifier:

```ts
export const builtInColorScheme = "imperium";
```

Keep the exported name for the local constant to avoid an unrelated public API rename; update its comment to describe Imperium as the built-in scheme.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @sovereign/protocol test -- settings.test.ts && pnpm --filter @sovereign/daemon test -- appearance-preferences.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/protocol/src/settings.ts packages/protocol/src/settings.test.ts apps/daemon/src/settings/appearance-preferences.test.ts
git commit -m "refactor(protocol): default appearance to imperium"
```

### Task 2: Reduce UI Kit shipped schemes and translations

**Files:**
- Modify: `packages/ui-kit/src/tokens/schemes/shipped.ts`
- Delete: `packages/ui-kit/src/tokens/schemes/base.ts`
- Delete: `packages/ui-kit/src/tokens/schemes/neutral.ts`
- Delete: `packages/ui-kit/src/tokens/schemes/obsidian.ts`
- Delete: `packages/ui-kit/src/tokens/schemes/terminal.ts`
- Delete: `packages/ui-kit/src/tokens/schemes/check.ts`
- Modify: `packages/ui-kit/src/index.ts`
- Modify: `packages/ui-kit/src/i18n/messages/en.ts`
- Modify: `packages/ui-kit/src/i18n/messages/ru.ts`
- Modify: `packages/ui-kit/src/tokens/tokens.test.ts`
- Modify: `packages/ui-kit/src/components/primitives.stories.tsx`

**Interfaces:**
- `shippedSchemes` produces exactly `imperium`, `nord`, `oled`, `sage`, in that order.
- `@sovereign/ui-kit` no longer exports deleted scheme modules.

- [ ] **Step 1: Write the failing test**

In `packages/ui-kit/src/tokens/tokens.test.ts`, add:

```ts
it("ships only the retained schemes", () => {
  expect(shippedSchemes.map((scheme) => scheme.id)).toEqual(["imperium", "nord", "oled", "sage"]);
});
```

Run the test and confirm it fails because the current list contains nine schemes.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @sovereign/ui-kit test -- tokens.test.ts`

Expected: FAIL with the actual nine-scheme list.

- [ ] **Step 3: Write minimal implementation**

Make `shipped.ts` import and list only `imperiumScheme`, `nordScheme`, `oledScheme`, and `sageScheme`. Delete the five obsolete modules, remove their exports from `index.ts`, remove their English/Russian catalog entries, and update the story's hard-coded scheme option to `imperium`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @sovereign/ui-kit test`

Expected: all UI Kit tests pass, including i18n coverage over the reduced list.

- [ ] **Step 5: Commit**

```bash
git add packages/ui-kit
git commit -m "refactor(ui-kit): remove obsolete color schemes"
```

### Task 3: Use Imperium as web fallback and update documentation

**Files:**
- Modify: `apps/web/src/appearance.ts`
- Modify: `apps/web/src/appearance.test.ts`
- Modify: `docs/data-directory.md`
- Modify: `docs/ui-kit.md`
- Modify: `docs/master-spec.md`
- Modify: `docs/roadmap.md`
- Modify: `docs/runbook.md`
- Modify: `docs/backlog.md`

**Interfaces:**
- `applyAppearance` uses `imperiumScheme` when a requested scheme is absent or rejected.
- Documentation describes four shipped schemes and Imperium as the built-in default.

- [ ] **Step 1: Write the failing test**

In `apps/web/src/appearance.test.ts`, change fallback assertions to `imperiumScheme` and add a test that an unknown scheme applies `imperium`'s dark surface. The test must fail against the current `baseScheme` fallback after Task 2 removes that module.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @sovereign/web test -- appearance.test.ts`

Expected: FAIL because web imports/fallback still reference `baseScheme`.

- [ ] **Step 3: Write minimal implementation**

Import `imperiumScheme` from `@sovereign/ui-kit`, use it for missing/rejected scheme fallback, and update test fixtures. Rewrite documentation sections that enumerate schemes or show `base` defaults; remove claims that `base` is always shipped and that nine schemes exist. Record the compatibility decision in the relevant `Почему так` section.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @sovereign/web test -- appearance.test.ts && pnpm --filter @sovereign/daemon test -- appearance-preferences.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/appearance.ts apps/web/src/appearance.test.ts docs
git commit -m "refactor(web): use imperium appearance fallback"
```

### Task 4: Full verification

**Files:**
- Verify only; no source changes expected.

- [ ] **Step 1: Run focused tests**

Run: `pnpm --filter @sovereign/protocol test && pnpm --filter @sovereign/ui-kit test && pnpm --filter @sovereign/web test`

Expected: all tests pass.

- [ ] **Step 2: Run repository checks**

Run: `pnpm -r typecheck && pnpm eslint . && pnpm prettier --check . && pnpm --filter @sovereign/web build && git diff --check`

Expected: typecheck, lint, formatting, build, and whitespace checks exit 0. Existing non-blocking lint warnings may remain, but no new errors are allowed.

- [ ] **Step 3: Confirm removed identifiers are gone**

Run:

```bash
rg -n 'baseScheme|neutralScheme|obsidianScheme|terminalScheme|checkScheme|appearance\.scheme\.(base|neutral|obsidian|terminal|check)|colorScheme: "base"' packages apps docs --glob '!**/dist/**'
```

Expected: no matches outside the design/plan history describing the deliberate removal.

- [ ] **Step 4: Commit verification notes if needed**

If documentation or test adjustments are required by the checks, include them in the preceding atomic task commit; do not create a formatting-only commit.
