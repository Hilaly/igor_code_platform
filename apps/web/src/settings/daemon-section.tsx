/**
 * Раздел «Демон» страницы настроек. Внизу левой панели те же факты лежат одной строкой — связь видна
 * без перехода на страницу; здесь они развёрнуты: состояние потока, время работы, момент старта и
 * причина, если демон недоступен.
 *
 * Конфиг демона живёт здесь же, а не отдельным разделом: это настройки того самого демона, о котором
 * раздел и рассказывает, и разводить их по двум страницам значило бы прятать половину предмета.
 */

import type { Config, Health } from "@sovereign/protocol";
import { Badge, SettingsRow, type BadgeTone, type ScopedTranslator } from "@sovereign/ui-kit";

import type { StreamStatus } from "../events/stream.ts";
import { useUptimeSeconds } from "../uptime.ts";
import { formatUptime } from "../uptime.ts";
import { ConfigForm } from "./config-form.tsx";
import type { ConfigState } from "./use-config.ts";

const tones: Record<StreamStatus, BadgeTone> = {
  connecting: "neutral",
  open: "success",
  reconnecting: "danger",
};

export type DaemonSectionProps = {
  stream: StreamStatus;
  health: Health | undefined;
  failure: string | undefined;
  /** Локаль интерфейса: момент старта показывается локализованной датой, а не сырой ISO-строкой. */
  locale: string;
  config: ConfigState;
  onSaveConfig: (config: Config) => void;
  translator: ScopedTranslator;
};

export function DaemonSection({
  stream,
  health,
  failure,
  locale,
  config,
  onSaveConfig,
  translator,
}: DaemonSectionProps) {
  const { t } = translator;
  const uptimeSeconds = useUptimeSeconds(health);

  return (
    <div className="settings-daemon">
      <SettingsRow label={t("daemon.connection")}>
        <Badge tone={tones[stream]}>{t(`connection.${stream}`)}</Badge>
      </SettingsRow>
      <SettingsRow label={t("daemon.uptimeLabel")}>
        <span>
          {failure === undefined
            ? uptimeSeconds === undefined
              ? t("state.loading")
              : t("daemon.uptime", {
                  duration: formatUptime(uptimeSeconds, {
                    hours: (count) => t("duration.hours", { count }),
                    minutes: (count) => t("duration.minutes", { count }),
                    seconds: (count) => t("duration.seconds", { count }),
                  }),
                })
            : t("daemon.unreachable", { reason: failure })}
        </span>
      </SettingsRow>
      {health === undefined ? undefined : (
        <SettingsRow label={t("daemon.startedLabel")}>
          <span>
            {t("daemon.started", {
              when: new Intl.DateTimeFormat(locale, {
                dateStyle: "medium",
                timeStyle: "short",
              }).format(new Date(health.startedAt)),
            })}
          </span>
        </SettingsRow>
      )}
      <ConfigForm state={config} onSave={onSaveConfig} translator={translator} />
    </div>
  );
}
