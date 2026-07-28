/**
 * Вью управления плагинами. Живёт в ядре, а не в плагине (docs/architecture.md): это единственный
 * путь восстановления системы, и выключить его нельзя.
 *
 * Переключает только человек (docs/plugins.md), и переключается каждый вклад по отдельности (docs/plugins.md).
 * Выключенный вклад показывается помеченным, а не исчезает: иначе включить его обратно было бы
 * нечем.
 */

import type {
  ContributionRegistration,
  PluginLifecycleState,
  PluginPreferences,
  PluginsSnapshot,
  PluginStatus,
} from "@sovereign/protocol";
import {
  Badge,
  CodeBlock,
  Code,
  Disclosure,
  EmptyState,
  Heading,
  List,
  ListRow,
  Notice,
  Panel,
  Spinner,
  Text,
  Toggle,
  type BadgeTone,
  type ScopedTranslator,
} from "@sovereign/ui-kit";

import type { PluginsState } from "./state.ts";

export type PluginsViewProps = {
  state: PluginsState;
  onSwitch: (pluginKey: string, preferences: PluginPreferences) => void;
  translator: ScopedTranslator;
};

/** Тон значка — это смысл состояния, а не его цвет: цвет приходит из схемы (docs/ui-kit.md). */
const stateTones: Record<PluginLifecycleState, BadgeTone> = {
  discovered: "neutral",
  disabled: "neutral",
  refused: "danger",
  installing: "accent",
  starting: "accent",
  running: "success",
  stopping: "neutral",
  stopped: "neutral",
  failed: "danger",
};

export function PluginsView({ state, onSwitch, translator }: PluginsViewProps) {
  const { t } = translator;
  const snapshot = state.snapshot;

  if (snapshot === undefined) {
    return (
      <div className="plugins">
        <Heading level={1}>{t("page.plugins.title")}</Heading>
        {state.failure === undefined ? (
          <Spinner label={t("state.loading")} />
        ) : (
          <Notice tone="danger" title={t("plugins.failed", { reason: state.failure })} />
        )}
      </div>
    );
  }

  return (
    <div className="plugins">
      <Heading level={1}>{t("page.plugins.title")}</Heading>

      {state.stale ? (
        <Notice tone="warning" title={t("plugins.stale.title")}>
          {t("plugins.stale.hint")}
        </Notice>
      ) : undefined}

      {state.failure === undefined ? undefined : (
        <Notice tone="danger" title={t("plugins.write.failed", { reason: state.failure })} />
      )}

      {snapshot.conflicts.length === 0 ? undefined : (
        <Notice tone="warning" title={t("plugins.conflicts.title")}>
          <ul className="plugins-reasons">
            {snapshot.conflicts.map((conflict) => (
              <li key={conflict.id}>
                {t("plugins.conflicts.item", {
                  id: conflict.id,
                  plugins: conflict.plugins.join(", "),
                })}
              </li>
            ))}
          </ul>
        </Notice>
      )}

      {snapshot.plugins.length === 0 ? (
        <EmptyState title={t("plugins.empty")} />
      ) : (
        snapshot.plugins.map((status) => (
          <PluginPanel
            key={status.key}
            status={status}
            snapshot={snapshot}
            onSwitch={onSwitch}
            translator={translator}
          />
        ))
      )}
    </div>
  );
}

type PluginPanelProps = {
  status: PluginStatus;
  snapshot: PluginsSnapshot;
  onSwitch: (pluginKey: string, preferences: PluginPreferences) => void;
  translator: ScopedTranslator;
};

function PluginPanel({ status, snapshot, onSwitch, translator }: PluginPanelProps) {
  const { t } = translator;
  const preferences = snapshot.enablement[status.key];
  const mine = (registration: ContributionRegistration): boolean =>
    registration.pluginKey === status.key;
  const declared = [
    ...snapshot.contributions.filter(mine).map((registration) => ({ registration, off: false })),
    ...snapshot.switchedOffContributions
      .filter(mine)
      .map((registration) => ({ registration, off: true })),
  ].sort((left, right) => (left.registration.id < right.registration.id ? -1 : 1));

  // Запись сохраняется, даже если вклад исчез вместе с версией плагина (docs/plugins.md): человек должен
  // видеть, что решение осталось, а не удивляться ему при возвращении вклада.
  const forgotten = (preferences?.disabledContributions ?? []).filter(
    (id) => !declared.some((entry) => entry.registration.id === id),
  );

  const switchContribution = (id: string, on: boolean): void => {
    if (preferences === undefined) {
      return;
    }

    const rest = preferences.disabledContributions.filter((disabled) => disabled !== id);

    onSwitch(status.key, {
      ...preferences,
      disabledContributions: on ? rest : [...rest, id],
    });
  };

  return (
    <Panel title={status.id ?? status.key}>
      <div className="plugins-plugin">
        <div className="plugins-plugin-head">
          <div className="plugins-plugin-facts">
            <Badge tone={stateTones[status.state]}>{t(`plugins.state.${status.state}`)}</Badge>
            <Code>{status.key}</Code>
            {status.attempt === undefined ? undefined : (
              <Text tone="muted">{t("plugins.attempt", { count: status.attempt })}</Text>
            )}
          </div>
          <Toggle
            checked={preferences?.enabled ?? false}
            disabled={preferences === undefined}
            onChange={(on) =>
              preferences === undefined
                ? undefined
                : onSwitch(status.key, { ...preferences, enabled: on })
            }
            label={t("plugins.toggle.plugin")}
            {...(preferences === undefined ? { hint: t("plugins.toggle.unavailable") } : {})}
          />
        </div>

        <Text tone="muted">
          {t("plugins.directory")}: {status.directory}
        </Text>

        {status.reason === undefined ? undefined : (
          <Notice
            tone={status.state === "refused" || status.state === "failed" ? "danger" : "info"}
            title={t("plugins.reason")}
          >
            <CodeBlock>{status.reason}</CodeBlock>
          </Notice>
        )}

        {status.contributionProblems === undefined ? undefined : (
          <Notice tone="warning" title={t("plugins.problems.title")}>
            <ul className="plugins-reasons">
              {status.contributionProblems.map((problem) => (
                <li key={problem}>{problem}</li>
              ))}
            </ul>
          </Notice>
        )}

        {declared.length === 0 ? (
          <Text tone="muted">{t("plugins.contributions.none")}</Text>
        ) : (
          <>
            <Text tone="muted">{t("plugins.contributions.count", { count: declared.length })}</Text>
            <List>
              {declared.map(({ registration, off }) => (
                <ListRow key={registration.id}>
                  <div className="plugins-contribution">
                    <Toggle
                      checked={!off}
                      disabled={preferences === undefined}
                      onChange={(on) => switchContribution(registration.id, on)}
                      // Без названия подписью служит объявленное имя, а не полный
                      // идентификатор: тот и так стоит рядом.
                      label={registration.title ?? registration.declaredId}
                    />
                    <Badge tone="neutral">{t(`plugins.kind.${registration.kind}`)}</Badge>
                    <Code>{registration.id}</Code>
                    {off ? (
                      <Text tone="warning">{t("plugins.contribution.switchedOff")}</Text>
                    ) : undefined}
                    {registration.kind === "event" ? (
                      <Disclosure summary={t("plugins.payloadSchema")}>
                        <CodeBlock>
                          {JSON.stringify(registration.payloadSchema, undefined, 2)}
                        </CodeBlock>
                      </Disclosure>
                    ) : undefined}
                  </div>
                </ListRow>
              ))}
            </List>
          </>
        )}

        {forgotten.length === 0 ? undefined : (
          <Notice tone="info" title={t("plugins.forgotten.title")}>
            <ul className="plugins-reasons">
              {forgotten.map((id) => (
                <li key={id}>
                  <Code>{id}</Code>
                </li>
              ))}
            </ul>
            {t("plugins.forgotten.hint")}
          </Notice>
        )}
      </div>
    </Panel>
  );
}
