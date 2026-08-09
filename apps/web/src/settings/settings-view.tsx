/**
 * Страница настроек: локальная навигация разделов слева, содержимое раздела справа. Это одна
 * поверхность центрального вью с границей между областями, а не две вложенные карточки: настройки
 * уже находятся внутри оболочки приложения. В оболочке активный раздел называет единственный
 * документный заголовок; локальный контекст повторяет полный путь, но не рисует второй крупный title.
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
import { useShellHeaderAvailable } from "../shell/header.tsx";

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
  const embedded = useShellHeaderAvailable();

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
      navigationTitle="SETTINGS"
      context={`◆ Sovereign · ${t("settings.context.title")} · ${title}`}
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
        headingLevel={embedded ? "none" : 1}
        description={
          detailTitle === undefined ? t(`settings.section.description.${section}`) : undefined
        }
      >
        {content}
      </SettingsPage>
    </SettingsKitView>
  );
}
