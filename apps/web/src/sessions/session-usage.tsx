/**
 * Раздельные показатели открытой сессии. Контекст отвечает на оставшееся место в активной ветке,
 * а токены и стоимость — на уже потраченное по всему файлу, поэтому их нельзя смешивать в одно
 * число или скрывать один вместе с другим.
 */

import type { SessionContextUsage, SessionStats } from "@sovereign/protocol";
import { Progress, Text, type ProgressTone, type ScopedTranslator } from "@sovereign/ui-kit";
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
  const contextValue =
    context === undefined
      ? "—"
      : share === undefined
        ? t("chat.context.window-unknown", { used: String(context.tokens) })
        : t("chat.context.value", {
            used: String(context.tokens),
            window: String(context.contextWindow),
            percent: String(Math.round(share * 100)),
          });

  return (
    <div className="sessions-usage">
      <div className="sessions-usage-context" role="group" aria-label={t("chat.context.title")}>
        <Text tone="muted">{t("chat.context.title")}</Text>
        <Text tone="muted">{contextValue}</Text>
        {share === undefined ? undefined : (
          <Progress value={share} tone={contextTone(context)} label={t("chat.context.label")} />
        )}
      </div>

      <div className="sessions-usage-stat" role="group" aria-label={t("chat.stats.tokens.label")}>
        <Text tone="muted">{t("chat.stats.tokens.label")}</Text>
        <Text tone="muted">{stats === undefined ? "—" : String(stats.totalTokens)}</Text>
      </div>

      <div className="sessions-usage-stat" role="group" aria-label={t("chat.stats.cost.label")}>
        <Text tone="muted">{t("chat.stats.cost.label")}</Text>
        <Text tone="muted">{stats === undefined ? "—" : `$${stats.costTotal.toFixed(4)}`}</Text>
      </div>
    </div>
  );
}
