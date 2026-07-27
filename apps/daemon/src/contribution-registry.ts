/**
 * Реестр вкладов (ADR-0054). Плагин объявляет вклады во время `activate`, реестр решает, какие из
 * них действуют, и держит связь «вклад — плагин»: без неё выключение плагина не может снять всё, что
 * он зарегистрировал (ADR-0016).
 *
 * Видов два: общий и событие шины (ADR-0072). Остальные типизированные виды появятся вместе со
 * своими потребителями — контракт без потребителя проверить нечем.
 */

import {
  coreEventNamespace,
  pluginSources,
  type ContributionRegistration,
  type PluginSource,
} from "@sovereign/protocol";
import type { PluginContribution } from "@sovereign/sdk";

/** Точки в идентификаторе разрешены: они дают плагину свою иерархию внутри своего неймспейса. */
const declaredIdPattern = /^[a-z0-9][a-z0-9-]*(\.[a-z0-9][a-z0-9-]*)*$/;

/** Спор между вкладами с одинаковым идентификатором и одинаковым рангом источника (ADR-0040). */
export type ContributionConflict = {
  id: string;
  source: PluginSource;
  plugins: string[];
};

export type ContributionApplyOutcome = {
  registered: ContributionRegistration[];
  /** Кривой вклад — событие жизненного цикла плагина, а не исключение (ADR-0054). */
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
   * (ADR-0024). Выключенные человеком вклады отсеиваются здесь же, до разрешения споров
   * (ADR-0032) — выключенный вклад не участвует ни в чём, в том числе в перекрытии.
   */
  apply: (
    plugin: ContributingPlugin,
    contributions: PluginContribution[],
    disabledContributions: ReadonlySet<string>,
  ) => ContributionApplyOutcome;
  remove: (pluginKey: string) => void;
  resolved: () => ContributionRegistration[];
  conflicts: () => ContributionConflict[];
};

export function createContributionRegistry(): ContributionRegistry {
  const byPlugin = new Map<string, ContributionRegistration[]>();

  let revision = 0;
  let resolved: ContributionRegistration[] = [];
  let conflicts: ContributionConflict[] = [];

  const resolve = (): void => {
    const claims = new Map<string, ContributionRegistration[]>();

    for (const registrations of byPlugin.values()) {
      for (const registration of registrations) {
        claims.set(registration.id, [...(claims.get(registration.id) ?? []), registration]);
      }
    }

    const nextResolved: ContributionRegistration[] = [];
    const nextConflicts: ContributionConflict[] = [];

    for (const [id, claimants] of [...claims].sort(([left], [right]) => (left < right ? -1 : 1))) {
      // Более специфичный источник перекрывает менее специфичный (ADR-0030).
      const rank = (registration: ContributionRegistration): number =>
        pluginSources.indexOf(registration.source);
      const best = Math.max(...claimants.map(rank));
      const winners = claimants.filter((registration) => rank(registration) === best);
      const winner = winners[0];

      if (winners.length > 1 && winner !== undefined) {
        // Равный ранг — выбирать не по чему, поэтому не применяется ни один (ADR-0040).
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
      const registered: ContributionRegistration[] = [];
      const problems: string[] = [];
      const claimed = new Map<string, ContributionRegistration[]>();

      for (const contribution of contributions) {
        if (!declaredIdPattern.test(contribution.id)) {
          problems.push(
            `the contribution identifier ${JSON.stringify(contribution.id)} must match ${declaredIdPattern.source}`,
          );

          continue;
        }

        const id = `${plugin.id}.${contribution.id}`;

        // Неймспейс ядра принадлежит ядру (ADR-0072): плагин с идентификатором `core` иначе объявил
        // бы событие `core.plugin.lifecycle` и стал бы неотличим от платформы.
        if (contribution.kind === "event" && id.startsWith(`${coreEventNamespace}.`)) {
          problems.push(
            `the event ${id} is in the namespace of the core, which belongs to the platform`,
          );

          continue;
        }

        const common = {
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

        claimed.set(id, [
          ...(claimed.get(id) ?? []),
          contribution.kind === "event"
            ? { ...common, kind: "event", payloadSchema: contribution.payloadSchema }
            : {
                ...common,
                kind: "custom",
                ...(contribution.payload === undefined ? {} : { payload: contribution.payload }),
              },
        ]);
      }

      for (const [id, group] of claimed) {
        const single = group[0];

        // Дважды объявленный идентификатор — тот же спор с равным рангом, что и между плагинами:
        // не применяется ни один (ADR-0040).
        if (group.length > 1 || single === undefined) {
          problems.push(`the contribution ${id} is declared ${group.length} times by one plugin`);

          continue;
        }

        if (disabledContributions.has(id)) {
          continue;
        }

        registered.push(single);
      }

      byPlugin.set(plugin.key, registered);
      resolve();

      return { registered, problems };
    },
    remove: (pluginKey) => {
      if (byPlugin.delete(pluginKey)) {
        resolve();
      }
    },
    resolved: () => resolved,
    conflicts: () => conflicts,
  };
}
