import type {
  ContributionRegistration,
  PluginLifecycleState,
  PluginPreferences,
  PluginsSnapshot,
  PluginStatus,
} from "@sovereign/protocol";
import {
  Badge,
  Button,
  Code,
  CodeBlock,
  Disclosure,
  EmptyState,
  Heading,
  Notice,
  SettingsRow,
  Spinner,
  Text,
  Toggle,
  type BadgeTone,
  type ScopedTranslator,
} from "@sovereign/ui-kit";

import { routeAddress, type PluginsState } from "./state.ts";

export type PluginDetailViewProps = {
  headingLevel?: 1 | 2;
  state: PluginsState;
  pluginKey: string;
  onBack: () => void;
  onSwitch: (pluginKey: string, preferences: PluginPreferences) => void;
  translator: ScopedTranslator;
};

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

type ContributionEntry = { registration: ContributionRegistration; off: boolean };

export function PluginDetailView({
  state,
  pluginKey,
  onBack,
  onSwitch,
  translator,
}: PluginDetailViewProps) {
  const { t } = translator;
  const snapshot = state.snapshot;

  if (snapshot === undefined) {
    return (
      <div className="plugin-detail">
        <Button onClick={onBack}>{t("plugins.detail.back")}</Button>
        {state.failure === undefined ? (
          <Spinner label={t("state.loading")} />
        ) : (
          <Notice tone="danger" title={t("plugins.failed", { reason: state.failure })} />
        )}
      </div>
    );
  }

  const status = snapshot.plugins.find((plugin) => plugin.key === pluginKey);
  if (status === undefined) {
    return (
      <div className="plugin-detail">
        <Button onClick={onBack}>{t("plugins.detail.back")}</Button>
        <EmptyState title={t("plugins.detail.notfound", { key: pluginKey })} />
      </div>
    );
  }

  const preferences = snapshot.enablement[status.key];
  const declared = contributionsFor(snapshot, status);
  const forgotten = (preferences?.disabledContributions ?? []).filter(
    (id) => !declared.some((entry) => entry.registration.id === id),
  );

  const switchContribution = (id: string, on: boolean): void => {
    if (preferences === undefined) return;
    const disabled = preferences.disabledContributions.filter((disabledId) => disabledId !== id);
    onSwitch(status.key, {
      ...preferences,
      disabledContributions: on ? disabled : [...disabled, id],
    });
  };

  return (
    <div className="plugin-detail">
      <div className="plugin-detail-back">
        <Button onClick={onBack}>{t("plugins.detail.back")}</Button>
      </div>

      <section className="plugin-detail-header-card" aria-label={status.id ?? status.key}>
        <SettingsRow label={status.id ?? status.key} description={<Code>{status.key}</Code>}>
          <Toggle
            checked={preferences?.enabled ?? false}
            disabled={preferences === undefined}
            onChange={(enabled) =>
              preferences === undefined
                ? undefined
                : onSwitch(status.key, { ...preferences, enabled })
            }
            label={t("plugins.toggle.plugin")}
            labelDisplay="tooltip"
            {...(preferences === undefined ? { hint: t("plugins.toggle.unavailable") } : {})}
          />
        </SettingsRow>
      </section>

      <section className="plugin-detail-section" aria-label={t("plugins.detail.plugin")}>
        <Heading level={3}>{t("plugins.detail.plugin")}</Heading>
        <div className="plugin-detail-rows">
          <SettingsRow label={t("plugins.detail.lifecycle")}>
            <Badge tone={stateTones[status.state]}>{t(`plugins.state.${status.state}`)}</Badge>
          </SettingsRow>
          <SettingsRow label={t("plugins.detail.source")}>
            <Text>
              {status.source === "builtin" ? t("plugins.source.builtin") : t("plugins.source.data")}
            </Text>
          </SettingsRow>
          <SettingsRow label={t("plugins.detail.path")}>
            <Code>{status.directory}</Code>
          </SettingsRow>
          {status.attempt === undefined ? undefined : (
            <SettingsRow label={t("plugins.detail.attempt")}>
              <Text>{String(status.attempt)}</Text>
            </SettingsRow>
          )}
        </div>
      </section>

      {status.reason === undefined && status.contributionProblems === undefined ? undefined : (
        <Notice
          tone={status.state === "refused" || status.state === "failed" ? "danger" : "warning"}
          title={status.reason === undefined ? t("plugins.problems.title") : t("plugins.reason")}
        >
          {status.reason === undefined ? (
            <ul className="plugins-reasons">
              {status.contributionProblems?.map((problem) => (
                <li key={problem}>{problem}</li>
              ))}
            </ul>
          ) : (
            <CodeBlock>{status.reason}</CodeBlock>
          )}
        </Notice>
      )}

      <section
        className="plugin-detail-section"
        aria-label={`${t("plugins.detail.contributions")} · ${declared.length}`}
      >
        <Heading level={3}>
          {t("plugins.detail.contributions")} · {declared.length}
        </Heading>
        {declared.length === 0 ? (
          <Text tone="muted">{t("plugins.contributions.none")}</Text>
        ) : (
          <div className="plugin-detail-contributions" role="list">
            {declared.map(({ registration, off }) => (
              <div role="listitem" key={registration.id}>
                <SettingsRow
                  label={registration.title ?? registration.declaredId}
                  description={
                    <div className="plugin-detail-contribution-meta">
                      <Badge tone="neutral">{t(`plugins.kind.${registration.kind}`)}</Badge>
                      <Code>{registration.id}</Code>
                      {off ? (
                        <Text tone="warning">{t("plugins.contribution.switchedOff")}</Text>
                      ) : undefined}
                    </div>
                  }
                >
                  <div className="plugin-detail-contribution-controls">
                    <TechnicalData registration={registration} translator={translator} />
                    <Toggle
                      checked={!off}
                      disabled={preferences === undefined}
                      onChange={(on) => switchContribution(registration.id, on)}
                      label={registration.title ?? registration.declaredId}
                      labelDisplay="tooltip"
                    />
                  </div>
                </SettingsRow>
              </div>
            ))}
          </div>
        )}
      </section>

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
  );
}

function contributionsFor(snapshot: PluginsSnapshot, status: PluginStatus): ContributionEntry[] {
  const mine = (registration: ContributionRegistration): boolean =>
    registration.ownership === "plugin" && registration.pluginKey === status.key;
  return [
    ...snapshot.contributions.filter(mine).map((registration) => ({ registration, off: false })),
    ...snapshot.switchedOffContributions
      .filter(mine)
      .map((registration) => ({ registration, off: true })),
  ].sort((left, right) => left.registration.id.localeCompare(right.registration.id));
}

function TechnicalData({
  registration,
  translator,
}: {
  registration: ContributionRegistration;
  translator: ScopedTranslator;
}) {
  const { t } = translator;
  const data =
    registration.kind === "event"
      ? registration.payloadSchema
      : registration.kind === "custom"
        ? registration.payload
        : registration.kind === "tool"
          ? registration.parameters
          : registration.kind === "hook"
            ? { event: registration.event, criticality: registration.criticality }
            : registration.kind === "route" || registration.kind === "public-route"
              ? // Адрес целиком, а не объявленный путь: по нему маршрут и зовут снаружи.
                {
                  method: registration.method,
                  path: registration.path,
                  url: routeAddress(registration),
                }
              : registration.kind === "skill"
                ? {
                    location: registration.location,
                    disableModelInvocation: registration.disableModelInvocation,
                    metadata: registration.metadata,
                  }
                : registration.kind === "color-scheme"
                  ? registration.scheme
                  : registration.kind === "locale-catalog"
                    ? // Сами сообщения не показываются: сотни строк в блоке кода — шум, а не данные.
                      {
                        namespace: registration.namespace,
                        locale: registration.locale,
                        messages: Object.keys(registration.messages).length,
                      }
                    : {
                        model: registration.model,
                        thinkingLevel: registration.thinkingLevel,
                        tools: registration.tools,
                        skills: registration.skills,
                      };
  if (data === undefined) return undefined;
  return (
    <Disclosure
      summary={
        registration.kind === "event" ? t("plugins.payloadSchema") : t("plugins.detail.technical")
      }
    >
      <CodeBlock>{JSON.stringify(data, undefined, 2) ?? "—"}</CodeBlock>
    </Disclosure>
  );
}
