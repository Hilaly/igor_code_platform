/**
 * Значок состояния: состояние плагина, состояние соединения. Тон — роль, а не цвет; сам текст
 * приходит переведённым, потому что кит не знает, в каком неймспейсе лежит эта строка.
 */

export type BadgeTone = "neutral" | "accent" | "success" | "warning" | "danger";

export type BadgeProps = {
  tone: BadgeTone;
  children: string;
};

export function Badge({ tone, children }: BadgeProps) {
  return <span className={`sv-badge sv-badge-${tone}`}>{children}</span>;
}
