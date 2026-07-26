export function formatUptime(seconds: number): string {
  if (seconds < 60) {
    return `${seconds} с`;
  }

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes} мин ${seconds % 60} с`;
  }

  const hours = Math.floor(minutes / 60);
  return `${hours} ч ${minutes % 60} мин`;
}
