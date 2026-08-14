import { BrandMark, type SymbolIconProps } from "./icons.tsx";
import styles from "./orbiting-brand-mark.module.css";

export function OrbitingBrandMark({ size = "md" }: SymbolIconProps): React.JSX.Element {
  return (
    <span className={styles.root} aria-hidden="true">
      <span className={styles.mark}>
        <BrandMark size={size} />
      </span>
      <span className={`${styles.spark} ${styles.trackWarning}`} data-orbit="gold" />
      {/* The marker names describe the approved tracks; CSS still supplies their semantic roles. */}
      {/* eslint-disable-next-line no-restricted-syntax -- track identity is not a color declaration */}
      <span className={`${styles.spark} ${styles.trackSuccess}`} data-orbit="green" />
      {/* eslint-disable-next-line no-restricted-syntax -- track identity is not a color declaration */}
      <span className={`${styles.spark} ${styles.trackDanger}`} data-orbit="red" />
    </span>
  );
}
