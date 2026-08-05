/**
 * Страница настроек: локальная навигация разделов слева, содержимое раздела справа. Это одна
 * поверхность центрального вью с границей между областями, а не две вложенные карточки: настройки
 * уже находятся внутри оболочки приложения. Единственный заголовок страницы называет активный
 * раздел, а под-навигация собрана из того же `List`/`ListRow`, что и навигация оболочки.
 *
 * Адрес раздела (`/settings/<section>`) переживает перезагрузку и является единственным источником
 * выбранного состояния: голый `/settings` маршрутизатор заменяет на `/settings/appearance`.
 */

import {
  SettingsNavigationItem,
  SettingsPage,
  SettingsView as SettingsKitView,
  type ScopedTranslator,
} from "@sovereign/ui-kit";
import type { ReactNode } from "react";

import { settingsSections, type SettingsSection } from "../router.ts";

export type SettingsViewProps = {
  /** Выбранный раздел уже канонизирован маршрутизатором и всегда записан в адресе. */
  section: SettingsSection;
  onSectionChange: (section: SettingsSection) => void;
  projects: ReactNode;
  appearance: ReactNode;
  providers: ReactNode;
  plugins: ReactNode;
  detailTitle?: string;
  daemon: ReactNode;
  diagnostics: ReactNode;
  translator: ScopedTranslator;
};

export function SettingsView({
  section,
  onSectionChange,
  projects,
  appearance,
  providers,
  plugins,
  detailTitle,
  daemon,
  diagnostics,
  translator,
}: SettingsViewProps) {
  const { t } = translator;

  const content =
    section === "projects"
      ? projects
      : section === "appearance"
        ? appearance
        : section === "providers"
          ? providers
          : section === "plugins"
            ? plugins
            : section === "daemon"
              ? daemon
              : diagnostics;

  const title = detailTitle ?? t(`settings.section.${section}`);

  return (
    <SettingsKitView
      navigationLabel={t("settings.sections")}
      context={t("settings.context.title")}
      navigation={
        <>
          {settingsSections.map((candidate) => (
            <SettingsNavigationItem
              key={candidate}
              selected={candidate === section}
              onSelect={() => onSectionChange(candidate)}
            >
              {t(`settings.section.${candidate}`)}
            </SettingsNavigationItem>
          ))}
        </>
      }
    >
      <SettingsPage
        title={title}
        description={
          detailTitle === undefined ? t(`settings.section.description.${section}`) : undefined
        }
      >
        {content}
      </SettingsPage>
    </SettingsKitView>
  );
}
