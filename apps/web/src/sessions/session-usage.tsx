/**
 * Раздельные показатели открытой сессии. Контекст отвечает на оставшееся место в активной ветке,
 * а токены и стоимость — на уже потраченное по всему файлу, поэтому их нельзя смешивать в одно
 * число или скрывать один вместе с другим.
 */

import type { SessionContextUsage, SessionStats } from "@sovereign/protocol";
import { Progress, Tooltip, type ProgressTone, type ScopedTranslator } from "@sovereign/ui-kit";
import type React from "react";

export function contextTone(context: SessionContextUsage | undefined): ProgressTone {
  const share =
    context?.contextWindow === undefined || context.contextWindow <= 0
      ? undefined
      : context.tokens / context.contextWindow;
  const warningAt =
    context !== undefined && context.threshold > 0 && context.threshold < 1
      ? context.threshold
      : 0.8;

  return share !== undefined && share >= 1
    ? "danger"
    : share !== undefined && share >= warningAt
      ? "warning"
      : "accent";
}

export type SessionUsageProps = {
  stats: SessionStats | undefined;
  context: SessionContextUsage | undefined;
  translator: ScopedTranslator;
};

function contextShare(context: SessionContextUsage | undefined): number | undefined {
  return context?.contextWindow === undefined || context.contextWindow <= 0
    ? undefined
    : context.tokens / context.contextWindow;
}

export function SessionUsage({ stats, context, translator }: SessionUsageProps): React.JSX.Element {
  const { t } = translator;
  const share = contextShare(context);
  const contextDetails =
    context === undefined ? (
      <div>—</div>
    ) : share === undefined ? (
      <div>{t("chat.context.window-unknown", { used: String(context.tokens) })}</div>
    ) : (
      <>
        <div>
          {t("chat.context.share", {
            used: String(Math.round(share * 100)),
            left: String(Math.max(0, 100 - Math.round(share * 100))),
          })}
        </div>
        <div>
          {t("chat.context.tokens-used", {
            used: String(context.tokens),
            window: String(context.contextWindow),
          })}
        </div>
      </>
    );

  return (
    <Tooltip
      side="top"
      content={
        <div className="sessions-usage-tooltip">
          <div className="sessions-usage-tooltip-section">
            <div className="sessions-usage-tooltip-title">{t("chat.context.window.title")}</div>
            {contextDetails}
          </div>
          <hr />
          <div className="sessions-usage-tooltip-section">
            <div className="sessions-usage-tooltip-title">{t("chat.stats.title")}</div>
            <div>
              {t("chat.stats.tokens", {
                total: stats === undefined ? "—" : String(stats.totalTokens),
              })}
            </div>
            <div>
              {stats === undefined
                ? t("chat.stats.cost.unavailable")
                : t("chat.stats.cost", { cost: stats.costTotal.toFixed(4) })}
            </div>
          </div>
        </div>
      }
    >
      <Progress
        variant="circular"
        value={share}
        tone={contextTone(context)}
        label={t("chat.context.label")}
        tabIndex={0}
      />
    </Tooltip>
  );
}
