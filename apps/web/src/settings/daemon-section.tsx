/**
 * Раздел «Демон» страницы настроек. Внизу левой панели те же факты лежат одной строкой — связь видна
 * без перехода на страницу; здесь они развёрнуты: состояние потока, время работы, момент старта и
 * причина, если демон недоступен.
 */

import type { Health } from "@sovereign/protocol";
import {
  Badge,
  DurationTimer,
  SettingsRow,
  type BadgeTone,
  type DurationTimerProps,
  type ScopedTranslator,
} from "@sovereign/ui-kit";

import type { StreamStatus } from "../events/stream.ts";
import { useUptimeSeconds } from "../uptime.ts";
import { formatUptime } from "../uptime.ts";

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
  translator: ScopedTranslator;
};

export function DaemonSection({ stream, health, failure, locale, translator }: DaemonSectionProps) {
  const { t } = translator;
  const uptimeSeconds = useUptimeSeconds(health);
  const timerLabels: DurationTimerProps["labels"] = {
    days: t("duration.days.short"),
    hours: t("duration.hours.short"),
    minutes: t("duration.minutes.short"),
    seconds: t("duration.seconds.short"),
  };

  return (
    <div className="settings-daemon">
      <SettingsRow label={t("daemon.connection")}>
        <Badge tone={tones[stream]}>{t(`connection.${stream}`)}</Badge>
      </SettingsRow>
      <SettingsRow
        label={t("daemon.uptimeLabel")}
        description={
          health === undefined
            ? undefined
            : t("daemon.started", {
                when: new Intl.DateTimeFormat(locale, {
                  dateStyle: "medium",
                  timeStyle: "short",
                }).format(new Date(health.startedAt)),
              })
        }
      >
        {failure === undefined ? (
          uptimeSeconds === undefined ? (
            <span>{t("state.loading")}</span>
          ) : (
            <DurationTimer
              totalSeconds={uptimeSeconds}
              labels={timerLabels}
              accessibleLabel={t("daemon.uptime", {
                duration: formatUptime(uptimeSeconds, {
                  hours: (count) => t("duration.hours", { count }),
                  minutes: (count) => t("duration.minutes", { count }),
                  seconds: (count) => t("duration.seconds", { count }),
                }),
              })}
            />
          )
        ) : (
          <span>{t("daemon.unreachable", { reason: failure })}</span>
        )}
      </SettingsRow>
    </div>
  );
}
