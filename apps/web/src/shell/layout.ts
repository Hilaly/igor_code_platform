/**
 * Раскладка хоста: ширины панелей и открытая вкладка. Живёт локально в браузере, а не в директории
 * данных — это уровень «раскладка хоста» из модели расширения (ui-extension-model.md), и делить её
 * между машинами незачем.
 */

export const shellTabs = ["appearance", "diagnostics"] as const;

export type ShellTab = (typeof shellTabs)[number];

export type ShellLayout = {
  leftWidth: number;
  rightWidth: number;
  /** Открытой вкладки может не быть: правая панель закрывается целиком. */
  openTab: ShellTab | undefined;
};

export const layoutStorageKey = "sovereign.layout";

export const defaultLayout: ShellLayout = {
  leftWidth: 260,
  rightWidth: 320,
  openTab: "appearance",
};

/** Пределы: панель, утянутая в ноль, из интерфейса уже не возвращается. */
export const panelWidthLimits = { minimum: 180, maximum: 560 };

export type LayoutStorage = {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
};

export function clampPanelWidth(width: number): number {
  if (!Number.isFinite(width)) {
    return defaultLayout.leftWidth;
  }

  return Math.min(panelWidthLimits.maximum, Math.max(panelWidthLimits.minimum, Math.round(width)));
}

/** Испорченная запись не роняет оболочку: раскладка — удобство, а не состояние предметной области. */
export function readLayout(storage: LayoutStorage): ShellLayout {
  const stored = storage.getItem(layoutStorageKey);

  if (stored === null) {
    return defaultLayout;
  }

  try {
    const parsed = JSON.parse(stored) as Partial<ShellLayout>;

    return {
      leftWidth: clampPanelWidth(parsed.leftWidth ?? defaultLayout.leftWidth),
      rightWidth: clampPanelWidth(parsed.rightWidth ?? defaultLayout.rightWidth),
      openTab: shellTabs.includes(parsed.openTab as ShellTab) ? parsed.openTab : undefined,
    };
  } catch {
    return defaultLayout;
  }
}

export function writeLayout(storage: LayoutStorage, layout: ShellLayout): void {
  storage.setItem(layoutStorageKey, JSON.stringify(layout));
}
