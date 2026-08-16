import type { PlaceContext } from "@sovereign/browser-sdk";
import { useSovereignEvents } from "@sovereign/browser-sdk";
import {
  EmptyState,
  Heading,
  List,
  ListRow,
  Notice,
  Progress,
  Spinner,
  StatusDot,
  Text,
  createTranslator,
  type StatusDotTone,
  type Translator,
} from "@sovereign/ui-kit";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { fetchMission } from "./api.ts";
import { englishMessages, messagesNamespace, russianMessages } from "./messages.ts";
import type { MissionSnapshot, MissionStep } from "./model.ts";
import "./mission-panel.css";

type PanelState =
  | { kind: "loading" }
  | { kind: "empty" }
  | { kind: "ready"; snapshot: MissionSnapshot }
  | { kind: "error"; reason: string };

export function MissionPanel({ context }: { context: PlaceContext }): ReactNode {
  const sessionId = context.subject?.sessionId;
  const events = useSovereignEvents();
  const [state, setState] = useState<PanelState>({ kind: "loading" });
  const highestRevision = useRef(0);
  const requestSequence = useRef(0);
  const reload = useCallback(
    (signal?: AbortSignal) => {
      if (sessionId === undefined) {
        setState({ kind: "empty" });
        return;
      }
      const sequence = ++requestSequence.current;
      setState((current) => (current.kind === "ready" ? current : { kind: "loading" }));
      void fetchMission(sessionId, signal)
        .then((snapshot) => {
          if (signal?.aborted || requestSequence.current !== sequence) return;
          if (snapshot === undefined) {
            setState({ kind: "empty" });
            return;
          }
          if (snapshot.revision < highestRevision.current) return;
          highestRevision.current = snapshot.revision;
          setState({ kind: "ready", snapshot });
        })
        .catch((cause: unknown) => {
          if (signal?.aborted || requestSequence.current !== sequence) return;
          setState({
            kind: "error",
            reason: cause instanceof Error ? cause.message : String(cause),
          });
        });
    },
    [sessionId],
  );
  useEffect(() => {
    highestRevision.current = 0;
    setState(sessionId === undefined ? { kind: "empty" } : { kind: "loading" });
    const controller = new AbortController();
    reload(controller.signal);
    return () => {
      controller.abort();
      requestSequence.current += 1;
    };
  }, [reload]);
  useEffect(() => {
    if (sessionId === undefined) return;
    return events.subscribe((event) => {
      if (event.type === "core.stream.gap") {
        reload();
        return;
      }
      if (event.type !== "mission.changed" || !isMissionChanged(event.payload)) return;
      if (event.payload.sessionId !== sessionId || event.payload.revision < highestRevision.current)
        return;
      highestRevision.current = event.payload.revision;
      reload();
    });
  }, [events, reload, sessionId]);
  useEffect(() => {
    if (sessionId === undefined) return;
    return events.subscribeRecovery?.(() => reload());
  }, [events, reload, sessionId]);
  const translator = useTranslator();
  return (
    <section className="mission-panel" aria-label={translator.t("panel.title")}>
      <Heading level={2}>{translator.t("panel.title")}</Heading>
      {state.kind === "loading" ? <Spinner label={translator.t("panel.loading")} /> : undefined}
      {state.kind === "empty" ? (
        <EmptyState
          title={translator.t(sessionId === undefined ? "panel.empty.session" : "panel.empty")}
        />
      ) : undefined}
      {state.kind === "error" ? (
        <Notice tone="danger" title={translator.t("panel.failure", { reason: state.reason })} />
      ) : undefined}
      {state.kind === "ready" ? (
        <MissionSnapshotView snapshot={state.snapshot} translator={translator} />
      ) : undefined}
    </section>
  );
}

/** Состояние шага цветом не сообщается: точка кита несёт его словом в `aria-label` и подсказке. */
const stepTones: Record<MissionStep["status"], StatusDotTone> = {
  completed: "positive",
  in_progress: "pending",
  pending: "neutral",
};

/**
 * Три яруса вместо ровного столбца абзацев: сама миссия, её пояснение и план. Раньше миссия,
 * пояснение, время правки и шаги шли одним кеглем и различались только цветом — прочесть, где
 * задание, а где примечание к нему, было нельзя. Время правки уехало вниз служебной строкой: это
 * сведения о записи, а не её содержание.
 */
function MissionSnapshotView({
  snapshot,
  translator,
}: {
  snapshot: MissionSnapshot;
  translator: Translator;
}): ReactNode {
  const completed = snapshot.plan.filter((step) => step.status === "completed").length;

  return (
    <div className="mission-content">
      <p className="mission-statement">{snapshot.mission}</p>
      {snapshot.explanation === undefined ? undefined : (
        <p className="mission-explanation">
          <Text tone="muted">{snapshot.explanation}</Text>
        </p>
      )}
      <div className="mission-plan">
        <div className="mission-plan-head">
          <Text tone="muted">{translator.t("plan.label")}</Text>
          <Text tone="muted">
            {translator.t("plan.count", { completed, total: snapshot.plan.length })}
          </Text>
        </div>
        <Progress label={translator.t("plan.progress")} value={completed / snapshot.plan.length} />
        <List>
          {/*
            Подсветку текущего шага рисует сама строка списка: заливкой строк владеет кит, и
            собственный фон здесь разошёлся бы с ним при первой правке палитры. Состояние при этом
            сообщается не только цветом — точка несёт его словом.
          */}
          {snapshot.plan.map((step, index) => (
            <ListRow key={`${index}-${step.step}`} selected={step.status === "in_progress"}>
              <span className="mission-step" data-status={step.status}>
                <StatusDot
                  tone={stepTones[step.status]}
                  label={translator.t(`state.${step.status}`)}
                />
                <Text tone={step.status === "completed" ? "muted" : "normal"}>{step.step}</Text>
              </span>
            </ListRow>
          ))}
        </List>
      </div>
      <p className="mission-updated">
        <Text tone="muted">
          {translator.t("panel.updated", { time: formatUpdatedAt(snapshot.updatedAt, translator) })}
        </Text>
      </p>
    </div>
  );
}

/**
 * Переводчик панели. Локаль спрашивается у платформы: своей настройки языка у плагина нет и быть не
 * должно — человек выбирает язык один раз на всё окно. Хук повторяет тот, что живёт у subagents:
 * браузерного API локали в SDK пока нет, и заводить общий модуль ради двух копий рано — сначала
 * решение, где этой локали жить (docs/backlog.md).
 */
function useTranslator(): Translator {
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
        onDiagnostic: (diagnostic) => console.warn(`[mission] ${diagnostic}`),
      }),
    [locale],
  );
}

/**
 * Дату форматирует переводчик, а не своя `Intl`: та брала локаль браузера, и в русской строке
 * «Обновлено» стояло английское «16 Aug 2026». Язык у панели один — тот, что выбран для окна.
 */
function formatUpdatedAt(value: string, translator: Translator): string {
  return translator.formatDate(new Date(value), { dateStyle: "medium", timeStyle: "short" });
}

function isMissionChanged(value: unknown): value is { sessionId: string; revision: number } {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return typeof record.sessionId === "string" && typeof record.revision === "number";
}
