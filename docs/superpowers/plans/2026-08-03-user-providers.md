# User Providers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add persistent user-created LLM providers with four request protocols, editable model discovery, manual models, credential reuse, and create/edit/delete UI.

**Architecture:** Protocol owns validated wire data; the daemon providers area owns the persistent store, orchestration, and HTTP routes; `agent-runtime-pi` alone builds Pi providers and fetches remote model catalogs. Web views remain fetch-free and receive state/actions from the providers controller. All providers share the existing runtime catalogue, credential store, model cache, and change event.

**Tech Stack:** Node.js 24, TypeScript, pnpm workspaces, Node test runner, Vitest/React Testing Library, React, `@sovereign/ui-kit`, Pi AI.

## Global Constraints

- Work only in `/Users/user/repos/sovereign_platform_node/.worktrees/user-providers` on `feat/user-providers`.
- Use Node 24.18.0 through `PATH=/Users/user/.nvm/versions/node/v24.18.0/bin:$PATH`.
- No new dependency and no import of `@earendil-works/pi-ai` outside `packages/agent-runtime-pi`.
- Supported APIs are exactly `openai-completions`, `openai-responses`, `anthropic-messages`, and `google-generative-ai`.
- Default discovered model values are context `128000`, max output `8192`, text-only, reasoning off, and zero prices.
- Secrets remain only in `credentials.json`; never put an API key in definitions, HTTP responses, logs, or model-catalog URLs.
- Every behavior change follows red-green-refactor and each task ends in an atomic Conventional Commit.

---

## File Map

- `packages/protocol/src/provider.ts`: wire types, paths, defaults, parsers, and source discriminator.
- `packages/protocol/src/provider.test.ts`: contract paths/default URL/validation tests.
- `packages/agent-runtime-pi/src/custom-provider.ts`: shared runtime provider builder and model overlay.
- `packages/agent-runtime-pi/src/user-model-catalog.ts`: protocol-specific HTTP catalog adapters.
- `packages/agent-runtime-pi/src/catalogue.ts`: source-aware registration and provider-scoped refresh.
- `apps/daemon/src/providers/user-provider-store.ts`: atomic `user-providers.json` owner.
- `apps/daemon/src/providers/user-providers.ts`: lifecycle orchestration and narrow dependency ports.
- `apps/daemon/src/providers/user-provider-routes.ts`: CRUD and scoped refresh HTTP routes.
- `apps/daemon/src/providers/public.ts`, `apps/daemon/src/main.ts`: composition only.
- `apps/web/src/providers/api.ts`: user-provider fetch functions.
- `apps/web/src/providers/user-provider-state.ts`: reducer/controller-independent state transitions.
- `apps/web/src/providers/use-providers.ts`: network orchestration and automatic refresh after login.
- `apps/web/src/providers/user-provider-form-view.tsx`: pure create/edit form.
- `apps/web/src/providers/providers-view.tsx`: list/detail composition and user-only actions.
- `apps/web/src/router.ts`, `apps/web/src/App.tsx`: addressable create/edit screens.
- `docs/models-and-providers.md`, `docs/data-directory.md`, `docs/web-api.md`, `docs/ui-kit.md`: current contract and rationale.

### Task 1: User-provider wire contract

**Files:**

- Modify: `packages/protocol/src/provider.ts`
- Modify: `packages/protocol/src/provider.test.ts`
- Modify: `packages/protocol/src/index.ts`

**Interfaces:**

- Produces: `ProviderOrigin`, `UserProviderDefinition`, `UserProviderDraft`, `UserProviderDetails`, `UserProviderRefreshOutcome`, `parseUserProviderDraft(raw)`, `defaultModelsUrl(api, baseUrl)`, and `userProvider*Path` constants/helpers.
- Preserves: `CustomProviderDefinition` and the existing plugin SDK contract.

- [ ] **Step 1: Write failing path, URL, and parser tests**

```ts
it("builds user provider paths without confusing ids with route segments", () => {
  assert.equal(userProvidersPath, "/api/user-providers");
  assert.equal(userProviderPath("a/b"), "/api/user-providers/a%2Fb");
  assert.equal(userProviderRefreshPath("local"), "/api/user-providers/local/models/refresh");
});

it("derives the model endpoint from the selected API", () => {
  assert.equal(
    defaultModelsUrl("openai-responses", "http://localhost:11434/v1"),
    "http://localhost:11434/v1/models",
  );
  assert.equal(
    defaultModelsUrl("anthropic-messages", "https://vendor.test"),
    "https://vendor.test/v1/models",
  );
  assert.equal(
    defaultModelsUrl("google-generative-ai", "https://vendor.test/v1beta"),
    "https://vendor.test/v1beta/models",
  );
});

it("parses a complete definition and fills agreed model defaults", () => {
  const parsed = parseUserProviderDraft({
    id: "vendor-local",
    name: "Vendor Local",
    baseUrl: "http://127.0.0.1:11434/v1",
    api: "openai-responses",
    modelsEndpoint: { kind: "default" },
    manualModels: [],
    modelOverrides: {},
    disabledModelIds: [],
  });
  assert.equal(parsed.kind, "parsed");
  if (parsed.kind === "parsed")
    assert.deepEqual(parsed.value.modelDefaults, defaultUserModelDefinition);
});
```

- [ ] **Step 2: Run the protocol test and verify RED**

Run: `pnpm --filter @sovereign/protocol test -- src/provider.test.ts`

Expected: compile failures naming missing exports.

- [ ] **Step 3: Implement paths, types, defaults, URL calculation, and total parser**

Use discriminated endpoint data:

```ts
export type UserProviderModelsEndpoint =
  { kind: "default" } | { kind: "custom"; url: string } | { kind: "disabled" };

export type UserProviderDraft = {
  id: string;
  name: string;
  baseUrl: string;
  api: CustomProviderApi;
  modelsEndpoint: UserProviderModelsEndpoint;
  modelDefaults: Omit<CustomModelDefinition, "id" | "name">;
  manualModels: CustomModelDefinition[];
  modelOverrides: Record<string, Partial<Omit<CustomModelDefinition, "id">>>;
  disabledModelIds: string[];
};
```

Reject credentials/fragments in URLs, duplicates, invalid ids/numbers/input kinds, and unknown keys only as diagnostics following neighboring parsers.

- [ ] **Step 4: Run protocol tests and typecheck GREEN**

Run: `pnpm --filter @sovereign/protocol test && pnpm --filter @sovereign/protocol typecheck`

Expected: all protocol tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/protocol/src/provider.ts packages/protocol/src/provider.test.ts packages/protocol/src/index.ts
git commit -m "feat(protocol): define persistent user providers"
```

### Task 2: Source-aware runtime catalogue and remote model discovery

**Files:**

- Create: `packages/agent-runtime-pi/src/user-model-catalog.ts`
- Create: `packages/agent-runtime-pi/src/user-model-catalog.test.ts`
- Modify: `packages/agent-runtime-pi/src/custom-provider.ts`
- Modify: `packages/agent-runtime-pi/src/catalogue.ts`
- Modify: `packages/agent-runtime-pi/src/catalogue.test.ts`
- Modify: `packages/agent-runtime-pi/src/index.ts`

**Interfaces:**

- Consumes: validated `UserProviderDefinition`, `ProviderOrigin`, and `defaultModelsUrl`.
- Produces: `setCustomProvider(definition, origin)`, `replaceCustomProvider`, `refreshProvider(providerId)`, `removeCustomProvider`, and `toRuntimeUserProvider(definition)`.
- `refreshProvider` returns the existing `RefreshOutcome` shape and never exposes credential values.

- [ ] **Step 1: Write RED tests for origin and scoped refresh**

```ts
it("keeps builtin, plugin, and user origins distinct", async () => {
  const one = catalogue();
  assert.deepEqual(one.setCustomProvider(vendor, "user"), { kind: "registered" });
  const saved = (await one.snapshot()).providers.find((provider) => provider.id === vendor.id);
  assert.equal(saved?.origin, "user");
  assert.equal(saved?.custom, false);
});

it("refreshes only the named dynamic provider", async () => {
  const outcome = await one.refreshProvider("vendor-local");
  assert.deepEqual(outcome, { providerId: "vendor-local", modelCount: 2 });
  assert.deepEqual(touched, ["vendor-local"]);
});
```

- [ ] **Step 2: Run runtime tests and verify RED**

Run: `pnpm --filter @sovereign/agent-runtime-pi test -- src/catalogue.test.ts`

Expected: missing origin and `refreshProvider` failures.

- [ ] **Step 3: Implement exact-source bookkeeping and provider-scoped refresh**

Change the custom set to `Map<string, "plugin" | "user">`; preserve `custom: true` only for plugin-origin summaries. Provider-scoped refresh must use Pi-owned credentials and provider-scoped models store within this package, with the same cache restore/error semantics as collection refresh.

- [ ] **Step 4: Write RED HTTP adapter tests using a local server**

Cover these concrete requests/responses:

```ts
await withCatalogServer(({ url, requests }) => {
  // OpenAI: { data: [{ id: "alpha" }], has_more: false }
  // Anthropic: { data: [{ id: "claude" }], has_more: false }
  // Google: { models: [{ name: "models/gemini" }], nextPageToken: undefined }
  // Assert bearer/x-api-key/x-goog-api-key and anthropic-version headers.
});
```

Also cover pagination, duplicate ids, malformed envelope, body limit, timeout/abort, cache restoration, defaults, overrides, disabled ids, and manual model precedence.

- [ ] **Step 5: Run adapter tests and verify RED**

Run: `pnpm --filter @sovereign/agent-runtime-pi test -- src/user-model-catalog.test.ts`

Expected: missing module/export.

- [ ] **Step 6: Implement the four catalog adapters and runtime user-provider builder**

Use `createProvider({ models: manual, fetchModels, api, auth })`. Build model fields through one pure `mergeDiscoveredModels(definition, ids)` helper. Fetch with a bounded timer and byte-counted response reader; never include response bodies or keys in thrown messages.

- [ ] **Step 7: Run runtime package GREEN**

Run: `pnpm --filter @sovereign/agent-runtime-pi test && pnpm --filter @sovereign/agent-runtime-pi typecheck`

- [ ] **Step 8: Commit**

```bash
git add packages/agent-runtime-pi/src
git commit -m "feat(runtime): discover user provider models"
```

### Task 3: Persistent user-provider store

**Files:**

- Create: `apps/daemon/src/providers/user-provider-store.ts`
- Create: `apps/daemon/src/providers/user-provider-store.test.ts`
- Modify: `apps/daemon/src/providers/public.ts`

**Interfaces:**

- Consumes: parsed `UserProviderDefinition` values.
- Produces: `createUserProviderStore({ directory, logger })` with `list`, `find`, `create`, `replace`, `remove`, and `problem`.
- Owns: `user-providers.json` only.

- [ ] **Step 1: Write RED store tests**

```ts
it("keeps definitions across restart and writes owner-only", () => {
  const one = createUserProviderStore(options());
  assert.deepEqual(one.create(definition), { kind: "created", definition });
  assert.deepEqual(createUserProviderStore(options()).list(), [definition]);
  assert.equal(statSync(fileAt(directory)).mode & 0o777, 0o600);
});

it("refuses to overwrite an unreadable registry", () => {
  writeFileSync(fileAt(directory), "not json");
  const one = createUserProviderStore(options());
  assert.equal(one.create(definition).kind, "refused");
  assert.equal(readFileSync(fileAt(directory), "utf8"), "not json");
});
```

- [ ] **Step 2: Run daemon store test and verify RED**

Run: `pnpm --filter @sovereign/daemon test -- src/providers/user-provider-store.test.ts`

- [ ] **Step 3: Implement the atomic store following `project-store.ts` style**

Parse every stored definition through the protocol parser. Treat any invalid entry as a whole-file refusal. Write `{ "providers": [...] }` with `writeFileAtomically` and announce only after persistence succeeds.

- [ ] **Step 4: Run store tests GREEN**

Run: `pnpm --filter @sovereign/daemon test -- src/providers/user-provider-store.test.ts`

- [ ] **Step 5: Commit**

```bash
git add apps/daemon/src/providers/user-provider-store.ts apps/daemon/src/providers/user-provider-store.test.ts apps/daemon/src/providers/public.ts
git commit -m "feat(providers): persist user provider definitions"
```

### Task 4: User-provider lifecycle service and HTTP API

**Files:**

- Create: `apps/daemon/src/providers/user-providers.ts`
- Create: `apps/daemon/src/providers/user-providers.test.ts`
- Create: `apps/daemon/src/providers/user-provider-routes.ts`
- Create: `apps/daemon/src/providers/user-provider-routes.test.ts`
- Modify: `apps/daemon/src/providers/public.ts`
- Modify: `apps/daemon/src/providers/provider-login-routes.ts`
- Modify: `apps/daemon/src/providers/provider-login-routes.test.ts`
- Modify: `apps/daemon/src/main.ts`

**Interfaces:**

- Consumes narrow ports: provider catalogue, store, `CredentialStore.remove`, `ModelCatalogStore.remove`, `ProviderLogins`, event bus, and `hasActiveSession(providerId)` injected by `main.ts`.
- Produces `UserProviderService` CRUD, `refresh`, `details`, and `onLoginSucceeded(providerId)`.
- Routes return 400/404/409 according to the spec and `RefreshOutcome` with optional error at 200.

- [ ] **Step 1: Write RED service tests for create/restart/conflict/replace/delete**

```ts
it("rolls registration back when persistence fails", () => {
  const result = service({ store: refusingStore }).create(definition);
  assert.equal(result.kind, "refused");
  assert.equal(catalogue.modelsOf(definition.id), undefined);
});

it("refuses deletion during active use and otherwise clears secret and cache", async () => {
  assert.equal((await busy.remove(definition.id)).kind, "busy");
  assert.deepEqual(await idle.remove(definition.id), { kind: "removed" });
  assert.deepEqual(removed, ["credential:vendor-local", "catalog:vendor-local"]);
});
```

- [ ] **Step 2: Run service tests RED**

Run: `pnpm --filter @sovereign/daemon test -- src/providers/user-providers.test.ts`

- [ ] **Step 3: Implement serialized lifecycle orchestration**

Use one promise chain for mutations. Restore all saved definitions during construction, retain startup conflicts in details, and publish only committed changes. Re-register the old definition after a failed destructive step.

- [ ] **Step 4: Write and run RED route tests**

Exercise each route through the real daemon test dispatcher, including malformed bodies, immutable id, conflict, unknown provider, active-session deletion, and refresh failure as 200.

Run: `pnpm --filter @sovereign/daemon test -- src/providers/user-provider-routes.test.ts`

- [ ] **Step 5: Implement routes and wire composition root**

Derive active use from `sessions.list()` and `parseModelReference(session.model)` where `phase !== "idle"`. Add scoped refresh after successful user-provider login without changing the login result when refresh fails.

- [ ] **Step 6: Run provider daemon tests GREEN**

Run: `pnpm --filter @sovereign/daemon test -- src/providers/*.test.ts`

- [ ] **Step 7: Commit**

```bash
git add apps/daemon/src/providers apps/daemon/src/main.ts
git commit -m "feat(providers): manage persistent user providers"
```

### Task 5: Web API and user-provider state

**Files:**

- Modify: `apps/web/src/providers/api.ts`
- Modify: `apps/web/src/providers/api.test.ts`
- Create: `apps/web/src/providers/user-provider-state.ts`
- Create: `apps/web/src/providers/user-provider-state.test.ts`
- Modify: `apps/web/src/providers/use-providers.ts`
- Modify: `apps/web/src/providers/use-providers.test.tsx`

**Interfaces:**

- Consumes protocol paths and wire types.
- Produces fetch functions `fetchUserProviders`, `createUserProvider`, `updateUserProvider`, `deleteUserProvider`, `refreshUserProviderModels` and controller actions with pending/failure state.
- Preserves current provider/login state on unrelated CRUD failures.

- [ ] **Step 1: Write RED API tests**

Assert method, encoded path, JSON body, typed 409 reason, and 200 refresh error. Use existing fetch double style.

- [ ] **Step 2: Run API tests RED**

Run: `pnpm --filter @sovereign/web test -- src/providers/api.test.ts`

- [ ] **Step 3: Implement fetch functions and shared error decoding**

No component calls fetch directly. AbortSignal is accepted by list/detail reads and propagated.

- [ ] **Step 4: Write RED reducer/controller tests**

```ts
it("keeps form input after a failed save", () => {
  assert.deepEqual(applySaveFailed(editing(draft), "taken"), {
    ...editing(draft),
    pending: false,
    failure: "taken",
  });
});

it("refreshes a user provider after successful key login", async () => {
  await controller.logIn("vendor-local", "api_key");
  completeLogin("vendor-local", "succeeded");
  assert.deepEqual(refreshed, ["vendor-local"]);
});
```

- [ ] **Step 5: Implement state transitions and controller orchestration**

On provider change events reload both the common snapshot and user details. Automatic refresh only runs for `origin: "user"` and a successful login conclusion.

- [ ] **Step 6: Run web provider state/API tests GREEN**

Run: `pnpm --filter @sovereign/web test -- src/providers/api.test.ts src/providers/user-provider-state.test.ts src/providers/use-providers.test.tsx`

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/providers/api.ts apps/web/src/providers/api.test.ts apps/web/src/providers/user-provider-state.ts apps/web/src/providers/user-provider-state.test.ts apps/web/src/providers/use-providers.ts apps/web/src/providers/use-providers.test.tsx
git commit -m "feat(web): control user provider state"
```

### Task 6: Addressable create/edit form

**Files:**

- Create: `apps/web/src/providers/user-provider-form-view.tsx`
- Create: `apps/web/src/providers/user-provider-form-view.test.tsx`
- Modify: `apps/web/src/providers/providers.css`
- Modify: `apps/web/src/router.ts`
- Modify: `apps/web/src/router.test.ts`
- Modify: `apps/web/src/router-navigation.test.ts`
- Modify: `apps/web/src/App.tsx`
- Modify: UI translation resources under `packages/ui-kit/src/i18n`

**Interfaces:**

- Consumes `UserProviderDraft`, existing UI kit fields/buttons/notices, and controlled callbacks.
- Produces pure `UserProviderFormView` and new page variants for create/edit.
- `id` is editable only in create mode; all values remain controlled by parent state.

- [ ] **Step 1: Write RED router tests**

```ts
assert.deepEqual(matchPage("/settings/providers/new"), { kind: "new-provider" });
assert.deepEqual(matchPage("/settings/providers/vendor/edit"), {
  kind: "edit-provider",
  providerId: "vendor",
});
assert.equal(pathOf({ kind: "new-provider" }), "/settings/providers/new");
```

Also assert old `/providers/new` and `/providers/vendor/edit` canonicalization.

- [ ] **Step 2: Run router tests RED, then implement routes GREEN**

Run: `pnpm --filter @sovereign/web test -- src/router.test.ts src/router-navigation.test.ts`

- [ ] **Step 3: Write RED form tests**

Cover: all four format options; default URL recomputation after base/API changes; custom URL preservation; disabled discovery; immutable edit id; default values; add/remove manual model; model override; validation; pending button; server failure preserving values.

- [ ] **Step 4: Run form tests RED**

Run: `pnpm --filter @sovereign/web test -- src/providers/user-provider-form-view.test.tsx`

- [ ] **Step 5: Implement the controlled form from UI-kit primitives**

Keep model-row editing in a focused local component. Use semantic labels and field errors; no ad-hoc interactive elements in CSS.

- [ ] **Step 6: Wire App page composition and run form/router tests GREEN**

Run: `pnpm --filter @sovereign/web test -- src/router.test.ts src/router-navigation.test.ts src/providers/user-provider-form-view.test.tsx`

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/providers apps/web/src/router.ts apps/web/src/router.test.ts apps/web/src/router-navigation.test.ts apps/web/src/App.tsx packages/ui-kit/src/i18n
git commit -m "feat(web): add user provider editor"
```

### Task 7: Provider list/detail actions and model provenance

**Files:**

- Modify: `apps/web/src/providers/providers-view.tsx`
- Modify: `apps/web/src/providers/providers-view.test.tsx`
- Modify: `apps/web/src/providers/providers.css`
- Modify: `apps/web/src/App.tsx`
- Modify: translation resources under `packages/ui-kit/src/i18n`

**Interfaces:**

- Consumes common provider snapshot plus user-provider details/controller handlers.
- Produces create action on list, exact origin badges, user-only edit/refresh/delete actions, startup-conflict rows, refresh outcome, and confirm dialog.

- [ ] **Step 1: Write RED view tests**

Assert create navigation, user-origin badge, absence of edit/delete on builtin/plugin, edit navigation, refresh pending/error, startup conflict deletion, and confirm-before-delete.

- [ ] **Step 2: Run view tests RED**

Run: `pnpm --filter @sovereign/web test -- src/providers/providers-view.test.tsx`

- [ ] **Step 3: Implement list/detail composition**

Use existing `Button`, `Badge`, `Notice`, `ConfirmDialog`, `Panel`, `List`, and `ListRow`. Show source of each model from user details; common `ProviderModels` remains valid for non-user providers.

- [ ] **Step 4: Run all web provider tests GREEN**

Run: `pnpm --filter @sovereign/web test -- src/providers/*.test.ts src/providers/*.test.tsx`

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/providers apps/web/src/App.tsx packages/ui-kit/src/i18n
git commit -m "feat(web): expose user provider actions"
```

### Task 8: Documentation and full verification

**Files:**

- Modify: `docs/models-and-providers.md`
- Modify: `docs/data-directory.md`
- Modify: `docs/web-api.md`
- Modify: `docs/ui-kit.md`
- Modify: `docs/public-contract.md` if the source discriminator is public
- Modify: `docs/README.md` only if topic links change

**Interfaces:**

- Documents the implemented behavior, exact file/API names, failure semantics, cleanup order, and rejected alternatives in the thematic `Почему так` sections.

- [ ] **Step 1: Update current thematic docs from the implemented contract**

Record `user-providers.json`, routes, origin semantics, discovery/default behavior, create/edit URLs, and boundaries. Rewrite stale plugin-only wording instead of appending contradictory paragraphs.

- [ ] **Step 2: Run focused packages**

```bash
PATH=/Users/user/.nvm/versions/node/v24.18.0/bin:$PATH pnpm --filter @sovereign/protocol test
PATH=/Users/user/.nvm/versions/node/v24.18.0/bin:$PATH pnpm --filter @sovereign/agent-runtime-pi test
PATH=/Users/user/.nvm/versions/node/v24.18.0/bin:$PATH pnpm --filter @sovereign/daemon test
PATH=/Users/user/.nvm/versions/node/v24.18.0/bin:$PATH pnpm --filter @sovereign/web test
```

- [ ] **Step 3: Run full checks and build**

```bash
PATH=/Users/user/.nvm/versions/node/v24.18.0/bin:$PATH make check
PATH=/Users/user/.nvm/versions/node/v24.18.0/bin:$PATH make build
```

Expected: zero failures, zero new warnings.

- [ ] **Step 4: Inspect final diff and secret scan**

```bash
git diff --check
git status --short
rg -n "sk-[A-Za-z0-9]|test-secret" --glob '!*.test.ts' --glob '!*.test.tsx' .
```

Expected: only intended files; no credential literal in production/docs.

- [ ] **Step 5: Commit documentation**

```bash
git add docs
git commit -m "docs(providers): document user provider lifecycle"
```

- [ ] **Step 6: Verify clean branch state**

Run: `git status --short --branch && git log --oneline --decorate -12`

Expected: clean `feat/user-providers`, atomic commits, no push.
