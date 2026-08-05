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
import { useEffect, useRef, useState } from "react";

export type MessageComposerProps = {
  sessionId: string;
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
  onError: (error: unknown) => void;
  translator: ScopedTranslator;
};

/**
 * Что делает кнопка отправки у занятой сессии. Турна она запустить не может — сессия занята, — и
 * выбор между тремя очередями заменяет его собой (docs/web-api.md). `append` требует простоя и
 * поэтому доступен отдельной кнопкой рядом с обычным запуском турна.
 */
const busyModes: SessionMessageMode[] = ["steer", "follow-up", "next-turn"];

export function MessageComposer({
  sessionId,
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
  onError,
  translator,
}: MessageComposerProps): React.JSX.Element {
  const { t } = translator;
  const [mode, setMode] = useState<SessionMessageMode>("steer");
  const [submitting, setSubmitting] = useState(false);
  const operationToken = useRef(0);
  const currentSessionId = useRef(sessionId);
  currentSessionId.current = sessionId;

  useEffect(() => {
    operationToken.current += 1;
    setSubmitting(false);
  }, [sessionId]);

  useEffect(() => {
    if (!reasoningSupported && thinkingLevel !== "off") {
      onThinkingLevelChange("off");
    }
  }, [onThinkingLevelChange, reasoningSupported, thinkingLevel]);

  const settle = (
    acceptance: Promise<string | undefined>,
    token: number,
    submittedSessionId: string,
  ): void => {
    void acceptance.then(
      (reason) => {
        if (operationToken.current !== token || currentSessionId.current !== submittedSessionId) {
          return;
        }

        setSubmitting(false);

        if (reason === undefined) {
          onDraftChange("");
        }
      },
      (error: unknown) => {
        if (operationToken.current !== token || currentSessionId.current !== submittedSessionId) {
          return;
        }

        setSubmitting(false);
        onError(error);
      },
    );
  };

  const send = (): void => {
    if (disabled || submitting || draft.trim() === "") {
      return;
    }

    setSubmitting(true);
    const token = operationToken.current;
    const submittedSessionId = sessionId;
    let acceptance: Promise<string | undefined>;

    try {
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
    } catch (error: unknown) {
      if (operationToken.current === token && currentSessionId.current === submittedSessionId) {
        setSubmitting(false);
        onError(error);
      }

      return;
    }

    settle(acceptance, token, submittedSessionId);
  };

  const append = (): void => {
    if (disabled || submitting || draft.trim() === "") {
      return;
    }

    setSubmitting(true);
    const token = operationToken.current;
    const submittedSessionId = sessionId;
    let acceptance: Promise<string | undefined>;

    try {
      acceptance = onSendMessage({ text: draft, mode: "append" });
    } catch (error: unknown) {
      if (operationToken.current === token && currentSessionId.current === submittedSessionId) {
        setSubmitting(false);
        onError(error);
      }

      return;
    }

    settle(acceptance, token, submittedSessionId);
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
                side="top"
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
