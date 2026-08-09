/**
 * Разделы вью настроек. Список закрыт: раздел, которого ядро не знает, — неизвестная страница, а не
 * запрос. Перечень публичен и без того — именами мест `core.settings.<section>`; второй его копии в
 * дереве не держим.
 */
export const settingsSections = [
  "projects",
  "appearance",
  "usage",
  "providers",
  "plugins",
  "daemon",
  "diagnostics",
] as const;

export type SettingsSection = (typeof settingsSections)[number];

export function isSettingsSection(value: unknown): value is SettingsSection {
  return settingsSections.includes(value as SettingsSection);
}

/**
 * Куда страница плагина вправе увести человека. Расширяется минором, сужается только мажором,
 * поэтому вариантов ровно столько, сколько у ядра адресуемых экранов.
 *
 * Страница чужого плагина стоит в этом же перечне не по недосмотру: форму адреса `/p/…` задаёт
 * модель расширения, то есть ядро. Плагин, уводящий на соседа, называет соседа, а не строит его
 * адрес строкой.
 */
export type CoreDestination =
  | { kind: "home" }
  | { kind: "session"; sessionId: string }
  | { kind: "new-session" }
  | { kind: "session-archive" }
  | { kind: "settings"; section: SettingsSection }
  | {
      kind: "plugin-page";
      pluginId: string;
      pageId: string;
      /** Путь внутри страницы, как он стоит в адресе. Не сказан — корень страницы. */
      path?: string;
      query?: Readonly<Record<string, string>>;
    };
