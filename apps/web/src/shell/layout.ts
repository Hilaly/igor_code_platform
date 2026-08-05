/**
 * Раскладка хоста: ширины панелей и открытая вкладка. Живёт локально в браузере, а не в директории
 * данных — это уровень «раскладка хоста» из модели расширения (ui-extension-model.md), и делить её
 * между машинами незачем.
 */

export type ShellLayout = {
  leftWidth: number;
  rightWidth: number;
  /**
   * Идентификатор открытой вкладки правой панели. До среза 12 вкладки приносят плагины, поэтому список
   * открыт — это `string`, а не закрытый тип ядра. Проверку «такая вкладка есть» делает сама оболочка
   * (`tabs.find(...)`): ядро знает только то, что идентификатор — строка.
   */
  openTab: string | undefined;
  /** Спрятана ли панель человеком. Скрытая панель не рисуется вовсе — вместе с её границей-ресайзером. */
  leftHidden: boolean;
  rightHidden: boolean;
};

export const layoutStorageKey = "sovereign.layout";

export const defaultLayout: ShellLayout = {
  leftWidth: 260,
  rightWidth: 320,
  // По умолчанию правая панель скрыта: вкладок ядра у неё больше нет, а плагины принесут свои в срезе 12.
  openTab: undefined,
  leftHidden: false,
  rightHidden: true,
};

/** Минимум: панель, утянутую в ноль, из интерфейса уже не возвращается. */
export const panelWidthLimits = { minimum: 160 };
export const shellCenterMinimumWidth = 320;
export const shellResizerWidth = 5;

export type LayoutStorage = {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
};

export function maximumPanelWidth(viewportWidth: number, oppositePanelWidth = 0): number {
  const visibleResizerCount = oppositePanelWidth > 0 ? 2 : 1;

  return Math.max(
    panelWidthLimits.minimum,
    Math.floor(
      viewportWidth -
        oppositePanelWidth -
        shellCenterMinimumWidth -
        shellResizerWidth * visibleResizerCount,
    ),
  );
}

export function clampPanelWidth(width: number, maximum = Number.POSITIVE_INFINITY): number {
  if (!Number.isFinite(width)) {
    return defaultLayout.leftWidth;
  }

  return Math.min(maximum, Math.max(panelWidthLimits.minimum, Math.round(width)));
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
      // Строка или ничего: вкладки, которую знает ядро, больше нет, а неизвестную открывает лишь та
      // оболочка, у которой она реально есть.
      openTab: typeof parsed.openTab === "string" ? parsed.openTab : undefined,
      leftHidden: parsed.leftHidden === true,
      rightHidden: parsed.rightHidden === true,
    };
  } catch {
    return defaultLayout;
  }
}

export function writeLayout(storage: LayoutStorage, layout: ShellLayout): void {
  storage.setItem(layoutStorageKey, JSON.stringify(layout));
}
