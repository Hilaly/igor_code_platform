import type { SessionMessage, SessionMessageMode } from "@sovereign/protocol";
import {
  Button,
  RaisedSurface,
  SegmentedControl,
  Textarea,
  type ScopedTranslator,
} from "@sovereign/ui-kit";
import { useState } from "react";

export type MessageComposerProps = {
  draft: string;
  onDraftChange: (draft: string) => void;
  busy: boolean;
  disabled?: boolean;
  onSubmit: (text: string) => void;
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
  onSubmit,
  onSendMessage,
  onInterrupt,
  translator,
}: MessageComposerProps): React.JSX.Element {
  const { t } = translator;
  const [mode, setMode] = useState<SessionMessageMode>("steer");

  const send = (): void => {
    if (disabled || draft.trim() === "") {
      return;
    }

    if (busy) {
      // У занятой сессии турна не запустить: текст уезжает в одну из очередей, и в какую именно —
      // человек выбирает сам, потому что момент доставки у них разный.
      void onSendMessage({ text: draft, mode });
    } else {
      onSubmit(draft);
    }

    onDraftChange("");
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
              disabled={disabled}
            />
            <Button tone="accent" onClick={send} disabled={disabled || draft.trim() === ""}>
              {busy ? t(`chat.mode.${mode}.send`) : t("chat.send")}
            </Button>
            {!busy ? (
              <Button
                onClick={() => {
                  if (draft.trim() === "") {
                    return;
                  }

                  void onSendMessage({ text: draft, mode: "append" });
                  onDraftChange("");
                }}
                disabled={disabled || draft.trim() === ""}
              >
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
