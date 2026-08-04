/** Компактная поднятая поверхность без предметной семантики или собственной раскладки. */

import type { ReactNode } from "react";

import styles from "./raised-surface.module.css";

export type RaisedSurfaceProps = {
  children: ReactNode;
};

export function RaisedSurface({ children }: RaisedSurfaceProps) {
  return <div className={styles.surface}>{children}</div>;
}
