/**
 * Раздел «Демон» страницы настроек. Внизу левой панели те же факты лежат одной строкой — связь видна
 * без перехода на страницу; здесь они развёрнуты: состояние потока, время работы, момент старта и
 * причина, если демон недоступен.
 */

import type { Health } from "@sovereign/protocol";
import { Badge, Text, type BadgeTone, type ScopedTranslator } from "@sovereign/ui-kit";

import type { StreamStatus } from "../events/stream.ts";
import { useUptimeSeconds } from "../shell/daemon-status.tsx";
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

  return (
    <div className="settings-daemon">
      <div className="settings-daemon-line">
        <Text tone="muted">{t("daemon.connection")}</Text>
        <Badge tone={tones[stream]}>{t(`connection.${stream}`)}</Badge>
      </div>
      <Text tone="muted">
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
      </Text>
      {health === undefined ? undefined : (
        <Text tone="muted">
          {t("daemon.started", {
            when: new Intl.DateTimeFormat(locale, {
              dateStyle: "medium",
              timeStyle: "short",
            }).format(new Date(health.startedAt)),
          })}
        </Text>
      )}
    </div>
  );
}
