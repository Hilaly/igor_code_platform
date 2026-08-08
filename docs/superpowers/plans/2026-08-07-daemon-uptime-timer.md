# Daemon Uptime Timer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the oversized daemon uptime phrase with a compact bold UI Kit digital timer that updates every second.

**Architecture:** UI Kit owns a pure `DurationTimer` presentation primitive and its duration decomposition; Web retains the daemon-specific `useUptimeSeconds` lifecycle and passes localized units plus the accessible duration label. Existing `SettingsRow`, health data, failure states, and routing remain unchanged.

**Tech Stack:** React 19, TypeScript, CSS Modules, Vitest, Testing Library, pnpm.

## Global Constraints

- Digits use Onest through `--sovereign-font-family-body`, `--sovereign-font-weight-bold`, `--sovereign-font-size-lg`, and `font-variant-numeric: tabular-nums`.
- The timer is flat: no card, background, shadow, border, or ornamental progress graphic.
- Hours, minutes, and seconds are two digits; days render only when non-zero.
- The visual value updates every 1,000 milliseconds and is not an ARIA live region.
- Loading, unreachable, connection, route, and protocol behavior do not change.
- No new dependency is added.

---

### Task 1: Add the UI Kit DurationTimer primitive

**Files:**

- Create: `packages/ui-kit/src/components/duration-timer.tsx`
- Create: `packages/ui-kit/src/components/duration-timer.module.css`
- Create: `packages/ui-kit/src/components/duration-timer.test.tsx`
- Modify: `packages/ui-kit/src/index.ts`
- Modify: `packages/ui-kit/src/components/primitives.stories.tsx`
- Modify: `packages/ui-kit/src/styles/styles.test.ts`
- Modify: `docs/ui-kit.md`

**Interfaces:**

- Consumes: `totalSeconds: number`, `labels: { days: string; hours: string; minutes: string; seconds: string }`, `accessibleLabel: string`.
- Produces: exported `DurationTimer` and `DurationTimerProps` from `@sovereign/ui-kit`.

- [ ] **Step 1: Write failing component and CSS-contract tests**

Add tests that render `3_661` seconds as `01 : 01 : 01`, omit the day group at zero days, render
`2` days for `176_461` seconds, expose `accessibleLabel` as the component name, and do not expose an
ARIA live attribute. Extend the style test to require body font, bold weight, `lg` size,
`tabular-nums`, and the absence of card decoration.

- [ ] **Step 2: Run the focused tests and verify RED**

Run:

```bash
pnpm --filter @sovereign/ui-kit test -- duration-timer.test.tsx styles.test.ts
```

Expected: FAIL because `DurationTimer` and its stylesheet do not exist.

- [ ] **Step 3: Implement the pure primitive**

Create a semantic named group whose digit groups are derived from clamped, floored seconds. Keep
separators `aria-hidden`, render the day group conditionally, pad clock groups to two digits, export
the component, and add representative no-day/day stories. Style it only with UI Kit tokens and
CSS Modules according to the global constraints.

- [ ] **Step 4: Document and verify the primitive**

Add `DurationTimer` to the public primitive list in `docs/ui-kit.md`. Run:

```bash
pnpm --filter @sovereign/ui-kit test
pnpm --filter @sovereign/ui-kit typecheck
pnpm exec prettier --check packages/ui-kit/src docs/ui-kit.md
git diff --check
```

Expected: all commands pass.

- [ ] **Step 5: Commit Task 1**

```bash
git add packages/ui-kit/src docs/ui-kit.md
git commit -m "feat(ui-kit): add duration timer"
```

### Task 2: Make Daemon uptime tick through DurationTimer

**Files:**

- Modify: `apps/web/src/uptime.ts`
- Modify: `apps/web/src/settings/daemon-section.tsx`
- Modify: `apps/web/src/settings/system-sections.test.tsx`
- Modify: `packages/ui-kit/src/i18n/messages/en.ts`
- Modify: `packages/ui-kit/src/i18n/messages/ru.ts`
- Modify: `docs/ui-kit.md`

**Interfaces:**

- Consumes: `DurationTimer`, `DurationTimerProps`, existing `Health.startedAt`, and scoped translator.
- Produces: daemon uptime that advances once per second while health is available.

- [ ] **Step 1: Write the failing ticking integration test**

Change the daemon section expectation from `up 30m 0s` to clock groups, then advance fake timers by
1,000 ms and assert `00 : 30 : 01`. Add an unmount assertion proving no interval remains. Preserve
existing connection, started-at, loading, and failure assertions.

- [ ] **Step 2: Run the focused Web test and verify RED**

Run:

```bash
pnpm --filter @sovereign/web test -- src/settings/system-sections.test.tsx
```

Expected: FAIL because the page still renders text and the hook ticks every ten seconds.

- [ ] **Step 3: Adopt the timer and one-second lifecycle**

Set `tickMilliseconds` to `1_000`. Render `DurationTimer` only when health is usable and no failure
exists; pass localized short unit labels plus the existing full `daemon.uptime` string as
`accessibleLabel`. Keep the start timestamp in the left description and keep loading/error text in
the right value column.

- [ ] **Step 4: Verify Web integration**

Run:

```bash
pnpm --filter @sovereign/web test -- src/settings/system-sections.test.tsx
pnpm --filter @sovereign/web typecheck
pnpm --filter @sovereign/ui-kit typecheck
pnpm exec prettier --check apps/web/src/uptime.ts apps/web/src/settings packages/ui-kit/src/i18n docs/ui-kit.md
git diff --check
```

Expected: all commands pass.

- [ ] **Step 5: Commit Task 2**

```bash
git add apps/web/src packages/ui-kit/src/i18n docs/ui-kit.md
git commit -m "feat(settings): tick daemon uptime timer"
```

### Task 3: Full verification and live browser QA

**Files:**

- Modify only if verification uncovers a scoped defect.

**Interfaces:**

- Consumes: completed UI Kit timer and Daemon integration.
- Produces: verified branch and visual evidence on the running local front end.

- [ ] **Step 1: Run repository verification**

Run:

```bash
make check
make build
git diff --check
```

Expected: all commands pass without new warnings.

- [ ] **Step 2: Verify the live Daemon page**

On `http://localhost:5274/settings/daemon`, verify that digits visibly advance each second, retain
stable width, use compact bold Onest, show the start date on the left, remain flat without a card,
and do not overflow at wide and narrow widths. Confirm loading/unreachable rendering through tests if
those states cannot be reached safely in the live daemon.

- [ ] **Step 3: Review the full branch diff**

Have a read-only reviewer check public API, duration math, interval cleanup, localization,
accessibility, responsive layout, tests, and documentation. Fix every concrete finding and rerun
affected checks.
