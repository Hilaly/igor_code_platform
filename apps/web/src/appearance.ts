/**
 * Выбор цветовой схемы, варианта и локали. Источник истины — `preferences.json` в директории данных
 * (docs/data-directory.md): интерфейс читает и пишет его через `/api/preferences`.
 *
 * Выбранное дополнительно кешируется в браузере, чтобы при загрузке не мигать чужой темой
 * (docs/ui-kit.md): ответ демона приходит позже первой отрисовки.
 */

import {
  applyRoles,
  baseScheme,
  resolveScheme,
  shippedSchemes,
  type ColorScheme,
  type PaletteVariant,
  type StyleTarget,
} from "@sovereign/ui-kit";
import {
  defaultAppearance,
  baseLocale,
  preferencesPath,
  type AppearancePreferences,
  type AppearanceVariant,
} from "@sovereign/protocol";

/** Схемы поставки перечисляет кит: он же их и объявляет (docs/ui-kit.md). */
export { shippedSchemes };

export const defaultAppearancePreferences: AppearancePreferences = {
  appearance: defaultAppearance,
  locale: baseLocale,
};

export const appearanceCacheKey = "sovereign.appearance";

/** Ровно то, что нужно от `localStorage`: остальное в тесты тащить незачем. */
export type PreferencesCache = {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
};

export function readCachedAppearance(cache: PreferencesCache): AppearancePreferences | undefined {
  const stored = cache.getItem(appearanceCacheKey);

  if (stored === null) {
    return undefined;
  }

  try {
    // Кеш — наша же запись, но пережившая обновление платформы: разбирать его надо как чужой ввод.
    const parsed = JSON.parse(stored) as Partial<AppearancePreferences>;
    const appearance = parsed.appearance;

    if (appearance === undefined || typeof parsed.locale !== "string") {
      return undefined;
    }

    return { appearance, locale: parsed.locale };
  } catch {
    return undefined;
  }
}

export function cacheAppearance(cache: PreferencesCache, value: AppearancePreferences): void {
  cache.setItem(appearanceCacheKey, JSON.stringify(value));
}

/** «Системный» вариант — это не третья палитра, а выбор одной из двух (docs/ui-kit.md). */
export function resolveVariant(variant: AppearanceVariant, prefersDark: boolean): PaletteVariant {
  if (variant === "system") {
    return prefersDark ? "dark" : "light";
  }

  return variant;
}

export type ApplyAppearanceOptions = {
  preferences: AppearancePreferences;
  prefersDark: boolean;
  target: StyleTarget;
  schemes?: readonly ColorScheme[];
  onDiagnostic: (diagnostic: string) => void;
};

/**
 * Применяет схему записью CSS-переменных. Названная схема может отсутствовать — её приносил плагин,
 * которого выключили (docs/plugins.md), — и тогда работает встроенная: интерфейс без цветов не остаётся.
 */
export function applyAppearance(options: ApplyAppearanceOptions): void {
  const schemes = options.schemes ?? shippedSchemes;
  const wanted = options.preferences.appearance.colorScheme;
  const found = schemes.find((scheme) => scheme.id === wanted);

  if (found === undefined) {
    options.onDiagnostic(`there is no colour scheme ${wanted}, the built-in one is in effect`);
  }

  const variant = resolveVariant(options.preferences.appearance.variant, options.prefersDark);
  const resolved = resolveScheme(found ?? baseScheme, variant);

  if (resolved.kind === "rejected") {
    for (const diagnostic of resolved.diagnostics) {
      options.onDiagnostic(diagnostic);
    }

    // Отказ схемы не оставляет интерфейс без цветов: встроенная схема всегда совпадает с китом.
    const fallback = resolveScheme(baseScheme, variant);

    if (fallback.kind === "resolved") {
      applyRoles(fallback.roles, options.target);
    }

    return;
  }

  for (const diagnostic of resolved.diagnostics) {
    options.onDiagnostic(diagnostic);
  }

  applyRoles(resolved.roles, options.target);
}

export async function fetchAppearance(): Promise<AppearancePreferences> {
  const response = await fetch(preferencesPath);

  if (!response.ok) {
    throw new Error(`the daemon answered ${response.status}`);
  }

  return (await response.json()) as AppearancePreferences;
}

export async function writeAppearance(
  preferences: AppearancePreferences,
): Promise<AppearancePreferences> {
  const response = await fetch(preferencesPath, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(preferences),
  });

  if (!response.ok) {
    const failure = (await response.json()) as { error?: string };

    throw new Error(failure.error ?? `the daemon answered ${response.status}`);
  }

  return (await response.json()) as AppearancePreferences;
}
