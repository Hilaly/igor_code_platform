/**
 * Выбор цветовой схемы, варианта, масштаба и локали. Источник истины — `preferences.json` в директории данных
 * (docs/data-directory.md): интерфейс читает и пишет его через `/api/preferences`.
 *
 * Выбранное дополнительно кешируется в браузере, чтобы при загрузке не мигать чужой темой
 * (docs/ui-kit.md): ответ демона приходит позже первой отрисовки.
 */

import {
  applyRoles,
  applyScale,
  imperiumScheme,
  parseColorScheme,
  resolveScheme,
  shippedSchemes,
  type ColorScheme,
  type PaletteVariant,
  type ScaleTarget,
  type StyleTarget,
  type Translator,
} from "@sovereign/ui-kit";
import {
  defaultAppearance,
  baseLocale,
  isInterfaceScale,
  preferencesPath,
  type AppearancePreferences,
  type AppearanceVariant,
  type ContributionRegistration,
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

    // Масштаба могло не быть в кеше, записанном платформой, которая про него не знала. Это не повод
    // выбросить кеш целиком: тогда страница мигнёт чужой темой ради поля со значением по умолчанию.
    const scale = isInterfaceScale(appearance.scale) ? appearance.scale : defaultAppearance.scale;

    return { appearance: { ...appearance, scale }, locale: parsed.locale };
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
  /** Куда пишутся CSS-переменные ролей: стиль корня документа. */
  target: StyleTarget;
  /** Куда ставится атрибут масштаба: сам корень документа, а не его стиль. */
  root: ScaleTarget;
  schemes?: readonly ColorScheme[];
  onDiagnostic: (diagnostic: string) => void;
};

export type EffectiveAppearance = {
  scheme: ColorScheme;
  variant: PaletteVariant;
  resolution: ReturnType<typeof resolveScheme>;
  diagnostics: string[];
};

/**
 * Разделяет сохранённое пожелание и реально применимую схему. Пожелание не переписывается: если
 * плагин вернётся, его id снова начнёт работать; результат нужен и применению ролей, и live preview.
 */
export function resolveEffectiveAppearance(
  preferences: AppearancePreferences,
  prefersDark: boolean,
  schemes: readonly ColorScheme[] = shippedSchemes,
): EffectiveAppearance {
  const wanted = preferences.appearance.colorScheme;
  const variant = resolveVariant(preferences.appearance.variant, prefersDark);
  const found = schemes.find((scheme) => scheme.id === wanted);
  const diagnostics: string[] = [];

  if (found === undefined) {
    diagnostics.push(`there is no colour scheme ${wanted}, the built-in one is in effect`);
  } else {
    const resolution = resolveScheme(found, variant);

    if (resolution.kind === "resolved") {
      return {
        scheme: found,
        variant,
        resolution,
        diagnostics: [...diagnostics, ...resolution.diagnostics],
      };
    }

    diagnostics.push(...resolution.diagnostics);
  }

  const fallback = resolveScheme(imperiumScheme, variant);

  return {
    scheme: imperiumScheme,
    variant,
    resolution: fallback,
    diagnostics: [...diagnostics, ...fallback.diagnostics],
  };
}

/**
 * Применяет схему записью CSS-переменных и масштаб — атрибутом. Названная схема может отсутствовать —
 * её приносил плагин, которого выключили (docs/plugins.md), — и тогда работает встроенная: интерфейс
 * без цветов не остаётся.
 */
export function applyAppearance(options: ApplyAppearanceOptions): void {
  // Масштаб применяется первым и независимо от схемы: отказ схемы не повод оставить кегль чужим.
  applyScale(options.preferences.appearance.scale, options.root);

  const effective = resolveEffectiveAppearance(
    options.preferences,
    options.prefersDark,
    options.schemes,
  );

  for (const diagnostic of effective.diagnostics) {
    options.onDiagnostic(diagnostic);
  }

  if (effective.resolution.kind === "resolved") {
    applyRoles(effective.resolution.roles, options.target);
  }
}

type ColorSchemeRegistration = Extract<ContributionRegistration, { kind: "color-scheme" }>;

const colorSchemeContributions = (
  contributions: readonly ContributionRegistration[],
): ColorSchemeRegistration[] =>
  contributions.filter(
    (registration): registration is ColorSchemeRegistration => registration.kind === "color-scheme",
  );

/**
 * Схемы, приехавшие от плагинов (docs/plugins.md). Разбирает их кит: полнота палитры — его дело, а не
 * демона. Отвергнутая схема уходит диагностикой и просто не попадает в список: выбрать её нельзя,
 * потому что применить её нечем.
 *
 * Негодность проверяется дважды и обеими проверками кита: разбором документа и пробным разрешением.
 * Второе нужно из-за мажора контракта токенов — `parseColorScheme` его не смотрит, а схема с чужим
 * мажором не применится ни в одном варианте. Вариант здесь любой: отказ по мажору стоит до того, как
 * `resolveScheme` возьмётся за палитру.
 *
 * Причины отказов возвращаются, а не пишутся колбэком: разбор идёт на каждый снимок плагинов, и
 * запись из него была бы побочным действием в вычислении — та же жалоба повторялась бы с каждым
 * снимком. Кто и когда её покажет, решает вызывающий.
 */
export function pluginColorSchemes(contributions: readonly ContributionRegistration[]): {
  schemes: ColorScheme[];
  refusals: string[];
} {
  const schemes: ColorScheme[] = [];
  const refusals: string[] = [];

  for (const registration of colorSchemeContributions(contributions)) {
    const parsed = parseColorScheme(registration.id, registration.scheme);

    if (parsed.kind === "refused") {
      refusals.push(parsed.reason);

      continue;
    }

    let rejected = false;

    for (const variant of ["light", "dark"] as const) {
      const resolved = resolveScheme(parsed.scheme, variant);

      if (resolved.kind === "rejected") {
        refusals.push(...resolved.diagnostics);
        rejected = true;
        break;
      }
    }

    if (rejected) {
      continue;
    }

    schemes.push(parsed.scheme);
  }

  return { schemes, refusals };
}

/** Схема в выпадающем списке: секции нужны подписи, а не цвета. */
export type SchemeChoice = { id: string; label: string };

/**
 * Подписывает схемы для выбора. У схемы поставки подпись всегда наша, а у схемы плагина её может не
 * быть вовсе, поэтому ступеней три: перевод из каталога плагина в его неймспейсе → название вклада →
 * идентификатор. Идентификатор виден человеку и без каталога, и без названия — это хуже названия, но
 * лучше пустой строки в списке.
 */
export function describeSchemes(
  schemes: readonly ColorScheme[],
  contributions: readonly ContributionRegistration[],
  translator: Translator,
): SchemeChoice[] {
  const declared = new Map(
    colorSchemeContributions(contributions).map((registration) => [registration.id, registration]),
  );

  return schemes.map((scheme) => {
    const registration = declared.get(scheme.id);

    if (registration === undefined) {
      return { id: scheme.id, label: translator.t(`appearance.scheme.${scheme.id}`) };
    }

    const pluginNamespace =
      registration.ownership === "plugin" ? registration.pluginId : registration.source;
    const translated = translator
      .scope(pluginNamespace)
      .optional(`appearance.scheme.${registration.declaredId}`);

    return { id: scheme.id, label: translated ?? registration.title ?? registration.id };
  });
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
