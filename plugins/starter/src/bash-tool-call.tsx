/**
 * Карточка вызова bash/job-output/job-kill в ленте сессии (спека
 * 2026-08-16-bash-tool-call-visual-design.md). Встроенный ToolCall остаётся fallback'ом.
 *
 * Данные — из записей сессии: input виден, как только модель вызвала инструмент, результат — когда
 * инструмент завершился. Статус перечитывается по событиям и ограниченным retry в состоянии
 * «записей ещё нет».
 */

import { useSovereignEvents, useTranslator, type PlaceContext } from "@sovereign/browser-sdk";
import { Badge, Code, CodeBlock, Disclosure, Notice, Text } from "@sovereign/ui-kit";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { fetchEntries, findToolCall, type ToolCallData } from "./entries.ts";
import { messagesNamespace } from "./namespace.ts";
import { parseBashResult, type ParsedBashResult } from "./parse-bash-result.ts";
import "./bash-tool-call.css";

type CardStatus = "running" | "done" | "failed";
type BadgeTone = "neutral" | "accent" | "success" | "warning" | "danger";

/** Сколько раз перечитывать записи, пока вызова в них нет (доли секунды после вызова модели). */
export const NO_DATA_RETRY_ATTEMPTS = 20;
export const NO_DATA_RETRY_DELAY_MS = 1_000;

/**
 * Подпись и тон карточки. Статус задания из текста (`[status: …]`) важнее факта ответа тула:
 * job-output отвечает успешно, даже когда задание ещё бежит.
 */
function statusOf(
  status: CardStatus,
  jobStatus: ParsedBashResult["jobStatus"],
): {
  key: string;
  tone: BadgeTone;
} {
  if (jobStatus === "killed") return { key: "tool.status.killed", tone: "danger" };
  if (jobStatus === "completed") return { key: "tool.status.done", tone: "success" };
  if (jobStatus === "running") return { key: "tool.status.running", tone: "accent" };
  if (status === "failed") return { key: "tool.status.failed", tone: "danger" };
  if (status === "done") return { key: "tool.status.done", tone: "success" };
  return { key: "tool.status.running", tone: "accent" };
}

/** Заголовок карточки: команда для bash, имя тула с jobId для job-инструментов. */
function toolTitle(toolName: string, input: unknown): string {
  if (toolName === "bash") {
    const command = (input as { command?: unknown } | null | undefined)?.command;
    return typeof command === "string" && command !== "" ? command : toolName;
  }
  const jobId = (input as { jobId?: unknown } | null | undefined)?.jobId;
  return typeof jobId === "string" && jobId !== "" ? `${toolName} ${jobId}` : toolName;
}

function isBackground(input: unknown): boolean {
  return (input as { run_in_background?: unknown } | null | undefined)?.run_in_background === true;
}

export function BashToolCall({ context }: { context: PlaceContext }): ReactNode {
  const sessionId = context.subject?.sessionId;
  const toolCallId = context.subject?.toolCallId;
  const toolName = context.subject?.toolName ?? "bash";
  const translator = useTranslator(messagesNamespace);
  const events = useSovereignEvents();
  const [data, setData] = useState<ToolCallData | undefined>(undefined);
  const [refusal, setRefusal] = useState<string | undefined>(undefined);
  const [gaveUp, setGaveUp] = useState(false);
  const retries = useRef(0);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const disposed = useRef(false);

  useEffect(() => {
    if (sessionId === undefined || toolCallId === undefined) {
      return;
    }

    disposed.current = false;
    retries.current = 0;
    setGaveUp(false);

    const load = (): void => {
      void fetchEntries(sessionId)
        .then((page) => {
          if (disposed.current) {
            return;
          }
          const found = page === undefined ? undefined : findToolCall(page.entries, toolCallId);
          if (found === undefined) {
            if (retries.current < NO_DATA_RETRY_ATTEMPTS) {
              retries.current += 1;
              retryTimer.current = setTimeout(load, NO_DATA_RETRY_DELAY_MS);
            } else {
              setGaveUp(true);
            }
            return;
          }
          setData(found);
        })
        .catch((cause: unknown) => {
          if (!disposed.current) {
            setRefusal(cause instanceof Error ? cause.message : String(cause));
          }
        });
    };

    load();

    const unsubscribe = events.subscribe((event) => {
      // События без нагрузки (docs/event-bus.md): «состояние сессий изменилось» — повод
      // перечитать записи; догон потока — то же самое, на другой стороне моста.
      if (event.type === "core.sessions.changed" || event.type === "core.stream.gap") {
        retries.current = 0;
        setGaveUp(false);
        load();
      }
    });
    const unsubscribeRecovery = events.subscribeRecovery?.(() => {
      retries.current = 0;
      setGaveUp(false);
      load();
    });

    return () => {
      disposed.current = true;
      if (retryTimer.current !== undefined) {
        clearTimeout(retryTimer.current);
        retryTimer.current = undefined;
      }
      unsubscribe();
      unsubscribeRecovery?.();
    };
  }, [events, sessionId, toolCallId]);

  const t = translator.t;
  const status: CardStatus =
    data?.result === undefined ? "running" : data.result.failed ? "failed" : "done";
  // Разбор результата — один раз на результат: тело бывает большим, а переразбор на каждом рендере
  // (переводы, события) тратил бы время впустую. Ключ — идентичность объекта результата.
  const parsed = useMemo(
    () => (data?.result === undefined ? undefined : parseBashResult(data.result.text)),
    [data?.result],
  );
  const { key: statusKey, tone } = statusOf(status, parsed?.jobStatus);
  const title = data === undefined ? toolName : toolTitle(toolName, data.input);

  const failed = status === "failed";
  const rawOutput = data?.result?.text ?? "";
  // Упавший результат без маркеров — это текст ошибки целиком: он идёт в stderr-секцию.
  const stdout = failed && parsed?.stderr === "" ? "" : (parsed?.stdout ?? "");
  const stderr = failed && parsed?.stderr === "" ? rawOutput : (parsed?.stderr ?? "");

  const badges: ReactNode[] = [];
  if (parsed?.exitCode !== undefined) {
    badges.push(
      <Badge key="exit" tone="danger">
        {t("tool.exitCode", { code: parsed.exitCode })}
      </Badge>,
    );
  } else if (
    toolName === "bash" &&
    data !== undefined &&
    !isBackground(data.input) &&
    parsed !== undefined &&
    !failed &&
    parsed.timedOut !== true &&
    parsed.killedBy === undefined &&
    parsed.jobStatus !== "running" &&
    parsed.jobStatus !== "killed"
  ) {
    badges.push(
      <Badge key="exit" tone="success">
        {t("tool.exitZero")}
      </Badge>,
    );
  }
  if (parsed?.timedOut === true) {
    badges.push(
      <Badge key="timedOut" tone="danger">
        {t("tool.timedOut")}
      </Badge>,
    );
  }
  if (parsed?.killedBy !== undefined) {
    badges.push(
      <Badge key="killed" tone="danger">
        {t("tool.killedBy", { signal: parsed.killedBy })}
      </Badge>,
    );
  }
  if (parsed?.clampedSeconds !== undefined) {
    badges.push(
      <Badge key="clamped" tone="warning">
        {t("tool.clamped", { seconds: parsed.clampedSeconds })}
      </Badge>,
    );
  }
  if (data !== undefined && isBackground(data.input)) {
    badges.push(
      <Badge key="background" tone="neutral">
        {t("tool.background")}
      </Badge>,
    );
  }

  return (
    <div className="starter-bash-tool-call" data-status={status}>
      <Disclosure
        summary={
          <span className="sbtc-summary">
            <span className="sbtc-identity">
              {toolName === "bash" ? (
                <span className="sbtc-prompt" aria-hidden="true">
                  $
                </span>
              ) : undefined}
              <span className="sbtc-title">
                <Code>{title}</Code>
              </span>
            </span>
            <span className="sbtc-outcome">
              <Badge tone={tone}>{t(statusKey)}</Badge>
              {refusal === undefined ? undefined : (
                <Badge tone="danger">{t("tool.failure", { reason: refusal })}</Badge>
              )}
              {gaveUp ? <Badge tone="warning">{t("tool.noData")}</Badge> : undefined}
            </span>
          </span>
        }
      >
        {stdout === "" ? undefined : <CodeBlock>{stdout}</CodeBlock>}
        {stderr === "" ? undefined : (
          <div className="sbtc-stderr">
            <div className="sbtc-stderr-label">{t("tool.stderr")}</div>
            <CodeBlock>{stderr}</CodeBlock>
          </div>
        )}
        {parsed?.noOutput === true ? (
          <Text tone="muted">
            {t(toolName === "job-output" ? "tool.noNewOutput" : "tool.noOutput")}
          </Text>
        ) : undefined}
        {badges.length === 0 ? undefined : <div className="sbtc-footer">{badges}</div>}
        {parsed?.truncatedPath === undefined ? undefined : (
          <Notice tone="warning" title={t("tool.truncated")}>
            {parsed.truncatedPath}
          </Notice>
        )}
        {parsed?.stderrTruncatedPath === undefined ? undefined : (
          <Notice tone="warning" title={t("tool.stderrTruncated")}>
            {parsed.stderrTruncatedPath}
          </Notice>
        )}
        {refusal === undefined ? undefined : (
          <Notice tone="danger" title={t("tool.failure", { reason: refusal })} />
        )}
        {gaveUp ? <Notice tone="warning" title={t("tool.noData")} /> : undefined}
      </Disclosure>
    </div>
  );
}
