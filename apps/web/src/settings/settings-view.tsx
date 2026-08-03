/**
 * Страница настроек: под-навигация разделов слева, содержимое раздела справа — мастер-деталь, как во
 * вью сессий. Обе колонки лежат в китовых `Panel`: поверхность с границей одинакова, разница только в
 * наполнении. Под-навигация собрана из того же `List`/`ListRow`, что и навигация оболочки.
 *
 * Адрес раздела (`/settings/<section>`) переживает перезагрузку: это `page.section` из маршрута.
 * Раздела по умолчанию нет — берётся первый, но в адрес не пишется, пока человек его не выберет.
 */

import { Heading, List, ListRow, Panel, Text, type ScopedTranslator } from "@sovereign/ui-kit";
import type { ReactNode } from "react";

import { settingsSections, type SettingsSection } from "../router.ts";

export type SettingsViewProps = {
  /** Выбранный раздел. `undefined` — голый `/settings`, показываем первый. */
  section: SettingsSection | undefined;
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
  // Голый адрес — первый раздел. В адрес не пишется, пока человек не выбрал сам: навязанный раздел
  // в истории смотрится как будто его открывали.
  const active = section ?? settingsSections[0];

  const content =
    active === "appearance"
      ? appearance
      : active === "providers"
        ? providers
        : active === "plugins"
          ? plugins
          : active === "daemon"
            ? daemon
            : diagnostics;

  return (
    <div className="settings">
      <Heading level={1}>{t("settings.title")}</Heading>
      <div className="settings-split">
        <Panel title={t("settings.sections")}>
          <nav className="settings-nav" aria-label={t("settings.sections")}>
            <List>
              {settingsSections.map((candidate) => (
                <ListRow
                  key={candidate}
                  selected={candidate === active}
                  onSelect={() => onSectionChange(candidate)}
                >
                  <Text>{t(`settings.section.${candidate}`)}</Text>
                </ListRow>
              ))}
            </List>
          </nav>
        </Panel>
        <Panel title={t(`settings.section.${active}`)}>{content}</Panel>
      </div>
    </div>
  );
}
