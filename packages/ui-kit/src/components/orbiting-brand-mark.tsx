import { BrandMark, type SymbolIconProps } from "./icons.tsx";
import styles from "./orbiting-brand-mark.module.css";

export function OrbitingBrandMark({ size = "md" }: SymbolIconProps): React.JSX.Element {
  return (
    <span className={styles.root} aria-hidden="true">
      <span className={styles.mark}>
        <BrandMark size={size} />
      </span>
      <span className={`${styles.spark} ${styles.gold}`} data-orbit="gold" />
      <span className={`${styles.spark} ${styles.green}`} data-orbit="green" />
      <span className={`${styles.spark} ${styles.red}`} data-orbit="red" />
    </span>
  );
}
