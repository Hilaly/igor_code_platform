import {
  type SessionContextUsage,
  type SessionMessage,
  type SessionMessageMode,
  type SessionStats,
  type ThinkingLevel,
  type TurnRequest,
} from "@sovereign/protocol";
import {
  Button,
  NextTurnPicker,
  RaisedSurface,
  SendIcon,
  SplitButton,
  StopIcon,
  Textarea,
  Tooltip,
  type MenuItemDescription,
  type ModelPickerGroup,
  type ScopedTranslator,
} from "@sovereign/ui-kit";
import { useEffect, useRef, useState } from "react";

import { SessionUsage } from "./session-usage.tsx";

export type MessageComposerProps = {
  sessionId: string;
  draftReplacement?: ComposerDraftReplacement;
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
  context: SessionContextUsage | undefined;
  stats: SessionStats | undefined;
  translator: ScopedTranslator;
};

export type ComposerDraftReplacement = {
  sessionId: string;
  sequence: number;
  text: string;
};

export function MessageComposer({
  sessionId,
  draftReplacement,
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
  context,
  stats,
  translator,
}: MessageComposerProps): React.JSX.Element {
  const { t } = translator;
  const [draft, setDraft] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const operationToken = useRef(0);
  const currentSessionId = useRef(sessionId);
  const appliedDraftReplacement = useRef<number | undefined>(undefined);
  currentSessionId.current = sessionId;

  useEffect(() => {
    operationToken.current += 1;
    setSubmitting(false);
    setDraft("");
    appliedDraftReplacement.current = undefined;
  }, [sessionId]);

  useEffect(() => {
    if (
      draftReplacement === undefined ||
      draftReplacement.sessionId !== sessionId ||
      appliedDraftReplacement.current === draftReplacement.sequence
    ) {
      return;
    }

    appliedDraftReplacement.current = draftReplacement.sequence;
    setDraft(draftReplacement.text);
  }, [draftReplacement, sessionId]);

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
          setDraft("");
        }
      },
      (error: unknown) => {
        if (operationToken.current !== token || currentSessionId.current !== submittedSessionId) {
          onError(error);
          return;
        }

        setSubmitting(false);
        onError(error);
      },
    );
  };

  const startSubmission = (acceptanceFactory: () => Promise<string | undefined>): void => {
    if (disabled || submitting || draft.trim() === "") {
      return;
    }

    setSubmitting(true);
    const token = operationToken.current;
    const submittedSessionId = sessionId;
    let acceptance: Promise<string | undefined>;

    try {
      acceptance = acceptanceFactory();
    } catch (error: unknown) {
      if (operationToken.current === token && currentSessionId.current === submittedSessionId) {
        setSubmitting(false);
        onError(error);
      }

      return;
    }

    settle(acceptance, token, submittedSessionId);
  };

  const submitTurn = (): void => {
    startSubmission(() =>
      onSubmit({
        text: draft,
        model,
        thinkingLevel: reasoningSupported ? thinkingLevel : "off",
      }),
    );
  };

  const sendMessage = (mode: SessionMessageMode): void => {
    startSubmission(() => onSendMessage({ text: draft, mode }));
  };

  const sendDefault = (): void => {
    if (busy) {
      sendMessage("steer");
      return;
    }

    submitTurn();
  };

  const sendOptions: MenuItemDescription[] = [
    {
      id: "append",
      label: t("chat.append"),
      onSelect: () => sendMessage("append"),
    },
    ...(busy
      ? ([
          {
            id: "follow-up",
            label: t("chat.mode.follow-up.send"),
            onSelect: () => sendMessage("follow-up"),
          },
          {
            id: "next-turn",
            label: t("chat.mode.next-turn.send"),
            onSelect: () => sendMessage("next-turn"),
          },
        ] satisfies MenuItemDescription[])
      : []),
  ];

  const sendDisabled = disabled || submitting || draft.trim() === "";

  return (
    <div className="sessions-composer-surface">
      <RaisedSurface>
        <div className="sessions-composer">
          <Textarea
            value={draft}
            onChange={setDraft}
            onSubmit={sendDefault}
            placeholder={t("chat.compose.placeholder")}
            aria-label={t("chat.compose.label")}
            autoGrow
            rows={2}
            maxRows={12}
            disabled={disabled || submitting}
          />
          <div className="sessions-composer-toolbar">
            <div className="sessions-composer-future-slot" aria-hidden="true" />
            <div className="sessions-composer-actions">
              <SessionUsage stats={stats} context={context} translator={translator} />
              <NextTurnPicker
                model={model}
                modelGroups={modelGroups}
                onModelChange={onModelChange}
                onExpandModelGroup={onExpandModelGroup}
                thinkingLevel={thinkingLevel}
                reasoningSupported={reasoningSupported}
                onThinkingLevelChange={onThinkingLevelChange}
                modelLabel={t("chat.model")}
                reasoningLabel={t("chat.thinking")}
                triggerLabel={t("chat.nextTurn.settings")}
                placeholder={t("common.choose")}
                emptyText={t("state.empty")}
                translator={translator}
                disabled={disabled}
              />
              <Tooltip content={t("chat.stop")}>
                <Button
                  iconOnly
                  tone="danger"
                  aria-label={t("chat.stop")}
                  onClick={onInterrupt}
                  disabled={disabled || !busy}
                >
                  <StopIcon />
                </Button>
              </Tooltip>
              <SplitButton
                action={<SendIcon />}
                actionLabel={busy ? t("chat.mode.steer.send") : t("chat.send")}
                onAction={sendDefault}
                menuLabel={t("chat.send.options")}
                menuTriggerLabel={t("chat.send.options")}
                items={sendOptions}
                placement="above"
                tone="secondary"
                disabled={sendDisabled}
              />
            </div>
          </div>
        </div>
      </RaisedSurface>
    </div>
  );
}
