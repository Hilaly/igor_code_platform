/**
 * Реестр вкладов (docs/plugins.md). Плагин объявляет вклады во время `activate`, реестр решает, какие из
 * них действуют, и держит связь «вклад — плагин»: без неё выключение плагина не может снять всё, что
 * он зарегистрировал (docs/plugins.md).
 *
 * Видов три: общий, событие шины (docs/event-bus.md) и агент (docs/sessions-and-projects.md).
 * Остальные типизированные виды появятся вместе со своими потребителями — контракт без потребителя
 * проверить нечем.
 */

import {
  coreEventNamespace,
  isThinkingLevel,
  pluginSourceRank,
  type ContributionConflict,
  type ContributionRegistration,
  type PluginSource,
} from "@sovereign/protocol";
import type { PluginContribution } from "@sovereign/sdk";

type PluginContributionRegistration = Extract<ContributionRegistration, { ownership: "plugin" }>;

/** Точки в идентификаторе разрешены: они дают плагину свою иерархию внутри своего неймспейса. */
const declaredIdPattern = /^[a-z0-9][a-z0-9-]*(\.[a-z0-9][a-z0-9-]*)*$/;

export type ContributionApplyOutcome = {
  registered: PluginContributionRegistration[];
  /** Кривой вклад — событие жизненного цикла плагина, а не исключение (docs/plugins.md). */
  problems: string[];
};

export type ContributingPlugin = {
  key: string;
  id: string;
  source: PluginSource;
};

export type ContributionRegistry = {
  /** Растёт, когда действующий набор изменился: наблюдателю есть с чем сравнить. */
  revision: () => number;
  /**
   * Заменяет весь набор плагина целиком: наблюдатель видит либо прежний набор, либо новый
   * (docs/ui-extension-model.md). Выключенные человеком вклады отсеиваются здесь же, до разрешения споров
   * (docs/plugins.md) — выключенный вклад не участвует ни в чём, в том числе в перекрытии.
   */
  apply: (
    plugin: ContributingPlugin,
    contributions: PluginContribution[],
    disabledContributions: ReadonlySet<string>,
  ) => ContributionApplyOutcome;
  remove: (pluginKey: string) => void;
  resolved: () => PluginContributionRegistration[];
  /**
   * Объявленное, но выключенное человеком. Реестр помнит его целиком, а не только применённое:
   * иначе выключенный вклад исчезал бы из интерфейса вместе с возможностью включить его обратно
   * (docs/plugins.md).
   */
  switchedOff: () => PluginContributionRegistration[];
  conflicts: () => ContributionConflict[];
};

/** Что плагин объявил и что из этого действует. Разница между ними — решение человека. */
type PluginContributions = {
  declared: PluginContributionRegistration[];
  registered: PluginContributionRegistration[];
  disabled: ReadonlySet<string>;
};

const byIdentifier = (
  left: PluginContributionRegistration,
  right: PluginContributionRegistration,
): number => (left.id < right.id ? -1 : 1);

export function createContributionRegistry(): ContributionRegistry {
  const byPlugin = new Map<string, PluginContributions>();

  let revision = 0;
  let resolved: PluginContributionRegistration[] = [];
  let conflicts: ContributionConflict[] = [];

  const resolve = (): void => {
    const claims = new Map<string, PluginContributionRegistration[]>();

    for (const contributions of byPlugin.values()) {
      for (const registration of contributions.registered) {
        claims.set(registration.id, [...(claims.get(registration.id) ?? []), registration]);
      }
    }

    const nextResolved: PluginContributionRegistration[] = [];
    const nextConflicts: ContributionConflict[] = [];

    for (const [id, claimants] of [...claims].sort(([left], [right]) => (left < right ? -1 : 1))) {
      // Более специфичный источник перекрывает менее специфичный (docs/plugins.md).
      const rank = (registration: PluginContributionRegistration): number =>
        pluginSourceRank(registration.source);
      const best = Math.max(...claimants.map(rank));
      const winners = claimants.filter((registration) => rank(registration) === best);
      const winner = winners[0];

      if (winners.length > 1 && winner !== undefined) {
        // Равный ранг — выбирать не по чему, поэтому не применяется ни один (docs/plugins.md).
        nextConflicts.push({
          id,
          source: winner.source,
          plugins: winners.map((registration) => registration.pluginKey),
        });

        continue;
      }

      if (winner !== undefined) {
        nextResolved.push(winner);
      }
    }

    const changed = JSON.stringify(nextResolved) !== JSON.stringify(resolved);

    resolved = nextResolved;
    conflicts = nextConflicts;

    if (changed) {
      revision += 1;
    }
  };

  return {
    revision: () => revision,
    apply: (plugin, contributions, disabledContributions) => {
      const declared: PluginContributionRegistration[] = [];
      const registered: PluginContributionRegistration[] = [];
      const problems: string[] = [];
      const claimed = new Map<string, PluginContributionRegistration[]>();

      for (const contribution of contributions) {
        if (!declaredIdPattern.test(contribution.id)) {
          problems.push(
            `the contribution identifier ${JSON.stringify(contribution.id)} must match ${declaredIdPattern.source}`,
          );

          continue;
        }

        const id = `${plugin.id}.${contribution.id}`;

        // Неймспейс ядра принадлежит ядру (docs/event-bus.md): плагин с идентификатором `core` иначе объявил
        // бы событие `core.plugin.lifecycle` и стал бы неотличим от платформы.
        if (contribution.kind === "event" && id.startsWith(`${coreEventNamespace}.`)) {
          problems.push(
            `the event ${id} is in the namespace of the core, which belongs to the platform`,
          );

          continue;
        }

        const common = {
          ownership: "plugin" as const,
          id,
          declaredId: contribution.id,
          pluginKey: plugin.key,
          pluginId: plugin.id,
          source: plugin.source,
          ...(contribution.title === undefined ? {} : { title: contribution.title }),
          ...(contribution.description === undefined
            ? {}
            : { description: contribution.description }),
        };

        const registration = toRegistration(common, contribution, problems);

        if (registration === undefined) {
          continue;
        }

        claimed.set(id, [...(claimed.get(id) ?? []), registration]);
      }

      for (const [id, group] of claimed) {
        const single = group[0];

        // Дважды объявленный идентификатор — тот же спор с равным рангом, что и между плагинами:
        // не применяется ни один (docs/plugins.md).
        if (group.length > 1 || single === undefined) {
          problems.push(`the contribution ${id} is declared ${group.length} times by one plugin`);

          continue;
        }

        declared.push(single);

        if (disabledContributions.has(id)) {
          continue;
        }

        registered.push(single);
      }

      byPlugin.set(plugin.key, { declared, registered, disabled: disabledContributions });
      resolve();

      return { registered, problems };
    },
    remove: (pluginKey) => {
      if (byPlugin.delete(pluginKey)) {
        resolve();
      }
    },
    resolved: () => resolved,
    switchedOff: () =>
      [...byPlugin.values()]
        .flatMap((contributions) =>
          contributions.declared.filter((registration) =>
            contributions.disabled.has(registration.id),
          ),
        )
        .sort(byIdentifier),
    conflicts: () => conflicts,
  };
}

/** Общие поля записи: их считает вызывающий, здесь дописывается только то, что зависит от вида. */
type RegistrationCommon = {
  ownership: "plugin";
  id: string;
  declaredId: string;
  pluginKey: string;
  pluginId: string;
  source: PluginSource;
  title?: string;
  description?: string;
};

/**
 * Перевод объявленного вклада в запись реестра. Кривое объявление — не исключение, а проблема в
 * событии жизненного цикла плагина: остальные его вклады обязаны примениться (docs/plugins.md).
 */
function toRegistration(
  common: RegistrationCommon,
  contribution: PluginContribution,
  problems: string[],
): PluginContributionRegistration | undefined {
  if (contribution.kind === "event") {
    return { ...common, kind: "event", payloadSchema: contribution.payloadSchema };
  }

  if (contribution.kind === "custom") {
    return {
      ...common,
      kind: "custom",
      ...(contribution.payload === undefined ? {} : { payload: contribution.payload }),
    };
  }

  const instructions =
    typeof contribution.instructions === "string" ? contribution.instructions.trim() : "";

  if (instructions === "") {
    problems.push(`the agent ${common.id} declares no instructions`);

    return undefined;
  }

  const include = asStringArray(contribution.tools?.include ?? []);
  const exclude = asStringArray(contribution.tools?.exclude ?? []);

  if (include === undefined || exclude === undefined) {
    problems.push(`the agent ${common.id} must select tools by lists of name patterns`);

    return undefined;
  }

  if (contribution.thinkingLevel !== undefined && !isThinkingLevel(contribution.thinkingLevel)) {
    problems.push(
      `the agent ${common.id} names an unknown reasoning level ${JSON.stringify(contribution.thinkingLevel)}`,
    );

    return undefined;
  }

  const rawSkills = contribution.skills;
  const skillInclude =
    rawSkills === undefined
      ? []
      : typeof rawSkills === "object" && rawSkills !== null
        ? asStringArray(rawSkills.include)
        : undefined;
  const skillExclude =
    rawSkills === undefined
      ? []
      : typeof rawSkills === "object" && rawSkills !== null
        ? asStringArray(rawSkills.exclude ?? [])
        : undefined;

  if (skillInclude === undefined || skillExclude === undefined) {
    problems.push(`the agent ${common.id} must select skills by lists of name patterns`);

    return undefined;
  }

  return {
    ...common,
    kind: "agent",
    instructions,
    tools: { include, exclude },
    ...(contribution.model === undefined ? {} : { model: contribution.model }),
    ...(contribution.thinkingLevel === undefined
      ? {}
      : { thinkingLevel: contribution.thinkingLevel }),
    skills: { include: skillInclude, exclude: skillExclude },
  };
}

function asStringArray(value: unknown): string[] | undefined {
  return Array.isArray(value) && value.every((item) => typeof item === "string")
    ? (value as string[])
    : undefined;
}
