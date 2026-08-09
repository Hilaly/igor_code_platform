import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { ContributionRegistration, FileResourceDiagnostic } from "@sovereign/protocol";
import type { PluginContribution } from "@sovereign/sdk";

import {
  createContributionRegistry,
  type ContributingPlugin,
  type FileContributionInput,
  type StandaloneContributionSnapshot,
} from "./contribution-registry.ts";

const builtinHello: ContributingPlugin = { key: "builtin:hello", id: "hello", source: "builtin" };
const dataHello: ContributingPlugin = { key: "data:hello", id: "hello", source: "data" };
const projectHello: ContributingPlugin = {
  key: "project:p1:hello",
  id: "hello",
  source: "project:p1",
};
const projectOtherHello: ContributingPlugin = {
  key: "project:p2:hello",
  id: "hello",
  source: "project:p2",
};
const nothingDisabled = new Set<string>();

const agent = (instructions: string): PluginContribution => ({
  kind: "agent",
  id: "agent",
  instructions,
  tools: { include: ["*"] },
});

const ids = (registrations: ContributionRegistration[]): string[] =>
  registrations.map((registration) => registration.id);

type FileRegistration = Extract<ContributionRegistration, { kind: "agent" | "skill" }>;

const standaloneAgent = (
  id: string,
  source: string,
  scope: "user" | "project",
  projectId?: string,
): Extract<ContributionRegistration, { kind: "agent" }> => ({
  ownership: "standalone",
  kind: "agent",
  id,
  declaredId: id,
  source,
  scope,
  ...(projectId === undefined ? {} : { projectId }),
  instructions: `${source} instructions`,
  tools: { include: [], exclude: [] },
  skills: { include: [], exclude: [] },
});

const standaloneSkill = (
  id: string,
  source: string,
  scope: "user" | "project",
  projectId?: string,
): Extract<ContributionRegistration, { kind: "skill" }> => ({
  ownership: "standalone",
  kind: "skill",
  id,
  declaredId: id,
  source,
  scope,
  ...(projectId === undefined ? {} : { projectId }),
  name: id,
  description: `${source} skill`,
  location: `/roots/${source}/${id}/SKILL.md`,
  disableModelInvocation: false,
});

const file = (
  registration: FileRegistration,
  path = `/definitions/${registration.id}`,
  diagnostics: FileResourceDiagnostic[] = [],
): FileContributionInput => ({ registration, path, diagnostics, kind: registration.kind });

const acceptStandaloneSnapshot = (snapshot: StandaloneContributionSnapshot): void => {
  void snapshot;
};
const acceptFileInput = (input: FileContributionInput): void => {
  void input;
};

// @ts-expect-error Project ownership is incomplete without the project identifier.
acceptStandaloneSnapshot({
  rootKey: "project:missing:skills",
  source: "sovereign",
  scope: "project",
  precedence: 400,
  contributions: [],
});

// @ts-expect-error Discovery must preserve the requested kind even when parsing failed.
acceptFileInput({ path: "/broken/ENTRY.md", diagnostics: [] });

function standalone(
  rootKey: string,
  precedence: number,
  contributions: FileContributionInput[],
  overrides: { scope: "project"; projectId: string; source?: string },
): StandaloneContributionSnapshot;
function standalone(
  rootKey: string,
  precedence: number,
  contributions: FileContributionInput[],
  overrides?: { scope?: "user"; projectId?: never; source?: string },
): StandaloneContributionSnapshot;
function standalone(
  rootKey: string,
  precedence: number,
  contributions: FileContributionInput[],
  overrides:
    | { scope: "project"; projectId: string; source?: string }
    | { scope?: "user"; projectId?: never; source?: string } = {},
): StandaloneContributionSnapshot {
  return {
    rootKey,
    source: "sovereign",
    scope: "user",
    precedence,
    contributions,
    ...overrides,
  } as StandaloneContributionSnapshot;
}

describe("createContributionRegistry", () => {
  it("keeps a malformed project snapshot out of base resolution defensively", () => {
    const registry = createContributionRegistry();
    const malformed = {
      rootKey: "project:missing:skills",
      source: "sovereign",
      scope: "project",
      precedence: 400,
      contributions: [file(standaloneSkill("review", "sovereign", "project"))],
    } as unknown as StandaloneContributionSnapshot;

    registry.applyStandalone(malformed);

    assert.deepEqual(registry.resolvedBase(), []);
  });

  it("filters project declarations before precedence and conflict resolution", () => {
    const registry = createContributionRegistry();

    registry.applyPlugin(builtinHello, [agent("built-in")], nothingDisabled);
    registry.applyPlugin(dataHello, [agent("data")], nothingDisabled);
    registry.applyPlugin(projectHello, [agent("project one")], nothingDisabled);
    registry.applyPlugin(projectOtherHello, [agent("project two")], nothingDisabled);

    assert.deepEqual(ids(registry.resolvedBase("agent")), ["hello.agent"]);
    assert.deepEqual(ids(registry.resolvedForProject("p1", "agent")), ["hello.agent"]);
    assert.equal(registry.resolvedBase("agent")[0]?.source, "data");
    assert.equal(registry.resolvedForProject("p1", "agent")[0]?.source, "project:p1");
    assert.equal(registry.resolvedForProject("p2", "agent")[0]?.source, "project:p2");
    assert.deepEqual(registry.conflictsForProject("p1"), []);
  });

  it("uses the same project applicability for custom and event declarations", () => {
    const registry = createContributionRegistry();

    registry.applyPlugin(
      projectHello,
      [
        { kind: "custom", id: "panel" },
        { kind: "event", id: "task.created", payloadSchema: {} },
      ],
      nothingDisabled,
    );

    assert.deepEqual(ids(registry.resolvedBase()), []);
    assert.deepEqual(
      registry.resolvedForProject("p1").map((registration) => [registration.kind, registration.id]),
      [
        ["custom", "hello.panel"],
        ["event", "hello.task.created"],
      ],
    );
    assert.deepEqual(ids(registry.resolvedForProject("p2")), []);
  });

  it("keeps standalone short identifiers distinct from plugin-qualified identifiers", () => {
    const registry = createContributionRegistry();
    const review = standaloneSkill("review", "sovereign", "user");

    registry.applyStandalone(standalone("data:skills", 100, [file(review)]));
    registry.applyPlugin(
      { key: "data:github", id: "github", source: "data" },
      [{ kind: "custom", id: "review" }],
      nothingDisabled,
    );

    assert.deepEqual(ids(registry.resolvedBase()), ["github.review", "review"]);
  });

  it("lets the higher numeric precedence standalone root win", () => {
    const registry = createContributionRegistry();

    registry.applyStandalone(
      standalone("home:agents:skills", 100, [
        file(standaloneSkill("review", "agents", "user"), "/home/review/SKILL.md"),
      ]),
    );
    registry.applyStandalone(
      standalone("data:skills", 200, [
        file(standaloneSkill("review", "sovereign", "user"), "/data/review/SKILL.md"),
      ]),
    );

    assert.equal(registry.resolvedBase("skill")[0]?.source, "sovereign");
  });

  it("reports equal-rank standalone roots and marks both files invalid", () => {
    const registry = createContributionRegistry();
    const firstPath = "/project/.first/skills/review/SKILL.md";
    const secondPath = "/project/.second/skills/review/SKILL.md";

    registry.applyStandalone({
      rootKey: "project:p1:skills:first",
      source: "first",
      scope: "project",
      projectId: "p1",
      precedence: 300,
      contributions: [file(standaloneSkill("review", "first", "project", "p1"), firstPath)],
    });
    registry.applyStandalone({
      rootKey: "project:p1:skills:second",
      source: "second",
      scope: "project",
      projectId: "p1",
      precedence: 300,
      contributions: [file(standaloneSkill("review", "second", "project", "p1"), secondPath)],
    });

    assert.deepEqual(registry.resolvedForProject("p1", "skill"), []);
    assert.deepEqual(registry.conflictsForProject("p1"), [
      {
        id: "review",
        source: "first",
        plugins: [],
        standaloneRoots: ["project:p1:skills:first", "project:p1:skills:second"],
      },
    ]);
    assert.deepEqual(registry.conflictsForProject("p2"), []);

    const resources = registry.fileResourcesForProject("p1");
    assert.deepEqual(
      resources.resources.map((resource) => [resource.path, resource.state]),
      [
        [firstPath, "invalid"],
        [secondPath, "invalid"],
      ],
    );
    assert.deepEqual(
      resources.diagnostics.map((diagnostic) => [diagnostic.path, diagnostic.code]),
      [
        [firstPath, "duplicate-contribution"],
        [secondPath, "duplicate-contribution"],
      ],
    );
  });

  it("resolves plugin project over data over built-in", () => {
    const registry = createContributionRegistry();

    registry.applyPlugin(builtinHello, [agent("built-in")], nothingDisabled);
    assert.equal(registry.resolvedForProject("p1", "agent")[0]?.source, "builtin");
    registry.applyPlugin(dataHello, [agent("data")], nothingDisabled);
    assert.equal(registry.resolvedForProject("p1", "agent")[0]?.source, "data");
    registry.applyPlugin(projectHello, [agent("project")], nothingDisabled);
    assert.equal(registry.resolvedForProject("p1", "agent")[0]?.source, "project:p1");
  });

  it("does not conflict equal identifiers of different kinds", () => {
    const registry = createContributionRegistry();

    registry.applyPlugin(
      dataHello,
      [
        { kind: "custom", id: "same" },
        { kind: "event", id: "same", payloadSchema: {} },
      ],
      nothingDisabled,
    );

    assert.deepEqual(
      registry.resolvedBase().map((registration) => registration.kind),
      ["custom", "event"],
    );
    assert.deepEqual(registry.conflictsForProject("p1"), []);
  });

  it("excludes only a plugin identity duplicated by file and programmatic declarations", () => {
    const registry = createContributionRegistry();
    const fileAgent: Extract<ContributionRegistration, { kind: "agent" }> = {
      ownership: "plugin",
      kind: "agent",
      id: "hello.agent",
      declaredId: "agent",
      pluginKey: dataHello.key,
      pluginId: dataHello.id,
      source: dataHello.source,
      instructions: "from file",
      tools: { include: [], exclude: [] },
      skills: { include: [], exclude: [] },
    };
    const fileSkill: Extract<ContributionRegistration, { kind: "skill" }> = {
      ownership: "plugin",
      kind: "skill",
      id: "hello.review",
      declaredId: "review",
      pluginKey: dataHello.key,
      pluginId: dataHello.id,
      source: dataHello.source,
      name: "review",
      description: "Review changes",
      location: "/plugins/hello/skills/review/SKILL.md",
      disableModelInvocation: false,
    };

    const outcome = registry.applyPlugin({
      plugin: dataHello,
      contributions: [agent("programmatic")],
      fileContributions: [file(fileAgent), file(fileSkill)],
      disabledContributions: nothingDisabled,
    });

    assert.deepEqual(ids(outcome.registered), ["hello.review"]);
    assert.match(outcome.problems[0] ?? "", /declared 2 times/);
    assert.deepEqual(ids(registry.resolvedBase()), ["hello.review"]);
    assert.equal(
      registry
        .fileResourcesForProject("p1")
        .resources.find((resource) => resource.id === "hello.agent")?.state,
      "invalid",
    );
  });

  it("shows switched-off plugin files without resolving them", () => {
    const registry = createContributionRegistry();
    const registration: Extract<ContributionRegistration, { kind: "skill" }> = {
      ownership: "plugin",
      kind: "skill",
      id: "hello.review",
      declaredId: "review",
      pluginKey: dataHello.key,
      pluginId: dataHello.id,
      source: dataHello.source,
      name: "review",
      description: "Review changes",
      location: "/plugins/hello/skills/review/SKILL.md",
      disableModelInvocation: false,
    };

    registry.applyPlugin({
      plugin: dataHello,
      contributions: [],
      fileContributions: [file(registration, registration.location)],
      disabledContributions: new Set([registration.id]),
    });

    assert.deepEqual(registry.resolvedBase("skill"), []);
    assert.deepEqual(ids(registry.switchedOff()), ["hello.review"]);
    assert.equal(registry.fileResourcesForProject("p1").resources[0]?.state, "switched-off");
  });

  it("keeps invalid and shadowed files visible in the project snapshot", () => {
    const registry = createContributionRegistry();
    const lower = standaloneSkill("review", "agents", "project", "p1");
    const higher = standaloneSkill("review", "sovereign", "project", "p1");
    const invalidDiagnostic: FileResourceDiagnostic = {
      severity: "error",
      code: "invalid-frontmatter",
      message: "frontmatter is malformed",
      path: "/project/.sovereign/skills/broken/SKILL.md",
      kind: "skill",
      id: "broken",
    };

    registry.applyStandalone(
      standalone(
        "project:p1:skills:agents",
        300,
        [file(lower, "/project/.agents/skills/review/SKILL.md")],
        { scope: "project", projectId: "p1", source: "agents" },
      ),
    );
    registry.applyStandalone(
      standalone(
        "project:p1:skills:sovereign",
        400,
        [
          file(higher, "/project/.sovereign/skills/review/SKILL.md"),
          {
            path: invalidDiagnostic.path,
            diagnostics: [invalidDiagnostic],
            kind: "skill",
            id: "broken",
          },
        ],
        { scope: "project", projectId: "p1", source: "sovereign" },
      ),
    );

    const snapshot = registry.fileResourcesForProject("p1");

    assert.deepEqual(
      snapshot.resources.map((resource) => [resource.path, resource.state]),
      [
        ["/project/.agents/skills/review/SKILL.md", "shadowed"],
        ["/project/.sovereign/skills/broken/SKILL.md", "invalid"],
        ["/project/.sovereign/skills/review/SKILL.md", "active"],
      ],
    );
    assert.deepEqual(snapshot.diagnostics, [invalidDiagnostic]);
  });

  it("moves revision for observable snapshot changes and explicit file events only", () => {
    const registry = createContributionRegistry();
    const registration = standaloneAgent("code", "sovereign", "user");
    const snapshot = standalone("data:agents", 100, [file(registration, "/data/code/AGENT.md")]);

    registry.applyStandalone(snapshot);
    const first = registry.revision();
    registry.applyStandalone(snapshot);
    assert.equal(registry.revision(), first);

    registry.applyStandalone(snapshot, { resourceChanged: true });
    assert.equal(registry.revision(), first + 1);

    const diagnostic: FileResourceDiagnostic = {
      severity: "warning",
      code: "changed-warning",
      message: "warning changed",
      path: "/data/code/AGENT.md",
      kind: "agent",
      id: "code",
    };
    registry.applyStandalone(
      standalone("data:agents", 100, [file(registration, "/data/code/AGENT.md", [diagnostic])]),
    );
    assert.equal(registry.revision(), first + 2);

    registry.removeStandalone("data:agents");
    assert.equal(registry.revision(), first + 3);
  });

  it("moves revision once for an explicit plugin file event with unchanged declarations", () => {
    const registry = createContributionRegistry();
    const snapshot = {
      plugin: dataHello,
      contributions: [agent("programmatic")],
      fileContributions: [],
      disabledContributions: nothingDisabled,
    };

    registry.applyPlugin(snapshot);
    const beforeEvent = registry.revision();
    registry.applyPlugin(snapshot, { resourceChanged: true });

    assert.equal(registry.revision(), beforeEvent + 1);
  });

  it("validates malformed programmatic declarations without losing valid siblings", () => {
    const registry = createContributionRegistry();

    const outcome = registry.applyPlugin(
      dataHello,
      [
        { kind: "custom", id: "valid" },
        { kind: "agent", id: "broken", instructions: "   " },
      ],
      nothingDisabled,
    );

    assert.deepEqual(ids(outcome.registered), ["hello.valid"]);
    assert.equal(outcome.problems.length, 1);
  });

  it("removes plugin and standalone ownership snapshots atomically", () => {
    const registry = createContributionRegistry();

    registry.applyPlugin(dataHello, [{ kind: "custom", id: "panel" }], nothingDisabled);
    registry.applyStandalone(
      standalone("data:agents", 100, [file(standaloneAgent("code", "sovereign", "user"))]),
    );
    registry.removePlugin(dataHello.key);
    registry.removeStandalone("data:agents");

    assert.deepEqual(registry.resolvedBase(), []);
  });
});

describe("the two contributions a plugin makes to the work of the agent", () => {
  const echo: PluginContribution = {
    kind: "tool",
    id: "echo",
    description: "повторяет сказанное",
    parameters: { type: "object", properties: { text: { type: "string" } } },
  };

  it("registers a tool and a subscription with their declared form", () => {
    const registry = createContributionRegistry();

    const outcome = registry.applyPlugin(
      dataHello,
      [echo, { kind: "hook", id: "watch", event: "turn_finished", criticality: "critical" }],
      nothingDisabled,
    );

    assert.deepEqual(outcome.problems, []);
    // Порядок набора — по виду и идентификатору: подписка идёт раньше инструмента.
    assert.deepEqual(outcome.registered, [
      {
        ownership: "plugin",
        kind: "hook",
        id: "hello.watch",
        declaredId: "watch",
        pluginKey: dataHello.key,
        pluginId: dataHello.id,
        source: dataHello.source,
        event: "turn_finished",
        criticality: "critical",
      },
      {
        ownership: "plugin",
        kind: "tool",
        id: "hello.echo",
        declaredId: "echo",
        pluginKey: dataHello.key,
        pluginId: dataHello.id,
        source: dataHello.source,
        description: "повторяет сказанное",
        parameters: echo.kind === "tool" ? echo.parameters : {},
      },
    ]);
  });

  it("calls a subscription without a mark advisory", () => {
    const registry = createContributionRegistry();

    registry.applyPlugin(
      dataHello,
      [{ kind: "hook", id: "watch", event: "message_update" }],
      nothingDisabled,
    );

    const [subscription] = registry.resolvedBase("hook");

    // Умолчание критичности ставит ядро, и оно некритичное: автор, забывший пометку, не роняет
    // турны (docs/hooks.md).
    assert.equal(subscription?.kind === "hook" ? subscription.criticality : undefined, "advisory");
  });

  it("refuses a subscription to a name no runtime and no platform hook has", () => {
    const registry = createContributionRegistry();

    const outcome = registry.applyPlugin(
      dataHello,
      [
        { kind: "hook", id: "watch", event: "turn_finished" },
        { kind: "hook", id: "typo", event: "turn_finidhed" },
        // Собирающий хук подписке не отдаётся: инструмент объявляется вкладом, и второго способа
        // добавить инструмент у платформы нет (docs/hooks.md).
        { kind: "hook", id: "collector", event: "tools_collect" },
        // @ts-expect-error — автор назвал критичность, которой нет; отсев обязан быть и в рантайме.
        { kind: "hook", id: "loud", event: "turn_finished", criticality: "screaming" },
      ],
      nothingDisabled,
    );

    // Кривой вклад — проблема жизненного цикла, а не исключение: соседи применяются.
    assert.deepEqual(ids(outcome.registered), ["hello.watch"]);
    assert.deepEqual(outcome.problems, [
      'the subscription hello.typo names an unknown hook "turn_finidhed"',
      'the subscription hello.collector names an unknown hook "tools_collect"',
      'the subscription hello.loud names an unknown criticality "screaming"',
    ]);
  });

  it("refuses a tool the model would not be able to call", () => {
    const registry = createContributionRegistry();

    const outcome = registry.applyPlugin(
      dataHello,
      [
        echo,
        // Точка в имени инструмента запрещена провайдерами, поэтому неймспейс в имя не ставится.
        { ...echo, id: "weather.today" },
        { ...echo, id: "silent", description: "   " },
        { ...echo, id: "schemaless", parameters: undefined } as unknown as PluginContribution,
      ],
      nothingDisabled,
    );

    assert.deepEqual(ids(outcome.registered), ["hello.echo"]);
    assert.deepEqual(outcome.problems, [
      "the tool hello.weather.today must be named ^[a-z0-9][a-z0-9-]{0,63}$: " +
        "the identifier is the name the model calls",
      "the tool hello.silent declares no description, so the model cannot use it",
      "the tool hello.schemaless must declare the schema of its arguments",
    ]);
  });

  it("gives the more specific source the last word about the same tool", () => {
    const registry = createContributionRegistry();

    registry.applyPlugin(builtinHello, [echo], nothingDisabled);
    registry.applyPlugin(
      dataHello,
      [{ ...echo, description: "поставленный рядом" }],
      nothingDisabled,
    );

    assert.deepEqual(ids(registry.resolvedBase("tool")), ["hello.echo"]);
    assert.equal(registry.resolvedBase("tool")[0]?.source, "data");
    assert.deepEqual(registry.conflicts(), []);
  });

  it("applies neither subscription when two plugins of one source claim the same one", () => {
    const registry = createContributionRegistry();
    const watch: PluginContribution = { kind: "hook", id: "watch", event: "turn_finished" };

    registry.applyPlugin(
      { key: "data:one", id: "shared", source: "data" },
      [watch],
      nothingDisabled,
    );
    registry.applyPlugin(
      { key: "data:two", id: "shared", source: "data" },
      [watch],
      nothingDisabled,
    );

    assert.deepEqual(registry.resolvedBase("hook"), []);
    assert.deepEqual(
      registry.conflicts().map((conflict) => [conflict.id, conflict.plugins]),
      [["shared.watch", ["data:one", "data:two"]]],
    );
  });

  it("hides a switched-off tool from the resolved set and keeps it visible as switched off", () => {
    const registry = createContributionRegistry();

    registry.applyPlugin(dataHello, [echo], new Set(["hello.echo"]));

    assert.deepEqual(registry.resolvedBase("tool"), []);
    assert.deepEqual(ids(registry.switchedOff()), ["hello.echo"]);
  });
});

describe("the colour scheme, a contribution made of nothing but data", () => {
  const midnight: PluginContribution = {
    kind: "color-scheme",
    id: "midnight",
    title: "Midnight",
    scheme: {
      tokenContract: 2,
      variants: { dark: { surface: "#0b1020", text: "#e8ecff" } },
      roleOverrides: { accent: "#7aa2ff" },
    },
  };

  it("registers the document as declared, without looking inside the palette", () => {
    const registry = createContributionRegistry();

    const outcome = registry.applyPlugin(dataHello, [midnight], nothingDisabled);

    assert.deepEqual(outcome.problems, []);
    assert.deepEqual(outcome.registered, [
      {
        ownership: "plugin",
        kind: "color-scheme",
        id: "hello.midnight",
        declaredId: "midnight",
        pluginKey: dataHello.key,
        pluginId: dataHello.id,
        source: dataHello.source,
        title: "Midnight",
        scheme: midnight.kind === "color-scheme" ? midnight.scheme : undefined,
      },
    ]);
  });

  it("takes a scheme whose palette the kit will refuse, because completeness is not its business", () => {
    const registry = createContributionRegistry();

    // Мажор контракта токенов и полнота палитры принадлежат киту: демон от кита не зависит, и
    // проверка здесь сделала бы версию кита частью контракта демона (docs/ui-kit.md).
    const outcome = registry.applyPlugin(
      dataHello,
      [
        { ...midnight, id: "ancient", scheme: { tokenContract: 1, variants: { dark: {} } } },
        { ...midnight, id: "sparse", scheme: { tokenContract: 2, variants: { dark: {} } } },
      ],
      nothingDisabled,
    );

    assert.deepEqual(outcome.problems, []);
    assert.deepEqual(ids(outcome.registered), ["hello.ancient", "hello.sparse"]);
  });

  it("refuses a document of the wrong shape and keeps its valid siblings", () => {
    const registry = createContributionRegistry();

    const broken = (id: string, scheme: unknown): PluginContribution =>
      ({ kind: "color-scheme", id, scheme }) as unknown as PluginContribution;

    const outcome = registry.applyPlugin(
      dataHello,
      [
        midnight,
        broken("textual", "midnight.css"),
        broken("fractional", { tokenContract: 1.5, variants: { dark: { surface: "#000" } } }),
        broken("empty", { tokenContract: 2, variants: {} }),
        broken("nested", { tokenContract: 2, variants: { dark: { surface: { hex: "#000" } } } }),
        broken("listed", { tokenContract: 2, variants: [{ surface: "#000" }] }),
        broken("roles", {
          tokenContract: 2,
          variants: { dark: { surface: "#000" } },
          roleOverrides: ["#000"],
        }),
      ],
      nothingDisabled,
    );

    assert.deepEqual(ids(outcome.registered), ["hello.midnight"]);
    assert.deepEqual(
      outcome.problems.map((problem) => problem.split(" ")[3]),
      [
        "hello.textual",
        "hello.fractional",
        "hello.empty",
        "hello.nested",
        "hello.listed",
        "hello.roles",
      ],
    );
  });
});

describe("the message catalogue, the second contribution made of nothing but data", () => {
  const esperanto: PluginContribution = {
    kind: "locale-catalog",
    id: "core-eo",
    namespace: "core",
    locale: "eo",
    messages: { "state.loading": "Ŝargado…" },
  };

  it("registers a catalogue for the namespace of the core: that is how a language appears", () => {
    const registry = createContributionRegistry();

    const outcome = registry.applyPlugin(dataHello, [esperanto], nothingDisabled);

    assert.deepEqual(outcome.problems, []);
    assert.deepEqual(outcome.registered, [
      {
        ownership: "plugin",
        kind: "locale-catalog",
        id: "hello.core-eo",
        declaredId: "core-eo",
        pluginKey: dataHello.key,
        pluginId: dataHello.id,
        source: dataHello.source,
        namespace: "core",
        locale: "eo",
        messages: { "state.loading": "Ŝargado…" },
      },
    ]);
  });

  it("registers a catalogue for the namespace of the plugin itself", () => {
    const registry = createContributionRegistry();

    const outcome = registry.applyPlugin(
      dataHello,
      [{ ...esperanto, id: "own", namespace: dataHello.id }],
      nothingDisabled,
    );

    assert.deepEqual(outcome.problems, []);
    assert.deepEqual(ids(outcome.registered), ["hello.own"]);
  });

  it("refuses the namespace of somebody else, and names both it may have", () => {
    const registry = createContributionRegistry();

    // Разрешить чужой неймспейс потом можно, никого не сломав; запретить потом — уже нельзя.
    const outcome = registry.applyPlugin(
      dataHello,
      [{ ...esperanto, id: "stolen", namespace: "tracker" }],
      nothingDisabled,
    );

    assert.deepEqual(outcome.registered, []);
    assert.equal(outcome.problems.length, 1);
    assert.match(outcome.problems[0] ?? "", /hello\.stolen must name the namespace core or hello/);
  });

  it("keeps the canonical tag, so one language does not become two entries", () => {
    const registry = createContributionRegistry();

    const outcome = registry.applyPlugin(
      dataHello,
      [{ ...esperanto, id: "brazil", locale: "pt-br" }],
      nothingDisabled,
    );

    assert.deepEqual(outcome.problems, []);
    assert.equal(
      outcome.registered[0]?.kind === "locale-catalog" ? outcome.registered[0].locale : undefined,
      "pt-BR",
    );
  });

  it("refuses a broken catalogue and keeps its valid siblings", () => {
    const registry = createContributionRegistry();

    const broken = (id: string, fields: Record<string, unknown>): PluginContribution =>
      ({ ...esperanto, id, ...fields }) as unknown as PluginContribution;

    const outcome = registry.applyPlugin(
      dataHello,
      [
        esperanto,
        broken("nameless", { locale: "not a tag at all" }),
        broken("numbered", { locale: 42 }),
        // Пустой каталог для `core` добавил бы в выбор языков язык без единой переведённой строки.
        broken("hollow", { messages: {} }),
        broken("listed", { messages: ["Ŝargado…"] }),
        broken("nested", { messages: { "state.loading": { text: "Ŝargado…" } } }),
      ],
      nothingDisabled,
    );

    assert.deepEqual(ids(outcome.registered), ["hello.core-eo"]);
    assert.deepEqual(
      outcome.problems.map((problem) => problem.split(" ")[2]),
      ["hello.nameless", "hello.numbered", "hello.hollow", "hello.listed", "hello.nested"],
    );
  });
});

describe("the place and the component, the two contributions that reach the interface", () => {
  const board: PluginContribution = {
    kind: "place",
    id: "board",
    cardinality: "collection",
  };
  const card: PluginContribution = {
    kind: "component",
    id: "card",
    placeId: "hello.board",
    export: "Card",
  };

  /** Снимком, а не тройкой аргументов: признак браузерной части есть только у снимка. */
  const withBrowser = (contributions: PluginContribution[], hasBrowserEntry = true) =>
    createContributionRegistry().applyPlugin({
      plugin: dataHello,
      contributions,
      fileContributions: [],
      disabledContributions: nothingDisabled,
      hasBrowserEntry,
    });

  it("registers a place and a component of a plugin that has a browser bundle", () => {
    const outcome = withBrowser([board, card]);

    assert.deepEqual(outcome.problems, []);
    assert.deepEqual(outcome.registered, [
      {
        ownership: "plugin",
        kind: "component",
        id: "hello.card",
        declaredId: "card",
        pluginKey: dataHello.key,
        pluginId: dataHello.id,
        source: dataHello.source,
        placeId: "hello.board",
        export: "Card",
      },
      {
        ownership: "plugin",
        kind: "place",
        id: "hello.board",
        declaredId: "board",
        pluginKey: dataHello.key,
        pluginId: dataHello.id,
        source: dataHello.source,
        cardinality: "collection",
        replaceable: false,
      },
    ]);
  });

  /**
   * Вклад в ещё не объявленное место — не ошибка: порядок подъёма плагинов не определён, и
   * проверка существования означала бы, что вклад теряется из-за того, чей воркер встал первым.
   */
  it("takes a component addressed to a place that does not exist yet", () => {
    const outcome = withBrowser([{ ...card, placeId: "someone.else" }]);

    assert.deepEqual(outcome.problems, []);
    assert.deepEqual(ids(outcome.registered), ["hello.card"]);
  });

  it("refuses a component from a plugin without a browser bundle: there is no export to name", () => {
    const outcome = withBrowser([card], false);

    assert.deepEqual(ids(outcome.registered), []);
    assert.match(outcome.problems[0] ?? "", /the component hello\.card needs a browser bundle/);
  });

  it("refuses a replaceable place without a built-in provider", () => {
    const outcome = withBrowser([
      { ...board, id: "panel", cardinality: "single", replaceable: true },
    ]);

    assert.deepEqual(ids(outcome.registered), []);
    assert.match(outcome.problems[0] ?? "", /the replaceable place hello\.panel/);
  });

  it("keeps the built-in provider of a replaceable place", () => {
    const outcome = withBrowser([
      { ...board, id: "panel", cardinality: "single", replaceable: true, builtIn: "Panel" },
    ]);

    assert.deepEqual(outcome.problems, []);
    assert.equal(
      outcome.registered[0]?.kind === "place" ? outcome.registered[0].builtIn : undefined,
      "Panel",
    );
  });

  it("refuses a broken declaration and keeps its valid siblings", () => {
    const broken = (id: string, fields: Record<string, unknown>): PluginContribution =>
      ({ ...board, id, ...fields }) as unknown as PluginContribution;
    const brokenComponent = (id: string, fields: Record<string, unknown>): PluginContribution =>
      ({ ...card, id, ...fields }) as unknown as PluginContribution;

    const outcome = withBrowser([
      board,
      card,
      broken("odd", { cardinality: "carousel" }),
      // Заменяемость у коллекции бессмысленна: вклады там складываются, а не спорят.
      broken("spread", { cardinality: "collection", replaceable: true, builtIn: "Spread" }),
      brokenComponent("homeless", { placeId: "board" }),
      brokenComponent("numbered", { placeId: 42 }),
      brokenComponent("nameless", { export: "  " }),
      brokenComponent("grouped", { group: 3 }),
      brokenComponent("infinite", { order: Number.POSITIVE_INFINITY }),
    ]);

    assert.deepEqual(ids(outcome.registered), ["hello.card", "hello.board"]);
    assert.deepEqual(
      outcome.problems.map((problem) => problem.split(" ")[2]),
      [
        "hello.odd",
        "hello.spread",
        "hello.homeless",
        "hello.numbered",
        "hello.nameless",
        "hello.grouped",
        "hello.infinite",
      ],
    );
  });

  /**
   * Признак браузерной части нужен и месту: имя экспорта встроенного провайдера у плагина без
   * бандла указывает в пустоту так же, как и у компонента.
   */
  it("refuses a built-in provider named by a plugin without a browser bundle", () => {
    const outcome = withBrowser(
      [{ ...board, id: "panel", cardinality: "single", replaceable: true, builtIn: "Panel" }],
      false,
    );

    assert.deepEqual(ids(outcome.registered), []);
    assert.match(outcome.problems[0] ?? "", /the place hello\.panel names the built-in provider/);
  });
});
