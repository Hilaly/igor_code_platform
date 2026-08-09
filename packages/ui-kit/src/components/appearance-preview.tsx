import styles from "./appearance-preview.module.css";

export type AppearancePreviewSwatchRole = "surface" | "accent" | "secondary" | "text";

export type AppearancePreviewSwatch = {
  role: AppearancePreviewSwatchRole;
  label: string;
};

export type AppearancePreviewProps = {
  title: string;
  /** Complete accessible name, including the currently controlled appearance values. */
  label: string;
  scheme: string;
  variant: string;
  scale: string;
  swatches: readonly AppearancePreviewSwatch[];
};

/** Live role-based sample of an appearance without duplicating scheme values in application CSS. */
export function AppearancePreview({
  title,
  label,
  scheme,
  variant,
  scale,
  swatches,
}: AppearancePreviewProps) {
  return (
    <section className={styles.preview} aria-label={label} aria-live="polite">
      <div className={styles.header}>
        <div className={styles.identity}>
          <span className={styles.eyebrow}>{title}</span>
          <h3 className={styles.title}>{scheme}</h3>
        </div>
        <span className={styles.meta}>
          {variant} · {scale}
        </span>
      </div>
      <ul className={styles.swatches}>
        {swatches.map((swatch) => (
          <li className={styles.swatchItem} key={swatch.role}>
            <span className={`${styles.swatch} ${styles[swatch.role]}`} aria-hidden="true" />
            <span className={styles.swatchLabel}>{swatch.label}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
