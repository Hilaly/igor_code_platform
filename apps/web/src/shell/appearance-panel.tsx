/**
 * Выбор внешнего вида. Записывается в `preferences.json` через API: файл остаётся источником истины
 * (docs/data-directory.md), а не копией того, что помнит вкладка.
 */

import { appearanceVariants, type AppearancePreferences } from "@sovereign/protocol";
import {
  Button,
  Notice,
  Select,
  Text,
  type ColorScheme,
  type ScopedTranslator,
} from "@sovereign/ui-kit";

export type AppearancePanelProps = {
  preferences: AppearancePreferences;
  schemes: readonly ColorScheme[];
  locales: string[];
  onChange: (preferences: AppearancePreferences) => void;
  /** Отказ записи: файл на диске правил кто-то ещё, и это дело человека, а не повтора запроса. */
  refusal: string | undefined;
  translator: ScopedTranslator;
};

export function AppearancePanel({
  preferences,
  schemes,
  locales,
  onChange,
  refusal,
  translator,
}: AppearancePanelProps) {
  const { t } = translator;

  return (
    <div className="shell-appearance">
      {refusal === undefined ? undefined : <Notice tone="danger" title={refusal} />}
      <Select
        label={t("appearance.scheme")}
        value={preferences.appearance.colorScheme}
        options={schemes.map((scheme) => ({
          value: scheme.id,
          label: t(`appearance.scheme.${scheme.id}`),
        }))}
        onChange={(colorScheme) =>
          onChange({ ...preferences, appearance: { ...preferences.appearance, colorScheme } })
        }
      />
      <div className="shell-appearance-variants">
        <Text tone="muted">{t("appearance.variant")}</Text>
        <div className="shell-appearance-buttons">
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
      </div>
      <Select
        label={t("appearance.locale")}
        value={preferences.locale}
        options={locales.map((locale) => ({ value: locale, label: localeName(locale) }))}
        onChange={(locale) => onChange({ ...preferences, locale })}
      />
    </div>
  );
}

/** Язык называет себя на себе: список языков переводить не принято, и `Intl` умеет это сам. */
function localeName(locale: string): string {
  return new Intl.DisplayNames([locale], { type: "language" }).of(locale) ?? locale;
}
