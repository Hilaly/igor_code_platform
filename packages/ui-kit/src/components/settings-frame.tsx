import { useId, type ReactNode } from "react";

import styles from "./settings-frame.module.css";

export type SettingsViewProps = {
  context: ReactNode;
  /** Visible eyebrow; the navigation's accessible name may be more descriptive. */
  navigationTitle?: ReactNode;
  navigationLabel: string;
  navigation: ReactNode;
  children: ReactNode;
};

/** Compact master-detail surface shared by every nested Settings route. */
export function SettingsView({
  context,
  navigationTitle,
  navigationLabel,
  navigation,
  children,
}: SettingsViewProps) {
  return (
    <div className={styles.view}>
      <header className={styles.context}>{context}</header>
      <div className={styles.body}>
        <nav className={styles.navigation} aria-label={navigationLabel}>
          <div className={styles.navigationHeader}>{navigationTitle ?? navigationLabel}</div>
          <div className={styles.navigationItems}>{navigation}</div>
        </nav>
        <main className={styles.content}>{children}</main>
      </div>
    </div>
  );
}

export type SettingsNavigationItemProps = {
  selected: boolean;
  onSelect: () => void;
  children: ReactNode;
};

/** One dense local route in Settings; selection is a filled surface, not an outlined card. */
export function SettingsNavigationItem({
  selected,
  onSelect,
  children,
}: SettingsNavigationItemProps) {
  return (
    <button
      className={`${styles.navigationItem}${selected ? ` ${styles.navigationItemSelected}` : ""}`}
      type="button"
      aria-current={selected ? "page" : undefined}
      onClick={onSelect}
    >
      {children}
    </button>
  );
}

export type SettingsPageProps = {
  title: ReactNode;
  description?: ReactNode;
  /** Standalone Settings pages own the document heading; embedded pages are subordinate to shell. */
  headingLevel?: 1 | 2 | 3 | "none";
  children: ReactNode;
};

/** Owns the single document heading and the scrollable body of a Settings route. */
export function SettingsPage({
  title,
  description,
  headingLevel = 1,
  children,
}: SettingsPageProps) {
  const titleId = useId();
  const heading =
    headingLevel === 1 ? (
      <h1 className={styles.pageTitle} id={titleId}>
        {title}
      </h1>
    ) : headingLevel === 2 ? (
      <h2 className={styles.pageTitle} id={titleId}>
        {title}
      </h2>
    ) : headingLevel === 3 ? (
      <h3 className={styles.pageTitle} id={titleId}>
        {title}
      </h3>
    ) : (
      <span className={styles.pageLabel} id={titleId}>
        {title}
      </span>
    );

  return (
    <section className={styles.page} aria-labelledby={titleId}>
      <header className={styles.pageHeader}>
        {heading}
        {description === undefined ? undefined : (
          <p className={styles.pageDescription}>{description}</p>
        )}
      </header>
      <div className={styles.pageBody}>{children}</div>
    </section>
  );
}

type SettingsRowSelection =
  | { onSelect?: undefined; selectLabel?: never }
  | {
      onSelect: () => void;
      /** Accessible name of the full-row selection target. */
      selectLabel: string;
    };

export type SettingsRowProps = {
  label: ReactNode;
  description?: ReactNode;
  children: ReactNode;
} & SettingsRowSelection;

/** A mockup-aligned property row: explanation on the left, control or value on the right. */
export function SettingsRow({
  label,
  description,
  children,
  onSelect,
  selectLabel,
}: SettingsRowProps) {
  return (
    <div
      className={`${styles.row}${onSelect === undefined ? "" : ` ${styles.rowSelectable}`}`}
      role="group"
      aria-label={typeof label === "string" ? label : undefined}
    >
      {onSelect === undefined ? undefined : (
        <button
          type="button"
          className={styles.rowSelect}
          onClick={onSelect}
          aria-label={selectLabel}
        />
      )}
      <div className={styles.rowCopy}>
        <div className={styles.rowLabel}>{label}</div>
        {description === undefined ? undefined : (
          <div className={styles.rowDescription}>{description}</div>
        )}
      </div>
      <div className={styles.rowControl}>{children}</div>
    </div>
  );
}
