# Task 3 report — Project/session lifecycle and startup ordering

## RED

Command:

```text
pnpm --filter @sovereign/daemon test -- --test-name-pattern='refuses removal while sessions|hides sessions of archived'
```

Result before implementation: 453 passed, 2 failed. `DELETE /api/projects/:id` returned 200 instead of 409 for a project with sessions; archived project's session remained visible in list/entries/prompt.

## GREEN

Focused command after implementation:

```text
pnpm --filter @sovereign/daemon test -- --test-name-pattern='refuses removal while sessions|hides sessions of archived'
```

Result: 455 passed, 0 failed.

Full daemon suite:

```text
pnpm --filter @sovereign/daemon test
```

Result: 455 passed, 0 failed.

Typecheck:

```text
pnpm --filter @sovereign/daemon typecheck
```

Result: passed.

Formatting was applied to changed tests with `pnpm exec prettier --write ...`; focused Prettier check passed after formatting.

## Files

- `apps/daemon/src/projects.ts`: DELETE now checks current project and session count before calling the store; returns 409 for non-empty projects without mutation.
- `apps/daemon/src/projects.test.ts`: regression test proves refusal and project remains present.
- `apps/daemon/src/sessions.ts`: list, entries and prompt gate on current project existence and archive state.
- `apps/daemon/src/sessions.test.ts`: archive hides sessions from list/entries/prompt and restore reveals them.
- `apps/daemon/src/main.ts`: `applyPlugins` returns its serialized promise; initial plugin application and session refresh are awaited before server listen.

## Design notes

- Project DELETE uses safe refusal (409) because individual session deletion is deferred; no cascade API exists.
- Visibility is evaluated against the current project store on each operation, preserving restored sessions and allowing ephemeral `work` project.
- Existing watcher callbacks continue to call `applyPlugins`; only initial startup now awaits readiness.

## Self-review / concerns

- No startup-specific test was extracted; startup ordering is enforced by awaiting the existing serialized application promise and refresh directly before route/server setup.
- Runtime diagnostics and documentation outside this slice were intentionally untouched.
