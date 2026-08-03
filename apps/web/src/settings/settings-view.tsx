/**
 * Страница настроек: локальная навигация разделов слева, содержимое раздела справа. Это одна
 * поверхность центрального вью с границей между областями, а не две вложенные карточки: настройки
 * уже находятся внутри оболочки приложения. Под-навигация собрана из того же `List`/`ListRow`, что и
 * навигация оболочки.
 *
 * Адрес раздела (`/settings/<section>`) переживает перезагрузку и является единственным источником
 * выбранного состояния: голый `/settings` маршрутизатор заменяет на `/settings/appearance`.
 */

import { Heading, List, ListRow, Text, type ScopedTranslator } from "@sovereign/ui-kit";
import type { ReactNode } from "react";

import { settingsSections, type SettingsSection } from "../router.ts";

export type SettingsViewProps = {
  /** Выбранный раздел уже канонизирован маршрутизатором и всегда записан в адресе. */
  section: SettingsSection;
  onSectionChange: (section: SettingsSection) => void;
  appearance: ReactNode;
  providers: ReactNode;
  plugins: ReactNode;
  daemon: ReactNode;
  diagnostics: ReactNode;
  translator: ScopedTranslator;
};

export function SettingsView({
  section,
  onSectionChange,
  appearance,
  providers,
  plugins,
  daemon,
  diagnostics,
  translator,
}: SettingsViewProps) {
  const { t } = translator;

  const content =
    section === "appearance"
      ? appearance
      : section === "providers"
        ? providers
        : section === "plugins"
          ? plugins
          : section === "daemon"
            ? daemon
            : diagnostics;

  return (
    <div className="settings">
      <aside className="settings-sidebar">
        <Heading level={1}>{t("settings.title")}</Heading>
        <nav className="settings-nav" aria-label={t("settings.sections")}>
          <List>
            {settingsSections.map((candidate) => (
              <ListRow
                key={candidate}
                selected={candidate === section}
                onSelect={() => onSectionChange(candidate)}
              >
                <Text>{t(`settings.section.${candidate}`)}</Text>
              </ListRow>
            ))}
          </List>
        </nav>
      </aside>
      <section className="settings-content" aria-label={t(`settings.section.${section}`)}>
        <Heading level={1}>{t(`settings.section.${section}`)}</Heading>
        <div className="settings-content-body">{content}</div>
      </section>
    </div>
  );
}
