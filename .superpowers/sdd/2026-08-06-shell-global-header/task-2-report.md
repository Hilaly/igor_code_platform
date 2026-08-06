# Task 2 report

## Status

Implemented shell header registration and permanent central two-row layout.

## Changes

- Added `ShellHeaderDescription`, `ShellHeaderProvider`, `useShellHeader`, and an internal active-description reader.
- Added route-level `header` to `ShellProps`; `Shell` renders UI-kit `ViewHeader` in `.shell-header` and page content in `.shell-body`.
- Added layout and CSS contract coverage, including dynamic descendant registration/restoration and route rerender behavior.
- Added the minimal `App` header call site required by the now-required `ShellProps.header` contract.

## Verification

- `pnpm --filter @sovereign/web typecheck` — passed.
- `pnpm --filter @sovereign/web test -- src/shell/shell.test.tsx src/shell/styles.test.ts` — 45 files, 612 tests passed.
- `git diff --check` — passed.

## Concerns

The `App.tsx` call site is included because `header` is intentionally required by the shell contract; follow-up route migration should replace its placeholder title with route descriptions.
