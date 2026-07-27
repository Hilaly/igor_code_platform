/**
 * Сколько демон работает, словами. Единицы приходят переведёнными, а не пишутся здесь: язык
 * переключается на живой странице, и «мин» посреди английской строки — это ровно то, что видит
 * пользователь (ADR-0028).
 */

export type DurationUnits = {
  /** Каждая единица — уже переведённое сообщение с подставленным числом. */
  hours: (count: number) => string;
  minutes: (count: number) => string;
  seconds: (count: number) => string;
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
