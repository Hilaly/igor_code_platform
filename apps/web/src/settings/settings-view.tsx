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
  Breadcrumbs,
  Heading,
  List,
  ListRow,
  SettingsFrame,
  Text,
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
    <SettingsFrame
      settingsLabel={t("settings.context.title").toUpperCase()}
      navigationLabel={t("settings.sections")}
      context={
        <Breadcrumbs
          ariaLabel={t("settings.context.aria")}
          separator="·"
          items={[
            { id: "sovereign", label: "Sovereign" },
            { id: "settings", label: t("settings.context.title") },
            ...(detailTitle === undefined
              ? []
              : [
                  { id: section, label: t(`settings.section.${section}`) },
                  { id: "plugin", label: detailTitle },
                ]),
          ]}
        />
      }
      navigation={
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
      }
    >
      <section
        className={`settings-content${detailTitle === undefined ? "" : " settings-detail"}`}
        aria-label={title}
      >
        <Heading level={1}>{title}</Heading>
        {detailTitle === undefined ? (
          <p className="settings-section-description">
            {t(`settings.section.description.${section}`)}
          </p>
        ) : undefined}
        <div className="settings-content-body">{content}</div>
      </section>
    </SettingsFrame>
  );
}
