/**
 * Страница настроек: под-навигация разделов слева, содержимое раздела справа. Те же `List`/`ListRow`,
 * что и в навигации оболочки. Форму переняла у соседней репы `sovereign_node_claude`, но без её
 * собственной реализации списка: наш кит уже умеет выбираемую строку.
 *
 * Адрес раздела (`/settings/<section>`) переживает перезагрузку: это `page.section` из маршрута.
 * Раздела по умолчанию нет — берётся первый, но в адрес не пишется, пока человек его не выберет.
 */

import { Heading, List, ListRow, Text, type ScopedTranslator } from "@sovereign/ui-kit";
import type { ReactNode } from "react";

import { settingsSections, type SettingsSection } from "../router.ts";

export type SettingsViewProps = {
  /** Выбранный раздел. `undefined` — голый `/settings`, показываем первый. */
  section: SettingsSection | undefined;
  onSectionChange: (section: SettingsSection) => void;
  appearance: ReactNode;
  daemon: ReactNode;
  diagnostics: ReactNode;
  translator: ScopedTranslator;
};

export function SettingsView({
  section,
  onSectionChange,
  appearance,
  daemon,
  diagnostics,
  translator,
}: SettingsViewProps) {
  const { t } = translator;
  // Голый адрес — первый раздел. В адрес не пишется, пока человек не выбрал сам: навязанный раздел
  // в истории смотрится как будто его открывали.
  const active = section ?? settingsSections[0];

  const content = active === "appearance" ? appearance : active === "daemon" ? daemon : diagnostics;

  return (
    <div className="settings">
      <Heading level={1}>{t("settings.title")}</Heading>
      <div className="settings-split">
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
        <div className="settings-section">{content}</div>
      </div>
    </div>
  );
}
