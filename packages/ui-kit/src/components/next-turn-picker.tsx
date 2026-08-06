import { thinkingLevels, type ThinkingLevel } from "@sovereign/protocol";
import { useEffect, useMemo, useRef, useState } from "react";

import { ModelPickerMenu, type ModelPickerGroup } from "./model-picker.tsx";
import { Popover } from "./popover.tsx";
import { Tooltip } from "./tooltip.tsx";
import type { ScopedTranslator } from "../i18n/translator.ts";
import styles from "./next-turn-picker.module.css";

export type NextTurnPickerProps = {
  model: string;
  modelGroups: ModelPickerGroup[];
  onModelChange: (model: string) => void;
  onExpandModelGroup: (providerId: string) => void;
  thinkingLevel: ThinkingLevel;
  reasoningSupported: boolean;
  onThinkingLevelChange: (level: ThinkingLevel) => void;
  modelLabel: string;
  reasoningLabel: string;
  triggerLabel: string;
  placeholder: string;
  emptyText: string;
  translator: ScopedTranslator;
  disabled?: boolean;
};

export function NextTurnPicker({
  model,
  modelGroups,
  onModelChange,
  onExpandModelGroup,
  thinkingLevel,
  reasoningSupported,
  onThinkingLevelChange,
  modelLabel,
  reasoningLabel,
  triggerLabel,
  placeholder,
  emptyText,
  translator,
  disabled = false,
}: NextTurnPickerProps): React.JSX.Element {
  const [outerOpen, setOuterOpen] = useState(false);
  const [modelOpen, setModelOpen] = useState(false);
  const [reasoningOpen, setReasoningOpen] = useState(false);
  const reasoningMenuRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const shownThinkingLevel: ThinkingLevel = reasoningSupported ? thinkingLevel : "off";
  const thinkingLabel = translator.t(`thinking.${shownThinkingLevel}`);

  const selectedModelLabel = useMemo(() => {
    for (const group of modelGroups) {
      const option = group.options.find((candidate) => candidate.value === model);
      if (option !== undefined) return option.label;
    }
    return model || placeholder;
  }, [model, modelGroups, placeholder]);

  const closeCascade = (): void => {
    setModelOpen(false);
    setReasoningOpen(false);
    setOuterOpen(false);
    triggerRef.current?.focus();
  };

  useEffect(() => {
    if (modelOpen) {
      document.querySelector<HTMLElement>(`[role="tree"][aria-label="${modelLabel}"]`)?.focus();
    }
  }, [modelOpen]);
  useEffect(() => {
    if (reasoningOpen) reasoningMenuRef.current?.focus();
  }, [reasoningOpen]);

  const handleReasoningKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    const options = Array.from(
      reasoningMenuRef.current?.querySelectorAll<HTMLElement>('[role="option"]') ?? [],
    );
    const active = options.findIndex((option) => option === document.activeElement);
    let next = active;
    if (event.key === "ArrowDown") next = Math.min(options.length - 1, active + 1);
    else if (event.key === "ArrowUp") next = Math.max(0, active - 1);
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = options.length - 1;
    else if (event.key === "Enter" || event.key === " ") {
      (document.activeElement as HTMLElement | null)?.click();
      event.preventDefault();
      return;
    } else return;
    event.preventDefault();
    options[next]?.focus();
  };

  return (
    <Popover
      side="top"
      open={outerOpen}
      onOpenChange={(open) => {
        setOuterOpen(open);
        if (!open) {
          setModelOpen(false);
          setReasoningOpen(false);
          if (!open) triggerRef.current?.focus();
        }
      }}
      contentRole="menu"
      ariaLabel={triggerLabel}
      rootClassName={styles.root}
      contentClassName={styles.menu}
      renderTrigger={({ contentId, toggle }) => (
        <Tooltip content={triggerLabel} side="top">
          <button
            type="button"
            ref={triggerRef}
            className={`${styles.trigger}${disabled ? ` ${styles.disabled}` : ""}`}
            aria-label={`${selectedModelLabel} · ${thinkingLabel}`}
            aria-haspopup="menu"
            aria-expanded={outerOpen}
            aria-controls={outerOpen ? contentId : undefined}
            aria-disabled={disabled || !reasoningSupported}
            disabled={disabled}
            onClick={toggle}
          >
            <span className={styles.triggerValue}>{selectedModelLabel}</span>
            <span aria-hidden="true">·</span>
            <span className={styles.triggerValue}>{thinkingLabel}</span>
            <span className={`${styles.arrow}${outerOpen ? ` ${styles.open}` : ""}`}>▼</span>
          </button>
        </Tooltip>
      )}
    >
      <Popover
        side="right"
        viewportSafe
        open={modelOpen}
        onOpenChange={(open) => {
          setModelOpen(open);
          if (open) setReasoningOpen(false);
        }}
        ariaLabel={modelLabel}
        rootClassName={styles.submenuRoot}
        contentClassName={`${styles.submenu} ${styles.modelSubmenu}`}
        renderTrigger={({ contentId, toggle }) => (
          <button
            type="button"
            role="menuitem"
            className={styles.row}
            aria-label={`${modelLabel}: ${selectedModelLabel}`}
            aria-haspopup="tree"
            aria-expanded={modelOpen}
            aria-controls={modelOpen ? contentId : undefined}
            onClick={toggle}
          >
            <span className={styles.rowLabel}>{modelLabel}</span>
            <span className={styles.rowValue}>{selectedModelLabel}</span>
            <span aria-hidden="true">▶</span>
          </button>
        )}
      >
        <ModelPickerMenu
          groups={modelGroups}
          value={model}
          onChange={(nextModel) => {
            onModelChange(nextModel);
            closeCascade();
          }}
          onExpandGroup={onExpandModelGroup}
          label={modelLabel}
          placeholder={placeholder}
          emptyText={emptyText}
          disabled={disabled}
        />
      </Popover>

      <Popover
        side="right"
        viewportSafe
        open={reasoningOpen}
        onOpenChange={(open) => {
          if (!reasoningSupported) return;
          setReasoningOpen(open);
          if (open) setModelOpen(false);
        }}
        ariaLabel={reasoningLabel}
        rootClassName={styles.submenuRoot}
        contentClassName={styles.submenu}
        renderTrigger={({ contentId, toggle }) => (
          <button
            type="button"
            role="menuitem"
            className={`${styles.row}${!reasoningSupported ? ` ${styles.disabled}` : ""}`}
            aria-label={`${reasoningLabel}: ${thinkingLabel}`}
            aria-haspopup="listbox"
            aria-expanded={reasoningOpen}
            aria-controls={reasoningOpen ? contentId : undefined}
            aria-disabled={!reasoningSupported}
            disabled={!reasoningSupported}
            onClick={toggle}
          >
            <span className={styles.rowLabel}>{reasoningLabel}</span>
            <span className={styles.rowValue}>{thinkingLabel}</span>
            <span aria-hidden="true">▶</span>
          </button>
        )}
      >
        <div
          ref={reasoningMenuRef}
          className={styles.options}
          role="listbox"
          aria-label={reasoningLabel}
          tabIndex={-1}
          onKeyDown={handleReasoningKeyDown}
        >
          {thinkingLevels.map((level) => {
            const selected = level === shownThinkingLevel;
            return (
              <button
                key={level}
                type="button"
                role="option"
                aria-selected={selected}
                tabIndex={-1}
                className={`${styles.option}${selected ? ` ${styles.selected}` : ""}`}
                onClick={() => {
                  onThinkingLevelChange(level);
                  closeCascade();
                }}
              >
                <span>{translator.t(`thinking.${level}`)}</span>
                {selected ? <span>✓</span> : null}
              </button>
            );
          })}
        </div>
      </Popover>
    </Popover>
  );
}
