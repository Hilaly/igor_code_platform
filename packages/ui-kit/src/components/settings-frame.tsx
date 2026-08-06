import type { ReactNode } from "react";

import styles from "./settings-frame.module.css";

export type SettingsViewProps = {
  context: ReactNode;
  navigationLabel: string;
  navigation: ReactNode;
  children: ReactNode;
};

/** Compact master-detail surface shared by every nested Settings route. */
export function SettingsView({
  context,
  navigationLabel,
  navigation,
  children,
}: SettingsViewProps) {
  return (
    <div className={styles.view}>
      <header className={styles.context}>{context}</header>
      <div className={styles.body}>
        <nav className={styles.navigation} aria-label={navigationLabel}>
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
  children: ReactNode;
};

/** Owns the single document heading and the scrollable body of a Settings route. */
export function SettingsPage({ title, description, children }: SettingsPageProps) {
  return (
    <section className={styles.page} aria-labelledby="settings-page-title">
      <header className={styles.pageHeader}>
        <h1 className={styles.pageTitle} id="settings-page-title">
          {title}
        </h1>
        {description === undefined ? undefined : (
          <p className={styles.pageDescription}>{description}</p>
        )}
      </header>
      <div className={styles.pageBody}>{children}</div>
    </section>
  );
}

export type SettingsRowProps = {
  label: ReactNode;
  description?: ReactNode;
  children: ReactNode;
};

/** A mockup-aligned property row: explanation on the left, control or value on the right. */
export function SettingsRow({ label, description, children }: SettingsRowProps) {
  return (
    <div
      className={styles.row}
      role="group"
      aria-label={typeof label === "string" ? label : undefined}
    >
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
