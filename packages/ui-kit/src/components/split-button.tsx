import type { ReactNode } from "react";

import { Button, type ButtonTone } from "./button.tsx";
import { ChevronDownIcon } from "./icons.tsx";
import { Menu, type MenuItemDescription } from "./menu.tsx";
import styles from "./split-button.module.css";

export type SplitButtonProps = {
  action: ReactNode;
  actionLabel: string;
  onAction: () => void;
  menuLabel: string;
  menuTriggerLabel: string;
  items: MenuItemDescription[];
  placement?: "below" | "above";
  tone?: ButtonTone;
  disabled?: boolean;
};

/** Компактное основное действие с отдельным меню редких альтернатив. */
export function SplitButton({
  action,
  actionLabel,
  onAction,
  menuLabel,
  menuTriggerLabel,
  items,
  placement = "below",
  tone = "normal",
  disabled = false,
}: SplitButtonProps): React.JSX.Element {
  return (
    <div className={styles.root}>
      <Button tone={tone} iconOnly aria-label={actionLabel} onClick={onAction} disabled={disabled}>
        {action}
      </Button>
      <Menu
        label={menuLabel}
        trigger={<ChevronDownIcon />}
        triggerLabel={menuTriggerLabel}
        placement={placement}
        compact
        disabled={disabled}
        items={items}
      />
    </div>
  );
}
