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
  EmptyState,
  Notice,
  SettingsRow,
  Spinner,
  Text,
  Toggle,
  type BadgeTone,
  type ScopedTranslator,
} from "@sovereign/ui-kit";

import { routeAddress, type PluginsState } from "./state.ts";

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

export function PluginsView({ state, onSwitch, onOpen, translator }: PluginsViewProps) {
  const { t } = translator;
  const snapshot = state.snapshot;

  if (snapshot === undefined) {
    return (
      <div className="plugins">
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
      <div className="plugins-notices">
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

        {snapshot.routeConflicts.length === 0 ? undefined : (
          <Notice tone="warning" title={t("plugins.routeConflicts.title")}>
            <ul className="plugins-reasons">
              {snapshot.routeConflicts.map((conflict) => (
                <li key={`${conflict.method} ${conflict.path}`}>
                  {t("plugins.routeConflicts.item", {
                    method: conflict.method,
                    path: conflict.path,
                    contributions: conflict.contributions.join(", "),
                    plugins: conflict.pluginKeys.join(", "),
                  })}
                </li>
              ))}
            </ul>
          </Notice>
        )}

        <PublicRoutes snapshot={snapshot} translator={translator} />
      </div>

      {snapshot.plugins.length === 0 ? (
        <EmptyState title={t("plugins.empty")} />
      ) : (
        <div className="plugins-list" role="list">
          {snapshot.plugins.map((status) => (
            <PluginRow
              key={status.key}
              status={status}
              snapshot={snapshot}
              onSwitch={onSwitch}
              onOpen={onOpen}
              translator={translator}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Публичные маршруты собраны в одном месте, а не разложены по карточкам плагинов: это единственная
 * поверхность платформы, открытая наружу, и человек обязан видеть её целиком (docs/web-api.md).
 *
 * Выключенные вклады сюда не входят: выключенный маршрут не отвечает, и показывать его открытым
 * значило бы пугать тем, чего нет.
 */
function PublicRoutes({
  snapshot,
  translator,
}: {
  snapshot: PluginsSnapshot;
  translator: ScopedTranslator;
}) {
  const { t } = translator;
  const open = snapshot.contributions.filter(
    (registration) =>
      registration.kind === "public-route" &&
      registration.ownership === "plugin" &&
      !snapshot.routeConflicts.some(
        (conflict) =>
          conflict.method === registration.method &&
          conflict.path === routeShape(registration.path) &&
          conflict.contributions.includes(registration.id),
      ),
  );

  if (open.length === 0) {
    return undefined;
  }

  return (
    <Notice tone="warning" title={t("plugins.public.title")}>
      <ul className="plugins-reasons">
        {open.map((registration) =>
          registration.kind !== "public-route" ? undefined : (
            <li
              key={`${registration.source}:${registration.id}:${registration.method}:${registration.path}`}
            >
              {t("plugins.public.item", {
                method: registration.method,
                url: routeAddress(registration),
                plugin: registration.id,
              })}
            </li>
          ),
        )}
      </ul>
      {t("plugins.public.hint")}
    </Notice>
  );
}

function routeShape(path: string): string {
  return path
    .split("/")
    .map((segment) => (segment.startsWith(":") ? ":" : segment))
    .join("/");
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
      size="xs"
      {...(preferences === undefined ? { hint: t("plugins.toggle.unavailable") } : {})}
    />
  );
  const contributions = [...snapshot.contributions, ...snapshot.switchedOffContributions].filter(
    (registration) => registration.ownership === "plugin" && registration.pluginKey === status.key,
  ).length;
  const rowContents = (
    <div className="plugins-row-controls">
      <div className="plugins-row-meta">
        <Badge tone={stateTones[status.state]}>{t(`plugins.state.${status.state}`)}</Badge>
        <Text tone="muted">{t("plugins.contributions.count", { count: contributions })}</Text>
      </div>
      {pluginToggle}
    </div>
  );
  return (
    <div role="listitem">
      {onOpen === undefined ? (
        <SettingsRow
          label={status.id ?? status.key}
          description={<Text tone="muted">{status.key}</Text>}
        >
          {rowContents}
        </SettingsRow>
      ) : (
        <SettingsRow
          label={status.id ?? status.key}
          description={<Text tone="muted">{status.key}</Text>}
          onSelect={() => onOpen(status.key)}
          selectLabel={`${t("plugins.detail.open")} ${status.id ?? status.key}`}
        >
          {rowContents}
        </SettingsRow>
      )}
    </div>
  );
}
