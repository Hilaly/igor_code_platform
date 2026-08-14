/**
 * Вкладка правой панели: субагенты — идущие и законченные — с последними ответами, и лента работы
 * выбранного (docs/subagents.md).
 *
 * Данные берутся своими маршрутами опросом. Второго SSE-соединения панель не открывает намеренно:
 * окно держит ровно одно (docs/web-api.md), а браузерного API подписки на шину у плагина нет.
 */

import type { PlaceContext } from "@sovereign/browser-sdk";
import {
  Badge,
  Button,
  DurationTimer,
  EmptyState,
  List,
  ListRow,
  Markdown,
  Message,
  MessageFeed,
  Notice,
  SegmentedControl,
  StatusDot,
  Text,
  ToolCall,
  createTranslator,
  type ScopedTranslator,
  type StatusDotTone,
} from "@sovereign/ui-kit";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";

import { englishMessages, messagesNamespace, russianMessages } from "./messages.ts";
import type { SubagentDetail, SubagentListed } from "./routes.ts";
import type { SubagentState } from "./registry.ts";

/** Как часто перечитываются данные. Второго SSE-соединения нет, значит остаётся опрос. */
const pollMilliseconds = 2_000;

const routes = "/api/p/subagents";

const tones: Record<SubagentState, StatusDotTone> = {
  running: "pending",
  finished: "positive",
  failed: "danger",
  stopped: "danger",
};

type Scope = "session" | "all";

export function SubagentsPanel({ context }: { context: PlaceContext }): ReactNode {
  const sessionId = context.subject?.["sessionId"];
  const translator = useTranslator();
  const [scope, setScope] = useState<Scope>("session");
  const [selected, setSelected] = useState<string | undefined>();

  // Открыли другую сессию — выбранный субагент к ней отношения не имеет.
  useEffect(() => {
    setSelected(undefined);
  }, [sessionId]);

  const parent = scope === "session" && sessionId !== undefined ? sessionId : undefined;
  const listAddress = useMemo(
    () => (parent === undefined ? `${routes}/list` : `${routes}/list?parent=${parent}`),
    [parent],
  );
  const list = usePolled<{ subagents: SubagentListed[] }>(
    listAddress,
    selected === undefined,
    pollMilliseconds,
  );

  if (selected !== undefined) {
    return (
      <SubagentDetailView
        sessionId={selected}
        translator={translator}
        onBack={() => setSelected(undefined)}
      />
    );
  }

  return (
    <div className="subagents-panel">
      {sessionId === undefined ? undefined : (
        <SegmentedControl
          label={translator.t("panel.scope.label")}
          value={scope}
          options={[
            { value: "session", label: translator.t("panel.scope.session") },
            { value: "all", label: translator.t("panel.scope.all") },
          ]}
          onChange={setScope}
        />
      )}
      {list.failure === undefined ? undefined : (
        <Notice tone="danger" title={translator.t("panel.failure", { reason: list.failure })} />
      )}
      <SubagentList
        subagents={list.value?.subagents ?? []}
        loaded={list.value !== undefined}
        scoped={parent !== undefined}
        translator={translator}
        onSelect={setSelected}
      />
    </div>
  );
}

function SubagentList({
  subagents,
  loaded,
  scoped,
  translator,
  onSelect,
}: {
  subagents: readonly SubagentListed[];
  loaded: boolean;
  scoped: boolean;
  translator: ScopedTranslator;
  onSelect: (sessionId: string) => void;
}): ReactNode {
  if (!loaded) {
    return undefined;
  }

  if (subagents.length === 0) {
    return <EmptyState title={translator.t(scoped ? "panel.empty.session" : "panel.empty")} />;
  }

  return (
    <List>
      {subagents.map((subagent) => (
        <ListRow key={subagent.sessionId} onSelect={() => onSelect(subagent.sessionId)}>
          <span className="subagents-row">
            <span className="subagents-row-head">
              <StatusDot
                tone={tones[subagent.state]}
                label={translator.t(`state.${subagent.state}`)}
              />
              <Text>{subagent.description}</Text>
              <Badge tone="neutral">{subagent.model}</Badge>
            </span>
            <span className="subagents-row-facts">
              <Text tone="muted">{subagent.agentId}</Text>
              {subagent.state === "running" ? (
                <DurationTimer
                  totalSeconds={elapsedSeconds(subagent.startedAt)}
                  labels={durationLabels(translator)}
                  accessibleLabel={translator.t("duration.elapsed")}
                />
              ) : undefined}
            </span>
            {excerptOf(subagent) === undefined ? undefined : (
              <Text tone="muted">{excerptOf(subagent) ?? ""}</Text>
            )}
          </span>
        </ListRow>
      ))}
    </List>
  );
}

function SubagentDetailView({
  sessionId,
  translator,
  onBack,
}: {
  sessionId: string;
  translator: ScopedTranslator;
  onBack: () => void;
}): ReactNode {
  const detail = usePolled<SubagentDetail>(`${routes}/detail/${sessionId}`, true, pollMilliseconds);
  const record = detail.value?.record;

  return (
    <div className="subagents-detail">
      <div className="subagents-detail-head">
        <Button tone="quiet" size="sm" onClick={onBack}>
          {translator.t("panel.back")}
        </Button>
        {record === undefined ? undefined : (
          <>
            <StatusDot tone={tones[record.state]} label={translator.t(`state.${record.state}`)} />
            <Text>{record.description}</Text>
            <Badge tone="neutral">{record.model}</Badge>
            <Badge tone="neutral">{record.thinkingLevel}</Badge>
          </>
        )}
      </div>
      {detail.failure === undefined ? undefined : (
        <Notice tone="danger" title={translator.t("panel.failure", { reason: detail.failure })} />
      )}
      {detail.value?.problem === undefined ? undefined : (
        <Notice
          tone="warning"
          title={translator.t("panel.detail.problem", { reason: detail.value.problem })}
        />
      )}
      {detail.value?.stats === undefined ? undefined : (
        <Text tone="muted">
          {translator.t("panel.detail.spend", {
            tokens: detail.value.stats.totalTokens,
            cost: detail.value.stats.costTotal.toFixed(2),
          })}
        </Text>
      )}
      <Transcript
        entries={detail.value?.entries ?? []}
        busy={record?.state === "running"}
        translator={translator}
      />
    </div>
  );
}

/** Лента работы субагента теми же примитивами, которыми ленту рисует ядро. */
function Transcript({
  entries,
  busy,
  translator,
}: {
  entries: SubagentDetail["entries"];
  busy: boolean;
  translator: ScopedTranslator;
}): ReactNode {
  const shown = entries.filter((entry) => entry.kind === "message" || entry.kind === "tool-result");

  if (shown.length === 0) {
    return <EmptyState title={translator.t("panel.detail.empty")} />;
  }

  return (
    <MessageFeed label={translator.t("panel.feed")} busy={busy}>
      {shown.map((entry) =>
        entry.kind === "message" ? (
          <Message key={entry.id} role={entry.role === "agent" ? "agent" : "human"}>
            {entry.content.map((block, index) =>
              block.kind === "text" ? (
                <Markdown key={index} text={block.text} />
              ) : block.kind === "tool-call" ? (
                <ToolCall
                  key={index}
                  toolName={block.toolName}
                  status="running"
                  statusLabel={translator.t("state.running")}
                  argumentsText={JSON.stringify(block.input, undefined, 2)}
                />
              ) : undefined,
            )}
          </Message>
        ) : (
          <ToolCall
            key={entry.id}
            toolName={entry.toolName}
            status={entry.failed ? "failed" : "done"}
            statusLabel={translator.t(entry.failed ? "state.failed" : "tool.status.done")}
            argumentsText=""
            output={entry.text}
            outputLabel={translator.t("tool.output")}
          />
        ),
      )}
    </MessageFeed>
  );
}

/**
 * Опрос одного адреса. Останавливается вместе с размонтированием и на время, пока панель показывает
 * другое: держать оба опроса разом значило бы дёргать демон вдвое чаще без причины.
 */
function usePolled<Value>(
  address: string,
  active: boolean,
  everyMilliseconds: number,
): { value?: Value; failure?: string } {
  const [state, setState] = useState<{ value?: Value; failure?: string }>({});

  const read = useCallback(
    async (signal: AbortSignal) => {
      try {
        const answer = await fetch(address, { signal });

        if (!answer.ok) {
          setState((current) => ({ ...current, failure: `HTTP ${answer.status}` }));

          return;
        }

        setState({ value: (await answer.json()) as Value });
      } catch (cause) {
        // Отменённый запрос — не сбой: так уходит размонтирование.
        if (signal.aborted) {
          return;
        }

        setState((current) => ({
          ...current,
          failure: cause instanceof Error ? cause.message : String(cause),
        }));
      }
    },
    [address],
  );

  useEffect(() => {
    if (!active) {
      return;
    }

    const controller = new AbortController();

    void read(controller.signal);

    const timer = setInterval(() => void read(controller.signal), everyMilliseconds);

    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [active, everyMilliseconds, read]);

  return state;
}

/**
 * Переводчик панели. Локаль спрашивается у платформы: своей настройки языка у плагина нет и быть не
 * должно — человек выбирает язык один раз на всё окно.
 */
function useTranslator(): ScopedTranslator {
  const [locale, setLocale] = useState("en");

  useEffect(() => {
    const controller = new AbortController();

    void (async () => {
      try {
        const answer = await fetch("/api/preferences", { signal: controller.signal });

        if (answer.ok) {
          const body = (await answer.json()) as { locale?: string };

          if (typeof body.locale === "string") {
            setLocale(body.locale);
          }
        }
      } catch {
        // Локаль не прочиталась — панель говорит по-английски. Ронять её из-за этого нечего.
      }
    })();

    return () => controller.abort();
  }, []);

  return useMemo(
    () =>
      createTranslator({
        locale,
        namespace: messagesNamespace,
        catalogs: [
          { namespace: messagesNamespace, locale: "en", messages: englishMessages },
          { namespace: messagesNamespace, locale: "ru", messages: russianMessages },
        ],
        // Дырка в собственном каталоге — ошибка автора плагина, и видно её должно быть в консоли,
        // а не в тексте панели.
        onDiagnostic: (diagnostic) => console.warn(`[subagents] ${diagnostic}`),
      }),
    [locale],
  );
}

function durationLabels(translator: ScopedTranslator) {
  return {
    days: translator.t("duration.days"),
    hours: translator.t("duration.hours"),
    minutes: translator.t("duration.minutes"),
    seconds: translator.t("duration.seconds"),
  };
}

function elapsedSeconds(startedAt: string): number {
  return Math.max(0, Math.floor((Date.now() - Date.parse(startedAt)) / 1000));
}

/** Выдержка последнего ответа: строка списка, а не весь текст. */
function excerptOf(subagent: SubagentListed): string | undefined {
  const text = subagent.failure ?? subagent.lastResponse;

  if (text === undefined) {
    return undefined;
  }

  const flat = text.replace(/\s+/gu, " ").trim();

  return flat.length <= 120 ? flat : `${flat.slice(0, 119)}…`;
}
