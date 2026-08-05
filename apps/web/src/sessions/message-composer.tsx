import {
  thinkingLevels,
  type SessionMessage,
  type SessionMessageMode,
  type ThinkingLevel,
  type TurnRequest,
} from "@sovereign/protocol";
import {
  Button,
  ModelPicker,
  type ModelPickerGroup,
  RaisedSurface,
  SegmentedControl,
  Select,
  Textarea,
  type ScopedTranslator,
} from "@sovereign/ui-kit";
import { useEffect, useState } from "react";

export type MessageComposerProps = {
  draft: string;
  onDraftChange: (draft: string) => void;
  busy: boolean;
  disabled?: boolean;
  model: string;
  modelGroups: ModelPickerGroup[];
  onModelChange: (model: string) => void;
  onExpandModelGroup: (providerId: string) => void;
  thinkingLevel: ThinkingLevel;
  reasoningSupported: boolean;
  onThinkingLevelChange: (level: ThinkingLevel) => void;
  onSubmit: (request: TurnRequest) => Promise<string | undefined>;
  onSendMessage: (message: SessionMessage) => Promise<string | undefined>;
  onInterrupt: () => void;
  translator: ScopedTranslator;
};

/**
 * Что делает кнопка отправки у занятой сессии. Турна она запустить не может — сессия занята, — и
 * выбор между тремя очередями заменяет его собой (docs/web-api.md). `append` требует простоя и
 * поэтому доступен отдельной кнопкой рядом с обычным запуском турна.
 */
const busyModes: SessionMessageMode[] = ["steer", "follow-up", "next-turn"];

export function MessageComposer({
  draft,
  onDraftChange,
  busy,
  disabled = false,
  model,
  modelGroups,
  onModelChange,
  onExpandModelGroup,
  thinkingLevel,
  reasoningSupported,
  onThinkingLevelChange,
  onSubmit,
  onSendMessage,
  onInterrupt,
  translator,
}: MessageComposerProps): React.JSX.Element {
  const { t } = translator;
  const [mode, setMode] = useState<SessionMessageMode>("steer");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!reasoningSupported && thinkingLevel !== "off") {
      onThinkingLevelChange("off");
    }
  }, [onThinkingLevelChange, reasoningSupported, thinkingLevel]);

  const send = (): void => {
    if (disabled || submitting || draft.trim() === "") {
      return;
    }

    setSubmitting(true);
    let acceptance: Promise<string | undefined>;

    if (busy) {
      // У занятой сессии турна не запустить: текст уезжает в одну из очередей, и в какую именно —
      // человек выбирает сам, потому что момент доставки у них разный.
      acceptance = onSendMessage({ text: draft, mode });
    } else {
      acceptance = onSubmit({
        text: draft,
        model,
        thinkingLevel: reasoningSupported ? thinkingLevel : "off",
      });
    }

    void acceptance.then((reason) => {
      setSubmitting(false);

      if (reason === undefined) {
        onDraftChange("");
      }
    });
  };

  const append = (): void => {
    if (disabled || submitting || draft.trim() === "") {
      return;
    }

    setSubmitting(true);
    void onSendMessage({ text: draft, mode: "append" }).then((reason) => {
      setSubmitting(false);

      if (reason === undefined) {
        onDraftChange("");
      }
    });
  };

  return (
    <>
      {busy ? (
        <div className="sessions-modes">
          <SegmentedControl
            options={busyModes.map((option) => ({
              value: option,
              label: t(`chat.mode.${option}`),
            }))}
            value={mode}
            onChange={setMode}
            label={t("chat.mode.label")}
            disabled={disabled}
          />
        </div>
      ) : undefined}

      <div className="sessions-composer-surface">
        <RaisedSurface>
          <div className="sessions-composer">
            <Textarea
              value={draft}
              onChange={onDraftChange}
              onSubmit={send}
              placeholder={t("chat.compose.placeholder")}
              aria-label={t("chat.compose.label")}
              autoGrow
              rows={2}
              maxRows={12}
              disabled={disabled || submitting}
            />
            <div className="sessions-composer-options">
              <ModelPicker
                label={t("chat.model")}
                groups={modelGroups}
                value={model}
                onChange={onModelChange}
                onExpandGroup={onExpandModelGroup}
                placeholder={t("common.choose")}
                emptyText={t("state.empty")}
              />
              <Select
                label={t("chat.thinking")}
                value={reasoningSupported ? thinkingLevel : "off"}
                onChange={(value) => onThinkingLevelChange(value as ThinkingLevel)}
                disabled={!reasoningSupported}
                options={thinkingLevels.map((level) => ({
                  value: level,
                  label: t(`thinking.${level}`),
                }))}
                placeholder={t("common.choose")}
              />
            </div>
            <Button
              tone="accent"
              onClick={send}
              disabled={disabled || submitting || draft.trim() === ""}
            >
              {busy ? t(`chat.mode.${mode}.send`) : t("chat.send")}
            </Button>
            {!busy ? (
              <Button onClick={append} disabled={disabled || submitting || draft.trim() === ""}>
                {t("chat.append")}
              </Button>
            ) : undefined}
            {busy ? (
              <Button tone="danger" onClick={onInterrupt}>
                {t("chat.stop")}
              </Button>
            ) : undefined}
          </div>
        </RaisedSurface>
      </div>
    </>
  );
}
