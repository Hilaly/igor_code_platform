# Immediate Daemon Settings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply every existing single Daemon configuration control without a shared Save button while preserving independent updates and current error semantics.

**Architecture:** `PUT /api/config` accepts a nonempty partial configuration document and returns the complete applied snapshot. The daemon merges the patch with the current on-disk document. The web controller sends one-key patches; `ConfigForm` commits discrete selection changes at once and valid numeric text on Enter or blur.

**Tech Stack:** TypeScript, Node.js built-in test runner, React 19, Vitest, existing HTTP dispatcher and settings store.

## Global Constraints

- Work only on the existing Daemon configuration controls; Provider create/edit forms remain submit-based entity operations.
- `PUT /api/config` accepts a nonempty subset of known `Config` keys and still accepts the former complete document.
- Unknown fields stored in `config.json` and values of untouched fields must survive a patch.
- Select changes apply immediately; numerical text commits on Enter or blur only after local finite-number validation.
- A failed request keeps the typed text visible, surfaces the daemon reason, and reloads the authoritative snapshot.
- Code identifiers and commit subjects are English; all documentation remains Russian.
- Each implementation task follows RED → GREEN → refactor and ends with a working atomic Conventional Commit.

---

### Task 1: Partial configuration contract in protocol and daemon

**Files:**

- Modify: `packages/protocol/src/settings.ts`
- Modify: `packages/protocol/src/settings.test.ts`
- Modify: `apps/daemon/src/settings/config-api.ts`
- Modify: `apps/daemon/src/settings/config-api.test.ts`
- Modify: `apps/daemon/src/settings/settings.ts`
- Modify: `apps/daemon/src/settings/settings.test.ts`
- Modify: `docs/web-api.md`
- Modify: `docs/data-directory.md`

**Interfaces:**

- Consumes: `parseConfig`, `configKeys`, `SettingsStore.writeConfig`, and `PUT /api/config`.
- Produces: `parseConfigUpdate(value: unknown): SettingsParseResult<Record<string, unknown>>` accepting a nonempty partial object; `SettingsStore.writeConfig(update)` applying only supplied fields; a `PUT` response containing the complete `Config` snapshot.

- [ ] **Step 1: Write failing protocol and API tests**

Add focused cases that state the new public contract:

```ts
it("accepts one known configuration key", () => {
  assert.deepEqual(parseConfigUpdate({ maxConcurrentTurns: 8 }), {
    kind: "parsed",
    value: { maxConcurrentTurns: 8 },
    diagnostics: [],
  });
});

it("writes a partial config without replacing its neighbors", async () => {
  const answer = await put({ maxConcurrentTurns: 8 });
  assert.equal(answer.status, 200);
  assert.deepEqual(JSON.parse(answer.body), { ...defaultConfig, maxConcurrentTurns: 8 });
});
```

Also cover an empty body, an invalid supplied value, a complete legacy body, unknown fields in an
incoming body, an unknown field already on disk, and two different partial writes that preserve both
changes.

- [ ] **Step 2: Run the new tests to verify they fail**

Run:

```bash
pnpm --filter @sovereign/protocol test -- src/settings.test.ts
pnpm --filter @sovereign/daemon test -- src/settings/config-api.test.ts src/settings/settings.test.ts
```

Expected: the partial-body tests fail because a missing known key is currently reported as required.

- [ ] **Step 3: Implement the minimal partial-update path**

Keep complete parsing unchanged. Make the update parser iterate only over present keys, reject an
empty object, validate each supplied known key using the same key-specific rules, and preserve
forward-compatible unknown input fields. Route the parsed update to the existing read-modify-write
store path:

```ts
writeConfig: (update) =>
  patchFile(configFileName, parseConfig, (document) => ({ ...document, ...update }));
```

The API must return `settings.current().config` after a written outcome, as it did for a complete
document. Do not add a route or HTTP method.

- [ ] **Step 4: Run focused tests to verify they pass**

Run the commands from Step 2. Expected: all protocol and daemon tests pass, including retained
`400`, `409`, and `500` cases.

- [ ] **Step 5: Update contract documentation**

Rewrite the config sections in `docs/web-api.md` and `docs/data-directory.md` to say that `PUT`
accepts a nonempty subset, merges it with the latest document, preserves unknown keys, returns the
full applied snapshot, and retains last-rename-wins for an external manual editor. Replace the former
justification for a full body with the accepted partial-update rationale from the approved design.

- [ ] **Step 6: Commit the backend slice**

```bash
git add packages/protocol/src/settings.ts packages/protocol/src/settings.test.ts \
  apps/daemon/src/settings/config-api.ts apps/daemon/src/settings/config-api.test.ts \
  apps/daemon/src/settings/settings.ts apps/daemon/src/settings/settings.test.ts \
  docs/web-api.md docs/data-directory.md
git commit -m "feat(settings): accept partial daemon config updates"
```

### Task 2: Immediate Daemon configuration controls

**Files:**

- Modify: `apps/web/src/settings/config-api.ts`
- Modify: `apps/web/src/settings/use-config.ts`
- Modify: `apps/web/src/settings/use-config.test.tsx`
- Modify: `apps/web/src/settings/config-form.tsx`
- Modify: `apps/web/src/settings/config-form.test.tsx`
- Modify: `apps/web/src/settings/config-draft.ts`
- Modify: `apps/web/src/settings/config-draft.test.ts`
- Modify: `apps/web/src/settings/daemon-section.tsx`
- Modify: `apps/web/src/settings/system-sections.test.tsx`
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/App.test.tsx`
- Modify: `docs/ui-kit.md`

**Interfaces:**

- Consumes: Task 1's partial `PUT /api/config` and full response.
- Produces: `ConfigController.update(key: keyof Config, value: Config[keyof Config]): void`; `ConfigForm` callback `onChange(key, value)` with no shared Save operation.

- [ ] **Step 1: Write failing controller and component tests**

Replace Save-button expectations with per-control behavior:

```tsx
fireEvent.change(field("Вызовов публичного маршрута в минуту"), { target: { value: "3" } });
fireEvent.blur(field("Вызовов публичного маршрута в минуту"));
expect(onChange).toHaveBeenCalledWith("publicRouteRequestsPerMinute", 3);

fireEvent.change(screen.getByRole("combobox", { name: "Уровень журнала" }), {
  target: { value: "warn" },
});
expect(onChange).toHaveBeenCalledWith("logLevel", "warn");
expect(screen.queryByRole("button", { name: "Сохранить" })).toBeNull();
```

Add tests that an invalid/empty numeric string is marked invalid and does not invoke `onChange`,
Enter commits a valid numeric value, the controller serializes exactly `{ maxConcurrentTurns: 8 }`,
late responses cannot replace the last result, and refusal reloads the authoritative snapshot.

- [ ] **Step 2: Run the new tests to verify they fail**

Run:

```bash
pnpm --filter @sovereign/web test -- src/settings/config-form.test.tsx src/settings/use-config.test.tsx src/settings/config-draft.test.ts src/settings/system-sections.test.tsx src/App.test.tsx
```

Expected: tests fail because `ConfigForm` retains the Save button and `useConfig` has only a
complete-document `save` operation.

- [ ] **Step 3: Implement per-key client updates**

Change the API client to send `Partial<Config>`. Replace `save(config)` in `useConfig` with an
`update(key, value)` function that writes `{ [key]: value }`, keeps `writeSeq` protection and, on a
failure, records the daemon reason then reloads. Update its callers through `DaemonSection` and
`App`.

Simplify `ConfigForm` to individual field text state. A select calls `onChange` immediately. A
numeric field parses and calls `onChange` only from `onBlur` or Enter; it retains invalid text and
uses `aria-invalid`. Remove collision controls and the form-wide Save area because no unsaved
multi-field draft remains.

- [ ] **Step 4: Run focused tests to verify they pass**

Run the command from Step 2. Expected: all affected web tests pass and assert no Save control is
rendered.

- [ ] **Step 5: Update UI documentation**

Replace the section in `docs/ui-kit.md` that describes the config-wide draft, collision notice, and
Save button with the per-control commit rule, local numeric validation, partial update behaviour,
response ordering, and refusal/reload behaviour.

- [ ] **Step 6: Commit the web slice**

```bash
git add apps/web/src/settings/config-api.ts apps/web/src/settings/use-config.ts \
  apps/web/src/settings/use-config.test.tsx apps/web/src/settings/config-form.tsx \
  apps/web/src/settings/config-form.test.tsx apps/web/src/settings/config-draft.ts \
  apps/web/src/settings/config-draft.test.ts apps/web/src/settings/daemon-section.tsx \
  apps/web/src/settings/system-sections.test.tsx apps/web/src/App.tsx apps/web/src/App.test.tsx \
  docs/ui-kit.md
git commit -m "feat(settings): apply daemon controls immediately"
```

### Task 3: Whole-branch verification

**Files:**

- Verify only; do not create a source-only commit.

**Interfaces:**

- Consumes: complete Tasks 1 and 2.
- Produces: current evidence that the public config contract, UI behavior, formatting, types, linting, tests, and web build are green.

- [ ] **Step 1: Run focused behavioural tests**

```bash
pnpm --filter @sovereign/protocol test -- src/settings.test.ts
pnpm --filter @sovereign/daemon test -- src/settings/config-api.test.ts src/settings/settings.test.ts
pnpm --filter @sovereign/web test -- src/settings/config-form.test.tsx src/settings/use-config.test.tsx
```

Expected: all targeted tests pass.

- [ ] **Step 2: Run repository checks**

```bash
make check
```

Expected: formatter check, lint, typecheck, all tests, and web build succeed.

- [ ] **Step 3: Inspect the committed branch**

```bash
git status --short
git log --oneline main..HEAD
```

Expected: no uncommitted files; the branch contains the design, plan, backend, and web commits.

- [ ] **Step 4: Request independent review**

Give a dedicated reviewer the branch diff from `main` and the approved design. Any Critical or
Important finding must be fixed, regression-tested, and re-reviewed before handoff.

## Plan self-review

- Spec coverage: Task 1 covers the compatible partial API and on-disk merge; Task 2 covers each UI
  commit boundary and failure path; Task 3 covers repository-wide verification and independent
  review.
- Placeholder scan: no deferred implementation placeholders are present.
- Type consistency: the daemon response remains `Config`; the web's `update(key, value)` callback
  consumes `keyof Config` and a matching value and serializes a `Partial<Config>`.
