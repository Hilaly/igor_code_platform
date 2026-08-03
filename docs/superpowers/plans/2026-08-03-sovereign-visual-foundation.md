# Sovereign Visual Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish the Refined Imperium fonts, surfaces, effects, density, and shared primitive geometry in UI Kit without changing application information architecture.

**Architecture:** Keep the existing palette → semantic roles → CSS variables pipeline and the existing three font-family tokens. Replace their values with the approved voice/interface/machine families, flatten decorative effects, strengthen Imperium surface separation, and make the current primitives consume a compact geometry scale. Application views remain consumers of UI Kit and receive the new foundation without a parallel style system.

**Tech Stack:** React 19, TypeScript, CSS Modules, Fontsource, Vitest, Testing Library, Ladle, pnpm workspace.

## Global Constraints

- Work in an isolated feature worktree branched from the commit containing `36a1b97` and all subsequently approved plan documents.
- Preserve the existing palette shape, `ColorScheme` contract, `roleNames`, `applyRoles`, `applyScale`, and all four shipped scheme identifiers.
- Keep `imperium` as the default scheme and preserve all three interface scale settings.
- Use Source Serif 4 for `--sovereign-font-family-display`, Manrope for `--sovereign-font-family-body`, and IBM Plex Mono for `--sovereign-font-family-mono`.
- Load fonts from UI Kit dependencies; do not add a CDN or runtime font request.
- Themes change colour only; no scheme-specific component geometry or markup.
- Add no application feature and no new server or protocol contract.
- Use test-first red/green cycles and atomic Conventional Commits in English.

---

## File Map

- `packages/ui-kit/package.json`: replace the three current Fontsource dependencies with the approved families.
- `pnpm-lock.yaml`: lock the approved local font packages.
- `packages/ui-kit/src/styles/index.css`: load Source Serif 4 variable, Manrope variable, and IBM Plex Mono weights 400/500.
- `packages/ui-kit/src/styles/tokens.css`: map the existing display/body/mono public tokens to the approved voice/interface/machine families and add compact/readable geometry tokens.
- `packages/ui-kit/src/styles/effects.css`: keep only restrained elevation and neutral surface effects; remove gradients, glow, glass, and backdrop blur.
- `packages/ui-kit/src/styles/styles.test.ts`: protect font imports, token consumers, flat effects, and the absence of decorative effects.
- `packages/ui-kit/src/components/{button,combobox,dialog,menu,model-picker,multi-select,panel,popover,select,toast,toggle}.module.css`: migrate every current decorative-effect consumer before deleting its token.
- `apps/web/src/shell/shell.css`, `apps/web/src/login/login.css`: replace the two page-backdrop consumers with the semantic page surface in the same compatibility change.
- `packages/ui-kit/src/tokens/schemes/imperium.ts`: strengthen separation of the four dark and light surface levels.
- `packages/ui-kit/src/tokens/tokens.test.ts`: protect the approved Imperium palette values and contrast contract.
- `packages/ui-kit/src/components/{button,input,list,panel,text,tree}.module.css`: apply compact controls/rows, moderate radii, restrained panels, and semantic typography.
- `packages/ui-kit/src/components/primitives.stories.tsx`: show dense controls, list rows, panels, headings, and long content together.
- `docs/ui-kit.md`: replace the obsolete Unbounded/glass/gradient description with the approved visual foundation and its reasons.
- `docs/README.md`: index this plan.

### Task 1: Approved local font families

**Files:**

- Modify: `packages/ui-kit/package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `packages/ui-kit/src/styles/index.css`
- Modify: `packages/ui-kit/src/styles/tokens.css`
- Modify: `packages/ui-kit/src/styles/styles.test.ts`

**Interfaces:**

- Preserves: `--sovereign-font-family-display`, `--sovereign-font-family-body`, and `--sovereign-font-family-mono` as the public CSS token names.
- Produces: display = Source Serif 4, body = Manrope, mono = IBM Plex Mono.
- Consumed later: agent messages use display, all controls use body, and machine blocks use mono.

- [ ] **Step 1: Write the failing font contract test**

Add a test that reads `styles/index.css`, `styles/tokens.css`, and `package.json`:

```ts
it("ships the approved voice, interface, and machine fonts locally", () => {
  const entry = readFileSync(join(kitRoot, "styles", "index.css"), "utf8");
  const tokens = readFileSync(join(kitRoot, "styles", "tokens.css"), "utf8");
  const manifest = JSON.parse(readFileSync(join(kitRoot, "..", "package.json"), "utf8"));

  expect(entry).toContain("@fontsource-variable/source-serif-4/wght.css");
  expect(entry).toContain("@fontsource-variable/manrope/wght.css");
  expect(entry).toContain("@fontsource/ibm-plex-mono/400.css");
  expect(entry).toContain("@fontsource/ibm-plex-mono/500.css");
  expect(tokens).toContain('"Source Serif 4 Variable"');
  expect(tokens).toContain('"Manrope Variable"');
  expect(tokens).toContain('"IBM Plex Mono"');
  expect(manifest.dependencies).toMatchObject({
    "@fontsource-variable/source-serif-4": expect.any(String),
    "@fontsource-variable/manrope": expect.any(String),
    "@fontsource/ibm-plex-mono": expect.any(String),
  });
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `pnpm --filter @sovereign/ui-kit test -- styles.test.ts`

Expected: FAIL because UI Kit still imports IBM Plex Sans, Unbounded, and JetBrains Mono.

- [ ] **Step 3: Replace the packages and token values**

Run:

```bash
pnpm --filter @sovereign/ui-kit remove @fontsource-variable/ibm-plex-sans @fontsource-variable/unbounded @fontsource-variable/jetbrains-mono
pnpm --filter @sovereign/ui-kit add @fontsource-variable/source-serif-4@^5.3.0 @fontsource-variable/manrope@^5.3.0 @fontsource/ibm-plex-mono@^5.3.0
```

Import the exact four CSS entries asserted above. Set the family tokens to:

```css
--sovereign-font-family-display: "Source Serif 4 Variable", Georgia, serif;
--sovereign-font-family-body: "Manrope Variable", -apple-system, "Segoe UI", sans-serif;
--sovereign-font-family-mono: "IBM Plex Mono", ui-monospace, "SF Mono", monospace;
```

Use font weights 400 and 500 for machine text; do not request unavailable IBM Plex Mono variable axes.

- [ ] **Step 4: Run tests and typecheck, verify GREEN**

Run: `pnpm --filter @sovereign/ui-kit test -- styles.test.ts && pnpm --filter @sovereign/ui-kit typecheck`

Expected: PASS and no references to the removed packages in `pnpm-lock.yaml`.

- [ ] **Step 5: Commit the font foundation**

```bash
git add packages/ui-kit/package.json packages/ui-kit/src/styles/index.css packages/ui-kit/src/styles/tokens.css packages/ui-kit/src/styles/styles.test.ts pnpm-lock.yaml
git commit -m "feat(ui-kit): adopt Sovereign typography families"
```

### Task 2: Flat effects and contextual density tokens

**Files:**

- Modify: `packages/ui-kit/src/styles/tokens.css`
- Modify: `packages/ui-kit/src/styles/effects.css`
- Modify: `packages/ui-kit/src/styles/styles.test.ts`
- Modify: `packages/ui-kit/src/components/button.module.css`
- Modify: `packages/ui-kit/src/components/combobox.module.css`
- Modify: `packages/ui-kit/src/components/dialog.module.css`
- Modify: `packages/ui-kit/src/components/menu.module.css`
- Modify: `packages/ui-kit/src/components/model-picker.module.css`
- Modify: `packages/ui-kit/src/components/multi-select.module.css`
- Modify: `packages/ui-kit/src/components/panel.module.css`
- Modify: `packages/ui-kit/src/components/popover.module.css`
- Modify: `packages/ui-kit/src/components/select.module.css`
- Modify: `packages/ui-kit/src/components/toast.module.css`
- Modify: `packages/ui-kit/src/components/toggle.module.css`
- Modify: `apps/web/src/shell/shell.css`
- Modify: `apps/web/src/login/login.css`

**Interfaces:**

- Produces: `--sovereign-row-height-compact`, `--sovereign-reading-width`, and `--sovereign-line-height-reading`.
- Preserves: `--sovereign-elevation-1..3` as the only elevation tokens.
- Removes from consumers: gradient, glow, glass, blur, and decorative hairline tokens.

- [ ] **Step 1: Write failing tests for density and restrained effects**

Add assertions:

```ts
it("defines contextual density and no decorative effect tokens", () => {
  const tokens = readFileSync(join(kitRoot, "styles", "tokens.css"), "utf8");
  const effects = readFileSync(join(kitRoot, "styles", "effects.css"), "utf8");

  expect(tokens).toContain("--sovereign-row-height-compact:");
  expect(tokens).toContain("--sovereign-reading-width:");
  expect(tokens).toContain("--sovereign-line-height-reading:");
  expect(effects).not.toMatch(/gradient|glow|glass|backdrop-blur|hairline/);
  expect(effects.match(/--sovereign-elevation-/g)).toHaveLength(3);
});
```

Replace the existing glass-treatment test with one that requires `Panel`, `Dialog`, `Menu`, and
`Popover` to use only a semantic surface and the appropriate elevation.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `pnpm --filter @sovereign/ui-kit test -- styles.test.ts`

Expected: FAIL on missing density tokens and existing gradient/glass effects.

- [ ] **Step 3: Implement the minimal shared tokens**

Add scale-derived values in `tokens.css`:

```css
--sovereign-row-height-compact: calc(var(--sovereign-control-height-md) - 0.75rem);
--sovereign-reading-width: 46rem;
--sovereign-line-height-reading: 1.68;
```

Keep three restrained shadow levels in `effects.css`. Delete decorative gradient, glow, glass,
backdrop-filter, and hairline declarations. Update the eleven listed UI Kit consumers in the same
change to use `var(--sovereign-panel-surface)`, `var(--sovereign-control-surface)`,
`var(--sovereign-accent)`, or `var(--sovereign-page-surface)` directly. Replace the shell and login
backdrops with `var(--sovereign-page-surface)`. Remove the obsolete
`usedOutsideTheKit = ["--sovereign-gradient-backdrop"]` exception so the no-dead-token test remains
meaningful.

- [ ] **Step 4: Run the complete stylesheet contract**

Run:

```bash
pnpm --filter @sovereign/ui-kit test -- styles.test.ts
pnpm --filter @sovereign/web test -- styles.test.ts
```

Expected: PASS, including no unknown/unused tokens and no removed backdrop reference in the app.

- [ ] **Step 5: Commit restrained effects and density**

```bash
git add packages/ui-kit/src/styles packages/ui-kit/src/components/button.module.css packages/ui-kit/src/components/combobox.module.css packages/ui-kit/src/components/dialog.module.css packages/ui-kit/src/components/menu.module.css packages/ui-kit/src/components/model-picker.module.css packages/ui-kit/src/components/multi-select.module.css packages/ui-kit/src/components/panel.module.css packages/ui-kit/src/components/popover.module.css packages/ui-kit/src/components/select.module.css packages/ui-kit/src/components/toast.module.css packages/ui-kit/src/components/toggle.module.css apps/web/src/shell/shell.css apps/web/src/login/login.css
git commit -m "refactor(ui-kit): establish contextual density effects"
```

### Task 3: Refined Imperium surface separation

**Files:**

- Modify: `packages/ui-kit/src/tokens/schemes/imperium.ts`
- Modify: `packages/ui-kit/src/tokens/tokens.test.ts`

**Interfaces:**

- Preserves: palette keys and `imperiumSchemeId`.
- Produces dark surfaces: page `#14100b`, raised `#201a13`, sunken `#100d09`, border `#3b2f21`.
- Produces light surfaces: page `#f3ead8`, raised `#fffaf0`, sunken `#e7dcc5`, border `#d1bea0`.

- [ ] **Step 1: Write the failing palette assertion**

```ts
it("separates the Refined Imperium surfaces", () => {
  expect(imperiumScheme.variants.dark).toMatchObject({
    surface: "#14100b",
    surfaceRaised: "#201a13",
    surfaceSunken: "#100d09",
    border: "#3b2f21",
  });
  expect(imperiumScheme.variants.light).toMatchObject({
    surface: "#f3ead8",
    surfaceRaised: "#fffaf0",
    surfaceSunken: "#e7dcc5",
    border: "#d1bea0",
  });
});
```

- [ ] **Step 2: Run token tests and verify RED**

Run: `pnpm --filter @sovereign/ui-kit test -- tokens.test.ts`

Expected: FAIL with the old Imperium values.

- [ ] **Step 3: Update only the four surface values per variant**

Keep ink, muted ink, purple accent, gold secondary, danger, warning, success, overlay, and shadow
unchanged in this task. This isolates surface hierarchy from semantic-colour tuning.

- [ ] **Step 4: Run token tests and verify GREEN**

Run: `pnpm --filter @sovereign/ui-kit test -- tokens.test.ts`

Expected: PASS, including existing contrast checks.

- [ ] **Step 5: Commit the palette refinement**

```bash
git add packages/ui-kit/src/tokens/schemes/imperium.ts packages/ui-kit/src/tokens/tokens.test.ts
git commit -m "style(ui-kit): refine Imperium surfaces"
```

### Task 4: Compact shared primitive geometry

**Files:**

- Modify: `packages/ui-kit/src/components/button.module.css`
- Modify: `packages/ui-kit/src/components/input.module.css`
- Modify: `packages/ui-kit/src/components/list.module.css`
- Modify: `packages/ui-kit/src/components/panel.module.css`
- Modify: `packages/ui-kit/src/components/text.module.css`
- Modify: `packages/ui-kit/src/components/tree.module.css`
- Modify: `packages/ui-kit/src/components/primitives.stories.tsx`
- Modify: `packages/ui-kit/src/styles/styles.test.ts`

**Interfaces:**

- Consumes: font and density tokens from Tasks 1–2.
- Produces: compact rows/controls, moderate radii, flat panels, Source Serif headings, and unchanged component TypeScript APIs.

- [ ] **Step 1: Add failing CSS contract assertions**

Require:

```ts
expect(listCss).toContain("height: var(--sovereign-row-height-compact)");
expect(treeCss).toContain("min-height: var(--sovereign-row-height-compact)");
expect(textCss).toContain("font-family: var(--sovereign-font-family-display)");
expect(panelCss).toContain("background: var(--sovereign-panel-surface)");
expect(panelCss).not.toMatch(/backdrop-filter|gradient|glass/);
```

Also assert that the compact visual row retains padding or a pseudo-element hit area sufficient for
the current keyboard/click contract; do not reduce semantic controls to icon-sized targets.

- [ ] **Step 2: Run stylesheet tests and verify RED**

Run: `pnpm --filter @sovereign/ui-kit test -- styles.test.ts`

Expected: FAIL because primitives still use the old control heights, broad radii, and glass panel.

- [ ] **Step 3: Apply the compact geometry**

Use `--sovereign-row-height-compact` for list/tree rows and small navigation controls. Reduce default
panel radius to `--sovereign-radius-sm`, use one subtle border and `--sovereign-elevation-1`, and
remove backdrop filtering. Keep button/input APIs and focus/disabled semantics unchanged. Use
display/Source Serif only for `Heading`; controls and rows stay body/Manrope.

- [ ] **Step 4: Add the dense foundation Ladle scenario**

In `primitives.stories.tsx`, add `VisualFoundation` with:

```tsx
<Panel title="Appearance">
  <Heading level={2}>Interface</Heading>
  <List>
    <ListRow selected onSelect={() => {}}>
      Imperium
    </ListRow>
    <ListRow onSelect={() => {}}>Nord</ListRow>
    <ListRow onSelect={() => {}}>Sage</ListRow>
  </List>
  <Input aria-label="Search" value="" onChange={() => {}} />
</Panel>
```

Include long labels and disabled/focused states already supported by the primitives; do not invent
application data.

- [ ] **Step 5: Run UI Kit verification**

Run:

```bash
pnpm --filter @sovereign/ui-kit test
pnpm --filter @sovereign/ui-kit typecheck
pnpm --filter @sovereign/ui-kit exec ladle build
```

Expected: 141 or more tests PASS, typecheck PASS, catalogue build PASS.

- [ ] **Step 6: Commit primitive geometry**

```bash
git add packages/ui-kit/src/components packages/ui-kit/src/styles/styles.test.ts
git commit -m "style(ui-kit): compact shared primitive geometry"
```

### Task 5: Document and verify the foundation slice

**Files:**

- Modify: `docs/ui-kit.md`
- Modify: `docs/README.md`

**Interfaces:**

- Documents: approved fonts, local delivery, contextual density tokens, restrained effects, Imperium surface levels, and rejected decorative alternatives.
- Produces: a clean base commit for the shell/system-view plan.

- [ ] **Step 1: Update durable UI Kit documentation**

Replace the current font paragraph and obsolete Unbounded decision. Replace the effects description
that promises gradients, glow, glass, and backdrop blur. Record why the three font roles and flat
effects were selected, including the Fontsource static IBM Plex Mono constraint.

- [ ] **Step 2: Index this plan in `docs/README.md`**

Add the plan next to the visual-language spec and describe it as the first implementation slice.

- [ ] **Step 3: Run final foundation verification**

Run:

```bash
pnpm --filter @sovereign/ui-kit test
pnpm --filter @sovereign/ui-kit typecheck
pnpm eslint packages/ui-kit
pnpm prettier --check packages/ui-kit docs/ui-kit.md docs/README.md
pnpm --filter @sovereign/ui-kit exec ladle build
git diff --check
```

Expected: all commands exit 0; generated Ladle output remains untracked/ignored.

- [ ] **Step 4: Commit documentation**

```bash
git add docs/ui-kit.md docs/README.md
git commit -m "docs(ui-kit): record visual foundation"
```

- [ ] **Step 5: Request an independent review before integration**

Dispatch a reviewer subagent with the visual-language spec, this plan, and the full branch diff. Fix
all actionable findings with focused tests, rerun the verification above, and repeat review until the
reviewer reports no findings.
