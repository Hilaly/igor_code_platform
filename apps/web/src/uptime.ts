/**
 * Сколько демон работает, словами. Единицы приходят переведёнными, а не пишутся здесь: язык
 * переключается на живой странице, и «мин» посреди английской строки — это ровно то, что видит
 * пользователь (docs/ui-kit.md).
 */

export type DurationUnits = {
  /** Каждая единица — уже переведённое сообщение с подставленным числом. */
  hours: (count: number) => string;
  minutes: (count: number) => string;
  seconds: (count: number) => string;
};

export type FullDurationUnits = DurationUnits & {
  days: (count: number) => string;
};

export function formatUptime(totalSeconds: number, units: DurationUnits): string {
  if (totalSeconds < 60) {
    return units.seconds(totalSeconds);
  }

  const minutes = Math.floor(totalSeconds / 60);

  if (minutes < 60) {
    return `${units.minutes(minutes)} ${units.seconds(totalSeconds % 60)}`;
  }

  // Секунды на этом масштабе не сообщают ничего, кроме дребезга при каждой перерисовке.
  return `${units.hours(Math.floor(minutes / 60))} ${units.minutes(minutes % 60)}`;
}

/** Полное доступное имя цифрового таймера: ни одна видимая единица не теряется при тике. */
export function formatFullUptime(totalSeconds: number, units: FullDurationUnits): string {
  const elapsedSeconds = Math.max(0, Math.floor(totalSeconds));
  const days = Math.floor(elapsedSeconds / 86_400);
  const hours = Math.floor((elapsedSeconds % 86_400) / 3_600);
  const minutes = Math.floor((elapsedSeconds % 3_600) / 60);
  const seconds = elapsedSeconds % 60;

  if (days > 0) {
    return `${units.days(days)} ${units.hours(hours)} ${units.minutes(minutes)} ${units.seconds(seconds)}`;
  }

  if (hours > 0) {
    return `${units.hours(hours)} ${units.minutes(minutes)} ${units.seconds(seconds)}`;
  }

  if (minutes > 0) {
    return `${units.minutes(minutes)} ${units.seconds(seconds)}`;
  }

  return units.seconds(seconds);
}
import type { Health } from "@sovereign/protocol";
import { useEffect, useState } from "react";

const tickMilliseconds = 1_000;

/** Живое время работы для подробного раздела демона; компактный sidebar его не показывает. */
export function useUptimeSeconds(health: Health | undefined): number | undefined {
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
