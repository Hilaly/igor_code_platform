import styles from "./duration-timer.module.css";

export type DurationTimerLabels = {
  days: string;
  hours: string;
  minutes: string;
  seconds: string;
};

export type DurationTimerProps = {
  totalSeconds: number;
  labels: DurationTimerLabels;
  accessibleLabel: string;
  /**
   * `md` — самостоятельное табло: крупные разряды с подписями единиц под ними. `sm` — та же
   * длительность строкой текста, для плотной строки списка, где табло выглядит крупнее всего вокруг.
   */
  size?: "md" | "sm";
};

type DurationPartProps = {
  value: string;
  /** Подписи единиц нет у компактного размера: полное значение остаётся в имени группы. */
  label?: string;
};

function DurationPart({ value, label }: DurationPartProps) {
  return (
    <span className={styles.part}>
      <span className={styles.digits}>{value}</span>
      {label === undefined ? undefined : <span className={styles.label}>{label}</span>}
    </span>
  );
}

function Separator() {
  return (
    <span className={styles.separator} aria-hidden="true">
      :
    </span>
  );
}

export function DurationTimer({
  totalSeconds,
  labels,
  accessibleLabel,
  size = "md",
}: DurationTimerProps) {
  const elapsedSeconds = Number.isFinite(totalSeconds) ? Math.max(0, Math.floor(totalSeconds)) : 0;
  const days = Math.floor(elapsedSeconds / 86_400);
  const hours = Math.floor((elapsedSeconds % 86_400) / 3_600);
  const minutes = Math.floor((elapsedSeconds % 3_600) / 60);
  const seconds = elapsedSeconds % 60;
  const twoDigits = (value: number): string => String(value).padStart(2, "0");
  const unit = (label: string): string | undefined => (size === "sm" ? undefined : label);

  return (
    <div
      className={size === "sm" ? `${styles.timer} ${styles.sm}` : styles.timer}
      role="group"
      aria-label={accessibleLabel}
    >
      <span className={styles.visual} aria-hidden="true">
        {days > 0 ? (
          <>
            <DurationPart value={String(days)} label={unit(labels.days)} />
            <Separator />
          </>
        ) : null}
        <DurationPart value={twoDigits(hours)} label={unit(labels.hours)} />
        <Separator />
        <DurationPart value={twoDigits(minutes)} label={unit(labels.minutes)} />
        <Separator />
        <DurationPart value={twoDigits(seconds)} label={unit(labels.seconds)} />
      </span>
    </div>
  );
}
