import {
  sessionImageMimeTypes,
  type SessionContextUsage,
  type SessionImage,
  type SessionMessage,
  type SessionMessageMode,
  type SessionStats,
  type ThinkingLevel,
  type TurnRequest,
} from "@sovereign/protocol";
import {
  AddIcon,
  Button,
  ImageIcon,
  Menu,
  NextTurnPicker,
  Notice,
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

import { imageFilesOf, readImageFiles, type ImageIntake } from "./image-input.ts";
import { ComposerAttachments } from "./composer-attachments.tsx";
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
  /**
   * Отдать наверх приём перетащенного. Зоной drop служит вся панель чата, а не поле ввода: целиться
   * в узкую полоску композера ради картинки — работа, которой быть не должно.
   */
  onDropTarget?: (drop: (transfer: DataTransfer) => void) => void;
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
  onDropTarget,
  context,
  stats,
  translator,
}: MessageComposerProps): React.JSX.Element {
  const { t } = translator;
  const [draft, setDraft] = useState("");
  const [images, setImages] = useState<SessionImage[]>([]);
  /** Что не так с последним приложением. Живёт рядом с композером: это исход действия, а не сессии. */
  const [intakeProblem, setIntakeProblem] = useState<string | undefined>(undefined);
  const [submitting, setSubmitting] = useState(false);
  const picker = useRef<HTMLInputElement | null>(null);
  const operationToken = useRef(0);
  const currentSessionId = useRef(sessionId);
  const appliedDraftReplacement = useRef<number | undefined>(undefined);
  currentSessionId.current = sessionId;

  useEffect(() => {
    operationToken.current += 1;
    setSubmitting(false);
    setDraft("");
    setImages([]);
    setIntakeProblem(undefined);
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

  // Сообщение из одних картинок законно: скриншот без единого слова — обычная просьба «посмотри».
  const sendDisabled = disabled || submitting || (draft.trim() === "" && images.length === 0);

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

        // Черновик чистится только принятым сообщением. Любой отказ — битый файл, предел, текстовая
        // модель, занятость, сеть — оставляет его как есть: переписывать заново то, что уже написано,
        // человек не должен.
        if (reason === undefined) {
          setDraft("");
          setImages([]);
          setIntakeProblem(undefined);
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
    if (sendDisabled) {
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
        ...(images.length === 0 ? {} : { images }),
        model,
        thinkingLevel: reasoningSupported ? thinkingLevel : "off",
      }),
    );
  };

  const sendMessage = (mode: SessionMessageMode): void => {
    startSubmission(() =>
      onSendMessage({ text: draft, ...(images.length === 0 ? {} : { images }), mode }),
    );
  };

  /** Пачка принимается целиком: один негодный файл не оставляет от выбора половину. */
  const takeImages = (files: readonly File[]): void => {
    if (files.length === 0) {
      return;
    }

    void readImageFiles(files).then(
      (intake: ImageIntake) => {
        if (currentSessionId.current !== sessionId) {
          return;
        }

        if (intake.kind === "read") {
          setIntakeProblem(undefined);
          setImages((current) => [...current, ...intake.images]);

          return;
        }

        setIntakeProblem(t(`chat.attachment.${intake.kind}`, { file: intake.fileName }));
      },
      (error: unknown) => onError(error),
    );
  };

  const takeFromPicker = (event: React.ChangeEvent<HTMLInputElement>): void => {
    takeImages([...(event.target.files ?? [])]);
    // Поле очищается, иначе повторный выбор того же файла не даст `change` и картинка не приложится.
    event.target.value = "";
  };

  /** Приложить перетащенное. Зовётся панелью чата: ронять картинку можно в любое её место. */
  const dropped = (transfer: DataTransfer): void => {
    takeImages(imageFilesOf(transfer));
  };

  const droppedRef = useRef(dropped);

  droppedRef.current = dropped;

  useEffect(() => {
    // Отдаётся стабильная обёртка: сам обработчик пересоздаётся каждым рендером, и передавать его
    // напрямую значило бы перевешивать слушателя панели на каждый введённый символ.
    onDropTarget?.((transfer) => droppedRef.current(transfer));
  }, [onDropTarget]);

  const paste = (event: React.ClipboardEvent<HTMLTextAreaElement>): void => {
    const files = imageFilesOf(event.clipboardData);

    if (files.length === 0) {
      // Обычная вставка текста остаётся нативной: перехватывать её незачем.
      return;
    }

    // Текст из смешанного буфера вставляется браузером сам, картинки добавляются рядом. Умолчание
    // не отменяется: иначе пропал бы текст, который человек вставлял вместе с ними.
    takeImages(files);
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

  return (
    <div className="sessions-composer-surface">
      {intakeProblem === undefined ? undefined : <Notice tone="danger" title={intakeProblem} />}
      <RaisedSurface>
        <div className="sessions-composer">
          {images.length === 0 ? undefined : (
            <ComposerAttachments
              images={images}
              onRemove={(index) => setImages((current) => current.filter((_, at) => at !== index))}
              disabled={disabled || submitting}
              translator={translator}
            />
          )}
          <Textarea
            value={draft}
            onChange={setDraft}
            onSubmit={sendDefault}
            submitWhenEmpty={images.length > 0}
            onPaste={paste}
            placeholder={t("chat.compose.placeholder")}
            aria-label={t("chat.compose.label")}
            autoGrow
            rows={2}
            maxRows={12}
            disabled={disabled || submitting}
          />
          <div className="sessions-composer-toolbar">
            <div className="sessions-composer-attach">
              {/* Меню, а не сразу picker: тем же `+` в следующем срезе открываются скилы и шаблоны
                  промптов, и заводить под них вторую кнопку рядом незачем. */}
              <Menu
                label={t("chat.attach")}
                trigger={<AddIcon />}
                triggerLabel={t("chat.attach")}
                placement="above"
                compact
                disabled={disabled || submitting}
                items={[
                  {
                    id: "image",
                    label: t("chat.attach.image"),
                    icon: <ImageIcon size="sm" />,
                    onSelect: () => picker.current?.click(),
                  },
                ]}
              />
              <input
                ref={picker}
                type="file"
                hidden
                multiple
                accept={sessionImageMimeTypes.join(",")}
                aria-label={t("chat.attach.image")}
                onChange={takeFromPicker}
              />
            </div>
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
