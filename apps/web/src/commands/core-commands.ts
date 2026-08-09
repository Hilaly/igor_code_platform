/**
 * Команды ядра (docs/ui-extension-model.md). Данные хоста, а не вклады встроенного плагина: у вклада
 * есть переключатель, и «выключить команду `core.session.new`» получилось бы само собой —
 * состояние, в которое интерфейс приводить нечем. Встроенные вью по той же причине не выключаются, а
 * заменяются.
 *
 * Ни одна команда здесь не заводит нового поведения: каждая зовёт то, что оболочка уже умеет.
 */

import { settingsSections, type Page } from "../router.ts";
import type { ShellLayout } from "../shell/layout.ts";

export type CoreCommandHost = {
  navigate: (page: Page) => void;
  layout: ShellLayout;
  rightUnavailable: boolean;
  onLayoutChange: (layout: ShellLayout) => void;
};

export type CoreCommand = {
  /** Неймспейс ядра: у команд плагинов он свой, и спутать их в общем списке нельзя. */
  id: `core.${string}`;
  /** Ключ каталога сообщений: заголовок команды переводится, как и всё остальное в интерфейсе. */
  titleKey: string;
  run(host: CoreCommandHost): void;
  /** Нет — команда доступна всегда. Скрыть команду нельзя, только выключить. */
  available?(host: CoreCommandHost): boolean;
};

const navigation: CoreCommand[] = [
  {
    id: "core.session.new",
    titleKey: "command.session.new",
    run: (host) => host.navigate({ kind: "new-session" }),
  },
  {
    id: "core.session.archive",
    titleKey: "command.session.archive",
    run: (host) => host.navigate({ kind: "session-archive" }),
  },
];

const settings: CoreCommand[] = settingsSections.map((section) => ({
  id: `core.settings.${section}`,
  titleKey: `command.settings.${section}`,
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
    available: (host) => host.layout.leftHidden,
    run: (host) => host.onLayoutChange({ ...host.layout, leftHidden: false }),
  },
  {
    id: "core.panel.left.hide",
    titleKey: "command.panel.left.hide",
    available: (host) => !host.layout.leftHidden,
    run: (host) => host.onLayoutChange({ ...host.layout, leftHidden: true }),
  },
  {
    id: "core.panel.right.show",
    titleKey: "command.panel.right.show",
    available: (host) => !host.rightUnavailable && host.layout.rightHidden,
    run: (host) => host.onLayoutChange({ ...host.layout, rightHidden: false }),
  },
  {
    id: "core.panel.right.hide",
    titleKey: "command.panel.right.hide",
    available: (host) => !host.rightUnavailable && !host.layout.rightHidden,
    // Ту же вкладку оболочка закрывает и своей кнопкой: скрытая панель открытой вкладки не имеет.
    run: (host) => host.onLayoutChange({ ...host.layout, rightHidden: true, openTab: undefined }),
  },
];

export const coreCommands: readonly CoreCommand[] = [...navigation, ...settings, ...panels];
