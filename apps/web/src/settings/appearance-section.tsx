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
  AppearancePreview,
  Notice,
  SegmentedControl,
  Select,
  SettingsRow,
  type ScopedTranslator,
} from "@sovereign/ui-kit";

import type { SchemeChoice } from "../appearance.ts";

export type AppearanceSectionProps = {
  preferences: AppearancePreferences;
  /**
   * Уже подписанные схемы: подпись схемы плагина берётся из его каталога и названия вклада
   * (docs/plugins.md), и второй способ её вычислить разошёлся бы с первым.
   */
  schemes: readonly SchemeChoice[];
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
  const schemeLabel =
    schemes.find((scheme) => scheme.id === preferences.appearance.colorScheme)?.label ??
    preferences.appearance.colorScheme;
  const variantLabel = t(`appearance.variant.${preferences.appearance.variant}`);
  const scaleLabel = t(`appearance.scale.${preferences.appearance.scale}`);

  return (
    <div className="settings-appearance">
      {refusal === undefined ? undefined : <Notice tone="danger" title={refusal} />}
      <SettingsRow label={t("appearance.scheme")} description={t("settings.appearance.schemeHint")}>
        <Select
          label=""
          ariaLabel={t("appearance.scheme")}
          value={preferences.appearance.colorScheme}
          options={schemes.map((scheme) => ({ value: scheme.id, label: scheme.label }))}
          onChange={(colorScheme) =>
            onChange({ ...preferences, appearance: { ...preferences.appearance, colorScheme } })
          }
          placeholder={t("common.choose")}
        />
      </SettingsRow>
      <SettingsRow
        label={t("appearance.variant")}
        description={t("settings.appearance.variantHint")}
      >
        <SegmentedControl
          label={t("appearance.variant")}
          value={preferences.appearance.variant}
          options={appearanceVariants.map((variant) => ({
            value: variant,
            label: t(`appearance.variant.${variant}`),
          }))}
          onChange={(variant) =>
            onChange({ ...preferences, appearance: { ...preferences.appearance, variant } })
          }
        />
      </SettingsRow>
      <SettingsRow label={t("appearance.scale")} description={t("settings.appearance.scaleHint")}>
        <SegmentedControl
          label={t("appearance.scale")}
          value={preferences.appearance.scale}
          options={interfaceScales.map((scale) => ({
            value: scale,
            label: t(`appearance.scale.${scale}`),
          }))}
          onChange={(scale) =>
            onChange({ ...preferences, appearance: { ...preferences.appearance, scale } })
          }
        />
      </SettingsRow>
      <SettingsRow label={t("appearance.locale")}>
        <Select
          label=""
          ariaLabel={t("appearance.locale")}
          value={preferences.locale}
          options={locales.map((locale) => ({ value: locale, label: localeName(locale) }))}
          onChange={(locale) => onChange({ ...preferences, locale })}
          placeholder={t("common.choose")}
        />
      </SettingsRow>
      <AppearancePreview
        title={t("settings.appearance.preview")}
        label={t("settings.appearance.preview.label", {
          scheme: schemeLabel,
          variant: variantLabel,
          scale: scaleLabel,
        })}
        scheme={schemeLabel}
        variant={variantLabel}
        scale={scaleLabel}
        swatches={[
          { role: "surface", label: t("settings.appearance.preview.surface") },
          { role: "accent", label: t("settings.appearance.preview.accent") },
          { role: "secondary", label: t("settings.appearance.preview.secondary") },
          { role: "text", label: t("settings.appearance.preview.text") },
        ]}
      />
    </div>
  );
}

/** Язык называет себя на себе: список языков переводить не принято, и `Intl` умеет это сам. */
function localeName(locale: string): string {
  return new Intl.DisplayNames([locale], { type: "language" }).of(locale) ?? locale;
}
