/**
 * Раздел «Внешний вид» страницы настроек. Записывается в `preferences.json` через API: файл остаётся
 * источником истины (docs/data-directory.md), а не копией того, что помнит вкладка.
 *
 * Прежде это была вкладка `appearance` правой панели; разделом стало содержимое, логика не менялась.
 */

import {
  appearanceVariants,
  interfaceScales,
  type AppearancePreferences,
} from "@sovereign/protocol";
import {
  Button,
  Field,
  Notice,
  Select,
  Text,
  type ColorScheme,
  type ScopedTranslator,
} from "@sovereign/ui-kit";

export type AppearanceSectionProps = {
  preferences: AppearancePreferences;
  schemes: readonly ColorScheme[];
  locales: string[];
  onChange: (preferences: AppearancePreferences) => void;
  /** Отказ записи: файл на диске правил кто-то ещё, и это дело человека, а не повтора запроса. */
  refusal: string | undefined;
  translator: ScopedTranslator;
};

export function AppearanceSection({
  preferences,
  schemes,
  locales,
  onChange,
  refusal,
  translator,
}: AppearanceSectionProps) {
  const { t } = translator;

  return (
    <div className="settings-appearance">
      {refusal === undefined ? undefined : <Notice tone="danger" title={refusal} />}
      <Field layout="row" label={t("appearance.scheme")} hint={t("settings.appearance.schemeHint")}>
        {() => (
          <Select
            label=""
            value={preferences.appearance.colorScheme}
            options={schemes.map((scheme) => ({
              value: scheme.id,
              label: t(`appearance.scheme.${scheme.id}`),
            }))}
            onChange={(colorScheme) =>
              onChange({ ...preferences, appearance: { ...preferences.appearance, colorScheme } })
            }
            placeholder={t("common.choose")}
          />
        )}
      </Field>
      <Field
        layout="row"
        label={t("appearance.variant")}
        hint={t("settings.appearance.variantHint")}
      >
        {() => (
          <div className="settings-appearance-buttons">
            {appearanceVariants.map((variant) => (
              <Button
                key={variant}
                pressed={preferences.appearance.variant === variant}
                onClick={() =>
                  onChange({ ...preferences, appearance: { ...preferences.appearance, variant } })
                }
              >
                {t(`appearance.variant.${variant}`)}
              </Button>
            ))}
          </div>
        )}
      </Field>
      {/* Тот же вид выбора из трёх, что и вариант темы, поэтому и контрол тот же: два разных вида
          управления в одной панели выглядели бы случайностью. Классы раскладки те же по той же причине. */}
      <Field layout="row" label={t("appearance.scale")} hint={t("settings.appearance.scaleHint")}>
        {() => (
          <div className="settings-appearance-buttons">
            {interfaceScales.map((scale) => (
              <Button
                key={scale}
                pressed={preferences.appearance.scale === scale}
                onClick={() =>
                  onChange({ ...preferences, appearance: { ...preferences.appearance, scale } })
                }
              >
                {t(`appearance.scale.${scale}`)}
              </Button>
            ))}
          </div>
        )}
      </Field>
      <Field layout="row" label={t("appearance.locale")}>
        {() => (
          <Select
            label=""
            value={preferences.locale}
            options={locales.map((locale) => ({ value: locale, label: localeName(locale) }))}
            onChange={(locale) => onChange({ ...preferences, locale })}
            placeholder={t("common.choose")}
          />
        )}
      </Field>
    </div>
  );
}

/** Язык называет себя на себе: список языков переводить не принято, и `Intl` умеет это сам. */
function localeName(locale: string): string {
  return new Intl.DisplayNames([locale], { type: "language" }).of(locale) ?? locale;
}
