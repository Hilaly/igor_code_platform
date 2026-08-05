/** Именованные пиктограммы UI-кита: прикладной код не зависит от словаря внешней библиотеки. */

import {
  ChevronRight,
  Copy,
  GitBranchPlus,
  GitFork,
  MoreHorizontal,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Plus,
  Tag,
  TagX,
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
export const MoreIcon = actionIcon(MoreHorizontal);
export const ChevronRightIcon = actionIcon(ChevronRight);
export const PanelLeftCloseIcon = actionIcon(PanelLeftClose);
export const PanelLeftOpenIcon = actionIcon(PanelLeftOpen);
export const PanelRightCloseIcon = actionIcon(PanelRightClose);
export const PanelRightOpenIcon = actionIcon(PanelRightOpen);
