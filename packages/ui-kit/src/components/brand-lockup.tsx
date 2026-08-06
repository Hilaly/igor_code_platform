/**
 * Бренд-блок: знак продукта и его название в одной линии. Типографика названия (display-шрифт,
 * акцентный цвет) живёт здесь, потому что дисциплина кита держит визуал-систему у себя, а app-CSS —
 * только раскладку. Снаружи передаётся уже переведённое имя продукта.
 */

import styles from "./brand-lockup.module.css";

import { BrandMark } from "./icons.tsx";

export type BrandLockupProps = {
  /** Уже переведённое название продукта. */
  name: string;
};

export function BrandLockup({ name }: BrandLockupProps): React.JSX.Element {
  return (
    <div className={styles.lockup}>
      <BrandMark size="xl" />
      <span className={styles.name}>{name}</span>
    </div>
  );
}
