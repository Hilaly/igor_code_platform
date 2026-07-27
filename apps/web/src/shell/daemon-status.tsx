/**
 * Низ левой панели: связь с демоном. Виден всегда, потому что без демона интерфейс не делает ничего,
 * и знать об этом надо до того, как нажатие ни к чему не приведёт.
 */

import type { Health } from "@sovereign/protocol";
import { Badge, Text, type BadgeTone, type ScopedTranslator } from "@sovereign/ui-kit";
import { useEffect, useState } from "react";

import type { StreamStatus } from "../events/stream.ts";
import { formatUptime } from "../uptime.ts";

/**
 * Время работы считается от момента старта, а не берётся из ответа: ответ приходит один раз на
 * подъём соединения, и показанное число иначе застывает, продолжая утверждать, что оно живое.
 */
const tickMilliseconds = 10_000;

function useUptimeSeconds(health: Health | undefined): number | undefined {
  const [seconds, setSeconds] = useState<number | undefined>(undefined);

  useEffect(() => {
    if (health === undefined) {
      setSeconds(undefined);

      return;
    }

    const started = new Date(health.startedAt).getTime();
    const recount = (): void => setSeconds(Math.floor((Date.now() - started) / 1000));

    recount();

    const timer = setInterval(recount, tickMilliseconds);

    return () => clearInterval(timer);
  }, [health]);

  return seconds;
}

export type DaemonStatusProps = {
  stream: StreamStatus;
  health: Health | undefined;
  failure: string | undefined;
  translator: ScopedTranslator;
};

const tones: Record<StreamStatus, BadgeTone> = {
  connecting: "neutral",
  open: "success",
  reconnecting: "danger",
};

export function DaemonStatus({ stream, health, failure, translator }: DaemonStatusProps) {
  const { t } = translator;
  const uptimeSeconds = useUptimeSeconds(health);

  return (
    <div className="shell-daemon">
      <div className="shell-daemon-line">
        <Text tone="muted">{t("daemon.title")}</Text>
        <Badge tone={tones[stream]}>{t(`connection.${stream}`)}</Badge>
      </div>
      <Text tone={failure === undefined ? "muted" : "danger"}>
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
    </div>
  );
}
