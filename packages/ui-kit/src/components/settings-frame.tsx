import type { ReactNode } from "react";

import styles from "./settings-frame.module.css";

export type SettingsFrameProps = {
  context: ReactNode;
  settingsLabel: string;
  navigationLabel?: string;
  navigation: ReactNode;
  children: ReactNode;
};

/** Shared flat master-detail frame for administrative settings views. */
export function SettingsFrame({
  context,
  settingsLabel,
  navigationLabel = settingsLabel,
  navigation,
  children,
}: SettingsFrameProps) {
  return (
    <div className={styles.frame}>
      <header className={styles.context}>{context}</header>
      <div className={styles.body}>
        <aside className={styles.sidebar}>
          <span className={styles.label}>{settingsLabel}</span>
          <nav className={styles.navigation} aria-label={navigationLabel}>
            {navigation}
          </nav>
        </aside>
        <div className={styles.content}>{children}</div>
      </div>
    </div>
  );
}
