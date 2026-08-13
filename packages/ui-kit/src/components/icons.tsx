/** Именованные пиктограммы UI-кита: прикладной код не зависит от словаря внешней библиотеки. */

import {
  Activity,
  Archive,
  BarChart3,
  Blocks,
  ChevronRight,
  ChevronDown,
  ChevronLeft,
  Command,
  Copy,
  Download,
  Folder,
  FolderOpen,
  GitBranchPlus,
  GitFork,
  Image as ImageSymbol,
  ListTree,
  MoreHorizontal,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Palette,
  Plug,
  Plus,
  Search,
  Send,
  Server,
  Settings,
  Shrink,
  Square,
  Tag,
  TagX,
  UserRound,
  X,
  type LucideIcon,
} from "lucide-react";

import { Icon, type IconSize } from "./icon.tsx";
import styles from "./icons.module.css";

export type SymbolIconProps = {
  size?: IconSize;
};

const actionIcon = (Symbol: LucideIcon) =>
  function ActionIcon({ size }: SymbolIconProps): React.JSX.Element {
    return (
      <Icon {...(size === undefined ? {} : { size })} className={styles.symbol}>
        <Symbol size="100%" strokeWidth={1.75} aria-hidden />
      </Icon>
    );
  };

export const CopyIcon = actionIcon(Copy);
export const ForkBeforeIcon = actionIcon(GitBranchPlus);
export const ForkThroughIcon = actionIcon(GitFork);
export const SetLabelIcon = actionIcon(Tag);
export const ClearLabelIcon = actionIcon(TagX);
export const AddIcon = actionIcon(Plus);
export const SendIcon = actionIcon(Send);
export const AppendIcon = actionIcon(Plus);
export const StopIcon = actionIcon(Square);
/** Снять ждущее сообщение с очереди. Крест, а не корзина: сообщение убирают, а не удаляют навсегда. */
export const RemoveIcon = actionIcon(X);
export const MoreIcon = actionIcon(MoreHorizontal);
export const CommandsIcon = actionIcon(Command);
export const ArchiveIcon = actionIcon(Archive);
export const SettingsIcon = actionIcon(Settings);
/**
 * Значки разделов настроек: они стоят рядом в одном списке команд, и один общий значок на все
 * различал бы разделы хуже, чем подпись, — то есть не помогал бы вовсе.
 */
export const AppearanceIcon = actionIcon(Palette);
export const UsageIcon = actionIcon(BarChart3);
export const ProviderIcon = actionIcon(Plug);
export const PluginIcon = actionIcon(Blocks);
export const DaemonIcon = actionIcon(Server);
export const DiagnosticsIcon = actionIcon(Activity);
export const SearchIcon = actionIcon(Search);
export const CompactIcon = actionIcon(Shrink);
export const EntryTreeIcon = actionIcon(ListTree);
export const FolderIcon = actionIcon(Folder);
export const FolderOpenIcon = actionIcon(FolderOpen);
export const UserIcon = actionIcon(UserRound);
export const ChevronRightIcon = actionIcon(ChevronRight);
export const ChevronLeftIcon = actionIcon(ChevronLeft);
export const ChevronDownIcon = actionIcon(ChevronDown);
export const ImageIcon = actionIcon(ImageSymbol);
export const DownloadIcon = actionIcon(Download);
export const PanelLeftCloseIcon = actionIcon(PanelLeftClose);
export const PanelLeftOpenIcon = actionIcon(PanelLeftOpen);
export const PanelRightCloseIcon = actionIcon(PanelRightClose);
export const PanelRightOpenIcon = actionIcon(PanelRightOpen);

/**
 * Знак продукта: монограмма «S», которой встречают и провожают сессию. Не иконка действия — у неё
 * нет семантики жеста, только опознание продукта. Цвет берётся через `currentColor`: знак встаётся в
 * акцент роли (`--sovereign-accent`) через цвет родителя, отдельная палитра не нужна.
 *
 * Живёт в этом файле, а не отдельным примитивом: дисциплина кита требует, чтобы каждый компонент
 * нёс свой CSS-модуль, а `BrandMark` переиспользует размерную сетку `Icon` и `.symbol` целиком —
 * отдельный CSS ему не нужен.
 */
export function BrandMark({
  size = "xl",
  label,
}: SymbolIconProps & { label?: string }): React.JSX.Element {
  return (
    <Icon {...(size === undefined ? {} : { size })} label={label} className={styles.symbol}>
      {/*
        Монограмма «S»: одна линия без заливки, в духе display-шрифта. `vector-effect` сохраняет
        толщину штриха при любом размере; внутренний SVG всегда декоративен — опознание даёт обёртка
        `Icon` через `label`, когда имя нужно скринридеру.
      */}
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path
          d="M19 6.5C17.5 4.7 15 4 12.5 4 8.5 4 6 5.8 6 8.4c0 2.5 2 3.6 6 4.5 4.2 1 6 2.1 6 4.7 0 2.6-2.6 4.4-6.6 4.4-2.8 0-5.4-1-7-2.8"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    </Icon>
  );
}
