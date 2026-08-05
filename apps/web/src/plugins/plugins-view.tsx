/**
 * Вью управления плагинами. Живёт в ядре, а не в плагине (docs/architecture.md): это единственный
 * путь восстановления системы, и выключить его нельзя.
 *
 * Переключает только человек (docs/plugins.md), и переключается каждый вклад по отдельности (docs/plugins.md).
 * Выключенный вклад показывается помеченным, а не исчезает: иначе включить его обратно было бы
 * нечем.
 */

import type {
  PluginLifecycleState,
  PluginPreferences,
  PluginsSnapshot,
  PluginStatus,
} from "@sovereign/protocol";
import {
  Badge,
  Button,
  EmptyState,
  Heading,
  List,
  ListRow,
  Notice,
  Spinner,
  Text,
  Toggle,
  type BadgeTone,
  type ScopedTranslator,
} from "@sovereign/ui-kit";

import type { PluginsState } from "./state.ts";

export type PluginsViewProps = {
  /** Внутри страницы настроек заголовок раздела уже `h1`; самостоятельное вью по умолчанию владеет им. */
  headingLevel?: 1 | 2;
  state: PluginsState;
  onSwitch: (pluginKey: string, preferences: PluginPreferences) => void;
  onOpen?: (pluginKey: string) => void;
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

export function PluginsView({ headingLevel = 1, state, onSwitch, onOpen, translator }: PluginsViewProps) {
  const { t } = translator;
  const snapshot = state.snapshot;

  if (snapshot === undefined) {
    return (
      <div className="plugins">
        <Heading level={headingLevel}>{t("page.plugins.title")}</Heading>
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
      <Heading level={headingLevel}>{t("page.plugins.title")}</Heading>

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
        <List>
          {snapshot.plugins.map((status) => (
            <PluginRow key={status.key} status={status} snapshot={snapshot} onSwitch={onSwitch} onOpen={onOpen} translator={translator} />
          ))}
        </List>
      )}
    </div>
  );
}

type PluginRowProps = {
  status: PluginStatus;
  snapshot: PluginsSnapshot;
  onSwitch: (pluginKey: string, preferences: PluginPreferences) => void;
  onOpen?: (pluginKey: string) => void;
  translator: ScopedTranslator;
};

function PluginRow({ status, snapshot, onSwitch, onOpen, translator }: PluginRowProps) {
  const { t } = translator;
  const preferences = snapshot.enablement[status.key];
  const pluginToggle = (
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
  );
  const contributions = [
    ...snapshot.contributions,
    ...snapshot.switchedOffContributions,
  ].filter((registration) => registration.ownership === "plugin" && registration.pluginKey === status.key).length;
  return (
    <ListRow>
      <div className="plugins-row">
        <div className="plugins-row-main">
          <Heading level={2}>{status.id ?? status.key}</Heading>
          <Text tone="muted">{status.key}</Text>
        </div>
        <Badge tone={stateTones[status.state]}>{t(`plugins.state.${status.state}`)}</Badge>
        <Text tone="muted">{t("plugins.contributions.count", { count: contributions })}</Text>
        {pluginToggle}
        {onOpen === undefined ? undefined : <Button size="sm" onClick={() => onOpen(status.key)}>{t("plugins.detail.open")}</Button>}
      </div>
    </ListRow>
  );
}
