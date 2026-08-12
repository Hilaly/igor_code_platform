/**
 * Команды ядра (docs/ui-extension-model.md). Данные хоста, а не вклады встроенного плагина: у вклада
 * есть переключатель, и «выключить команду `core.session.new`» получилось бы само собой —
 * состояние, в которое интерфейс приводить нечем. Встроенные вью по той же причине не выключаются, а
 * заменяются.
 *
 * Ни одна команда здесь не заводит нового поведения: каждая зовёт то, что оболочка уже умеет.
 */

import {
  AddIcon,
  AppearanceIcon,
  ArchiveIcon,
  DaemonIcon,
  DiagnosticsIcon,
  FolderIcon,
  PanelLeftCloseIcon,
  PanelLeftOpenIcon,
  PanelRightCloseIcon,
  PanelRightOpenIcon,
  PluginIcon,
  ProviderIcon,
  UsageIcon,
  type SymbolIconProps,
} from "@sovereign/ui-kit";
import type { ComponentType } from "react";

import { settingsSections, type Page, type SettingsSection } from "../router.ts";
import type { ShellLayout } from "../shell/layout.ts";

export type CoreCommandHost = {
  navigate: (page: Page) => void;
  layout: ShellLayout;
  rightUnavailable: boolean;
  onLayoutChange: (layout: ShellLayout) => void;
};

/**
 * Раздел палитры. Команд у ядра уже двенадцать, и одним списком они читались хуже, чем оглавлением:
 * группа отвечает на вопрос «куда я иду», прежде чем читать сами подписи. Набор закрыт — новая
 * группа это решение о разделе интерфейса, а не свойство отдельной команды.
 */
export type CoreCommandGroup = "session" | "settings" | "panels";

export type CoreCommand = {
  /** Неймспейс ядра: у команд плагинов он свой, и спутать их в общем списке нельзя. */
  id: `core.${string}`;
  /** Ключ каталога сообщений: заголовок команды переводится, как и всё остальное в интерфейсе. */
  titleKey: string;
  group: CoreCommandGroup;
  /**
   * Значок команды: компонент, а не готовый узел, — этот модуль остаётся данными без разметки, и
   * его тесты не поднимают React.
   */
  icon: ComponentType<SymbolIconProps>;
  run(host: CoreCommandHost): void;
  /** Нет — команда доступна всегда. Скрыть команду нельзя, только выключить. */
  available?(host: CoreCommandHost): boolean;
};

const navigation: CoreCommand[] = [
  {
    id: "core.session.new",
    titleKey: "command.session.new",
    group: "session",
    icon: AddIcon,
    run: (host) => host.navigate({ kind: "new-session" }),
  },
  {
    id: "core.session.archive",
    titleKey: "command.session.archive",
    group: "session",
    icon: ArchiveIcon,
    run: (host) => host.navigate({ kind: "session-archive" }),
  },
];

/**
 * Значок раздела настроек: общий на все различал бы разделы хуже подписи, то есть не помогал бы.
 * Запись полная по типу — новый раздел без значка не соберётся, и палитра не покажет строку без него.
 */
const settingsIcons: Record<SettingsSection, ComponentType<SymbolIconProps>> = {
  projects: FolderIcon,
  appearance: AppearanceIcon,
  usage: UsageIcon,
  providers: ProviderIcon,
  plugins: PluginIcon,
  daemon: DaemonIcon,
  diagnostics: DiagnosticsIcon,
};

const settings: CoreCommand[] = settingsSections.map((section) => ({
  id: `core.settings.${section}`,
  titleKey: `command.settings.${section}`,
  group: "settings",
  icon: settingsIcons[section],
  run: (host) => host.navigate({ kind: "settings", section }),
}));

/**
 * Показать и скрыть — **разные** команды, а не одна переключающая. Список команд читается глазами, и
 * «скрыть панель» говорит, что произойдёт, тогда как «переключить панель» требует сначала посмотреть
 * на панель. Недоступная в этот момент половина остаётся видимой, но выключенной.
 */
const panels: CoreCommand[] = [
  {
    id: "core.panel.left.show",
    titleKey: "command.panel.left.show",
    group: "panels",
    icon: PanelLeftOpenIcon,
    available: (host) => host.layout.leftHidden,
    run: (host) => host.onLayoutChange({ ...host.layout, leftHidden: false }),
  },
  {
    id: "core.panel.left.hide",
    titleKey: "command.panel.left.hide",
    group: "panels",
    icon: PanelLeftCloseIcon,
    available: (host) => !host.layout.leftHidden,
    run: (host) => host.onLayoutChange({ ...host.layout, leftHidden: true }),
  },
  {
    id: "core.panel.right.show",
    titleKey: "command.panel.right.show",
    group: "panels",
    icon: PanelRightOpenIcon,
    available: (host) => !host.rightUnavailable && host.layout.rightHidden,
    run: (host) => host.onLayoutChange({ ...host.layout, rightHidden: false }),
  },
  {
    id: "core.panel.right.hide",
    titleKey: "command.panel.right.hide",
    group: "panels",
    icon: PanelRightCloseIcon,
    available: (host) => !host.rightUnavailable && !host.layout.rightHidden,
    // Ту же вкладку оболочка закрывает и своей кнопкой: скрытая панель открытой вкладки не имеет.
    run: (host) => host.onLayoutChange({ ...host.layout, rightHidden: true, openTab: undefined }),
  },
];

export const coreCommands: readonly CoreCommand[] = [...navigation, ...settings, ...panels];
