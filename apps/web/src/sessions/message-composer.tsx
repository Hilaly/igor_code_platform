import {
  sessionImageMimeTypes,
  type ProjectFilesSnapshot,
  type SessionCommands,
  type SessionContextUsage,
  type SessionImage,
  type SessionMessage,
  type SessionMessageMode,
  type SessionOutboxRequest,
  type SessionStats,
  type ThinkingLevel,
  type TurnRequest,
} from "@sovereign/protocol";
import {
  AddIcon,
  Button,
  CommandsIcon,
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
import { useEffect, useMemo, useRef, useState } from "react";

import { imageFilesOf, readImageFiles, type ImageIntake } from "./image-input.ts";
import { applyMention, mentionAt, type FileMention } from "./file-mention.ts";
import { FileMentionList } from "./file-mention-list.tsx";
import {
  applySlash,
  coreSessionCommands,
  parseInvocation,
  skillEntries,
  skillOf,
  slashAt,
  slashCatalogue,
  templateEntries,
  type SlashDraft,
  type SlashEntry,
  type SlashInvocation,
} from "./slash-command.ts";
import { SlashCatalogList } from "./slash-catalog-list.tsx";
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
  /** Турн скилом или шаблоном. Обычная реплика турна не запускает: она встаёт в очередь. */
  onSubmit: (request: TurnRequest) => Promise<string | undefined>;
  /**
   * Поставить набранное в очередь — то, что делает Enter. Занята сессия или нет, разницы нет:
   * очередь сама запустит турн, как только сессия освободится (docs/sessions-and-projects.md).
   */
  onQueueMessage: (request: SessionOutboxRequest) => Promise<string | undefined>;
  onSendMessage: (message: SessionMessage) => Promise<string | undefined>;
  onInterrupt: () => void;
  onError: (error: unknown) => void;
  /**
   * Отдать наверх приём перетащенного. Зоной drop служит вся панель чата, а не поле ввода: целиться
   * в узкую полоску композера ради картинки — работа, которой быть не должно.
   */
  onDropTarget?: (drop: (transfer: DataTransfer) => void) => void;
  /**
   * Найти файлы проекта по фрагменту после `@`. Не задан — подсказка не открывается, и `@`
   * остаётся обычным символом: у сессии без доступной папки искать негде.
   */
  onSearchFiles?: (query: string, signal: AbortSignal) => Promise<ProjectFilesSnapshot>;
  /**
   * Каталог команд сессии. Не приехал — по `/` предлагаются только команды ядра: они не зависят ни
   * от агента, ни от включённых плагинов.
   */
  commands?: SessionCommands;
  /**
   * Команды плагинов, поставленные в место `core.session.slash`. Считает их вью: доступность
   * команды это host-расчёт, а композер про снимок плагинов ничего не знает.
   */
  pluginCommands?: SlashEntry[];
  /**
   * Выполнить встроенную команду сессии. Возвращает причину отказа — черновик чистится только
   * принятой командой, ровно как принятым сообщением.
   */
  onRunCommand: (invocation: SlashInvocation) => Promise<string | undefined>;
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
  onQueueMessage,
  onSendMessage,
  onInterrupt,
  onError,
  onDropTarget,
  onSearchFiles,
  commands,
  pluginCommands,
  onRunCommand,
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
    setMention(undefined);
    setSlash(undefined);
    setFound({ paths: [], truncated: false });
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

  const queueMessage = (): void => {
    startSubmission(() =>
      onQueueMessage({
        text: draft,
        ...(images.length === 0 ? {} : { images }),
        // Выбор модели уезжает вместе с сообщением, а не берётся у сессии в момент запуска: к тому
        // моменту человек мог выбрать другую, а отправлял он это.
        model,
        thinkingLevel: reasoningSupported ? thinkingLevel : "off",
      }),
    );
  };

  /**
   * Запустить набранную команду. Скил — это турн, поэтому он уезжает тем же `onSubmit`, что и
   * реплика; остальное панель чата делает сама.
   */
  const runInvocation = (invocation: SlashInvocation): void => {
    // Картинки командой не отправляются: скил уезжает модели готовым текстом без вложений, а
    // приложить картинку к переименованию нечему. Демон откажет — сказать это здесь честнее.
    if (images.length > 0) {
      setIntakeProblem(t("chat.slash.images"));

      return;
    }

    const skill = skillOf(invocation);

    if (skill !== undefined) {
      startSubmission(() =>
        onSubmit({
          skill,
          ...(invocation.arguments === "" ? {} : { instructions: invocation.arguments }),
          model,
          thinkingLevel: reasoningSupported ? thinkingLevel : "off",
        }),
      );

      return;
    }

    // Шаблон — тоже турн, и уезжает он тем же `onSubmit`. Остальное умеет панель чата: у команд
    // ядра и у команд плагинов свои обработчики, и запросов композер не делает.
    if ((commands?.templates ?? []).some((template) => template.name === invocation.name)) {
      startSubmission(() =>
        onSubmit({
          template: invocation.name,
          ...(invocation.arguments === "" ? {} : { arguments: invocation.arguments }),
          model,
          thinkingLevel: reasoningSupported ? thinkingLevel : "off",
        }),
      );

      return;
    }

    startSubmission(() => onRunCommand(invocation));
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

  /**
   * Набираемая ссылка на файл и то, что по ней нашлось. Живёт в композере, а не выше: это состояние
   * ввода, и лента о нём знать не должна.
   */
  const [mention, setMention] = useState<FileMention | undefined>(undefined);
  const [found, setFound] = useState<ProjectFilesSnapshot>({ paths: [], truncated: false });
  const [activeIndex, setActiveIndex] = useState(0);
  const field = useRef<HTMLTextAreaElement | null>(null);

  /**
   * Набираемая команда и каталог под неё. Каталог считается на месте, а не запрашивается на каждую
   * букву: скилы сессии приезжают целиком, и фильтр по ним — работа на несколько десятков строк.
   */
  const [slash, setSlash] = useState<SlashDraft | undefined>(undefined);
  const catalogue = useMemo(() => {
    if (slash === undefined) {
      return [];
    }

    // Порядок: команды ядра, шаблоны человека, команды плагинов, скилы. Ядро первым — их четыре и
    // они всегда применимы; скилы последними — их бывают десятки, и искать четыре знакомых имени
    // в их хвосте человеку незачем.
    return slashCatalogue(slash.query, [
      ...coreSessionCommands.map((command) => ({
        name: command.name,
        description: t(command.descriptionKey),
      })),
      ...templateEntries(commands?.templates ?? []),
      ...(pluginCommands ?? []),
      ...skillEntries(commands?.skills ?? []),
    ]);
  }, [commands, pluginCommands, slash, t]);
  const slashOpen = slash !== undefined && catalogue.length > 0;

  /**
   * Две подсказки в одном поле взаимно исключаются: обе хотят стрелки, `Enter`, `Tab` и `Escape`,
   * а команда с аргументом `@файл` делает живыми оба триггера сразу. Команда стоит в начале строки
   * и потому старше: пока набирают её имя, ссылка на файл ещё не начата.
   */
  const mentionOpen = !slashOpen && mention !== undefined && found.paths.length > 0;

  // Список меняется с каждой буквой: выбор возвращается на первую строку, иначе он указывал бы не
  // туда, куда указывал до нажатия.
  useEffect(() => {
    setActiveIndex(0);
  }, [slash?.query]);

  useEffect(() => {
    if (mention === undefined || onSearchFiles === undefined) {
      setFound({ paths: [], truncated: false });

      return;
    }

    // Набор идёт быстрее ответа демона: запрос предыдущей буквы отменяется, иначе список мигал бы
    // тем, что уже неактуально.
    const aborter = new AbortController();
    const asked = setTimeout(() => {
      void onSearchFiles(mention.query, aborter.signal).then(
        (snapshot) => {
          setFound(snapshot);
          setActiveIndex(0);
        },
        () => {
          // Отказ поиска — не отказ ввода: подсказка просто не открывается, `@` остаётся текстом.
          setFound({ paths: [], truncated: false });
        },
      );
    }, 120);

    return () => {
      clearTimeout(asked);
      aborter.abort();
    };
  }, [mention, onSearchFiles]);

  const remember = (text: string, caret: number | null): void => {
    setMention(caret === null ? undefined : mentionAt(text, caret));
    setSlash(caret === null ? undefined : slashAt(text, caret));
  };

  /** Вернуть фокус и курсор в поле после подстановки: следующее слово печатают там же. */
  const restoreCaret = (caret: number): void => {
    queueMicrotask(() => {
      const element = field.current;

      element?.focus();
      element?.setSelectionRange(caret, caret);
    });
  };

  const chooseSlash = (name: string): void => {
    if (slash === undefined) {
      return;
    }

    const applied = applySlash(draft, slash, name);

    setDraft(applied.text);
    setSlash(undefined);
    restoreCaret(applied.caret);
  };

  /**
   * Открыть каталог из меню `+`. Уже набранное не пропадает: `/` встаёт перед ним, и выбранная
   * команда получает написанное аргументом.
   */
  const openCatalogue = (): void => {
    const text = `/${draft}`;

    setDraft(text);
    setSlash({ end: 1, query: "" });
    restoreCaret(1);
  };

  const chooseMention = (path: string): void => {
    if (mention === undefined) {
      return;
    }

    const applied = applyMention(draft, mention, path);

    setDraft(applied.text);
    setMention(undefined);
    setFound({ paths: [], truncated: false });
    restoreCaret(applied.caret);
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
    const invocation = parseInvocation(draft);

    // Команда старше очереди: человек, набравший `/compact`, не собирался ни говорить это модели,
    // ни ждать конца турна — команда исполняется сразу.
    if (invocation !== undefined) {
      runInvocation(invocation);

      return;
    }

    // Одно поведение на все состояния сессии: набранное встаёт в очередь, а очередь сама решает,
    // когда его запускать. Ветка по занятости здесь была источником зависших сообщений — стиринг
    // уезжал в компакцию, где вычитывать его некому (docs/sessions-and-projects.md).
    queueMessage();
  };

  const sendOptions: MenuItemDescription[] = [
    {
      id: "append",
      label: t("chat.append"),
      onSelect: () => sendMessage("append"),
    },
    // Оба варианта относятся к идущему турну: вклинить в него или продолжить им же. Enter к турну
    // отношения не имеет вовсе — он ставит в очередь.
    ...(busy
      ? ([
          {
            id: "steer",
            label: t("chat.mode.steer.send"),
            onSelect: () => sendMessage("steer"),
          },
          {
            id: "follow-up",
            label: t("chat.mode.follow-up.send"),
            onSelect: () => sendMessage("follow-up"),
          },
        ] satisfies MenuItemDescription[])
      : []),
  ];

  return (
    <div className="sessions-composer-surface">
      {intakeProblem === undefined ? undefined : <Notice tone="danger" title={intakeProblem} />}
      <RaisedSurface>
        <div className="sessions-composer">
          {slashOpen ? (
            <SlashCatalogList
              entries={catalogue}
              activeIndex={activeIndex}
              onChoose={chooseSlash}
              translator={translator}
            />
          ) : undefined}
          {mentionOpen ? (
            <FileMentionList
              paths={found.paths}
              truncated={found.truncated}
              activeIndex={activeIndex}
              onChoose={chooseMention}
              translator={translator}
            />
          ) : undefined}
          {images.length === 0 ? undefined : (
            <ComposerAttachments
              images={images}
              onRemove={(index) => setImages((current) => current.filter((_, at) => at !== index))}
              disabled={disabled || submitting}
              translator={translator}
            />
          )}
          <Textarea
            ref={field}
            value={draft}
            onChange={(next) => {
              setDraft(next);
              // Позиция курсора известна только элементу; после `onChange` она уже новая.
              remember(next, field.current?.selectionStart ?? null);
            }}
            onSubmit={sendDefault}
            submitWhenEmpty={images.length > 0}
            onKeyDown={(event) => {
              if (slashOpen) {
                if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                  event.preventDefault();
                  setActiveIndex(
                    (current) =>
                      (current + (event.key === "ArrowDown" ? 1 : -1) + catalogue.length) %
                      catalogue.length,
                  );

                  return;
                }

                if (event.key === "Enter" || event.key === "Tab") {
                  const chosen = catalogue[activeIndex];

                  if (chosen === undefined) {
                    return;
                  }

                  event.preventDefault();

                  // Имя набрано целиком — подставлять нечего, и `Enter` запускает то, за чем его
                  // нажали. Иначе он вставил бы один пробел, и человек решил бы, что ввод сломан.
                  if (event.key === "Enter" && chosen.name === slash?.query) {
                    setSlash(undefined);
                    sendDefault();

                    return;
                  }

                  // Иначе `Enter` подставляет имя, а не запускает команду: аргументы человек
                  // дописывает после него, и одно нажатие делает одно дело.
                  chooseSlash(chosen.name);

                  return;
                }

                if (event.key === "Escape") {
                  // Каталог закрывается, а `/` остаётся обычным текстом: набранное не пропадает.
                  event.preventDefault();
                  setSlash(undefined);
                }

                return;
              }

              if (!mentionOpen) {
                // Подсказок нет — клавиатура остаётся полностью за полем ввода.
                remember(draft, field.current?.selectionStart ?? null);

                return;
              }

              if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                event.preventDefault();
                setActiveIndex(
                  (current) =>
                    (current + (event.key === "ArrowDown" ? 1 : -1) + found.paths.length) %
                    found.paths.length,
                );

                return;
              }

              if (event.key === "Enter" || event.key === "Tab") {
                const chosen = found.paths[activeIndex];

                if (chosen !== undefined) {
                  // `Enter` при открытой подсказке выбирает файл, а не отправляет сообщение:
                  // отправить недописанную ссылку человек не собирался.
                  event.preventDefault();
                  chooseMention(chosen);
                }

                return;
              }

              if (event.key === "Escape") {
                event.preventDefault();
                setMention(undefined);
              }
            }}
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
              {/* Меню, а не сразу picker: тем же `+` открывается каталог команд, и заводить под
                  него вторую кнопку рядом незачем. */}
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
                  {
                    id: "command",
                    label: t("chat.slash.open"),
                    icon: <CommandsIcon size="sm" />,
                    onSelect: openCatalogue,
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
                actionLabel={t("chat.send")}
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
