import { Badge, Notice, type Translator } from "@sovereign/ui-kit";
import type { CSSProperties, ReactNode } from "react";

import { summarizeUsage, type UsageRecord, type UsageState } from "./usage-state.ts";

export type UsageViewProps = {
  state: UsageState;
  translator: Translator;
};

const sessionName = ({ session }: UsageRecord): string => session.title ?? session.id;

function Metric({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="usage-metric" role="group" aria-label={label}>
      <span className="usage-metric-label">{label}</span>
      <strong className="usage-metric-value">{children}</strong>
    </div>
  );
}

export function UsageView({ state, translator }: UsageViewProps) {
  const { t, formatNumber } = translator;

  if (state.status === "loading") {
    return <p role="status">{t("usage.loading")}</p>;
  }

  if (state.status === "failed") {
    return (
      <Notice tone="danger" title={t("usage.failure.title")}>
        {state.failure}
      </Notice>
    );
  }

  const { snapshot } = state;

  if (snapshot.listedSessionCount === 0 && snapshot.problems.length === 0) {
    return <p role="status">{t("usage.empty")}</p>;
  }

  const totals = summarizeUsage(snapshot.records);
  const maximumTokens = Math.max(0, ...snapshot.records.map(({ stats }) => stats.totalTokens));

  return (
    <div className="usage-view">
      {snapshot.problems.length === 0 ? undefined : (
        <Notice
          tone="warning"
          title={
            snapshot.catalogComplete
              ? t("usage.partial", {
                  loaded: snapshot.records.length,
                  listed: snapshot.listedSessionCount,
                })
              : t("usage.partial.catalog")
          }
        >
          <ul className="usage-problems">
            {snapshot.problems.map((problem, index) => (
              <li key={`${String(index)}:${problem}`}>{problem}</li>
            ))}
          </ul>
        </Notice>
      )}

      {snapshot.records.length === 0 ? (
        <p role="status">{t("usage.unavailable")}</p>
      ) : (
        <>
          <section className="usage-totals" aria-label={t("usage.totals")}>
            <Metric label={t("usage.metric.sessions")}>{formatNumber(totals.sessions)}</Metric>
            <Metric label={t("usage.metric.messages")}>{formatNumber(totals.messages)}</Metric>
            <Metric label={t("usage.metric.tokens")}>{formatNumber(totals.totalTokens)}</Metric>
            <Metric label={t("usage.metric.cached")}>{formatNumber(totals.cachedTokens)}</Metric>
            <Metric label={t("usage.metric.uncached")}>
              {formatNumber(totals.uncachedTokens)}
            </Metric>
            <Metric label={t("usage.metric.cost")}>${totals.cost.toFixed(4)}</Metric>
          </section>

          <section className="usage-section" aria-labelledby="usage-chart-title">
            <h2 id="usage-chart-title">{t("usage.chart.title")}</h2>
            <ol className="usage-chart" aria-label={t("usage.chart.title")}>
              {snapshot.records.map((record) => {
                const share = maximumTokens === 0 ? 0 : record.stats.totalTokens / maximumTokens;
                return (
                  <li key={record.session.id}>
                    <span className="usage-chart-name">{sessionName(record)}</span>
                    <span className="usage-chart-track" aria-hidden="true">
                      <span
                        className="usage-chart-bar"
                        style={{ "--usage-share": String(share) } as CSSProperties}
                      />
                    </span>
                    <span className="usage-chart-value">
                      {formatNumber(record.stats.totalTokens)}
                    </span>
                  </li>
                );
              })}
            </ol>
          </section>

          <section className="usage-section" aria-labelledby="usage-table-title">
            <h2 id="usage-table-title">{t("usage.table.title")}</h2>
            <div className="usage-table-scroll">
              <table className="usage-table" aria-label={t("usage.table.title")}>
                <thead>
                  <tr>
                    <th scope="col">{t("usage.column.session")}</th>
                    <th scope="col">{t("usage.metric.messages")}</th>
                    <th scope="col">{t("usage.metric.cached")}</th>
                    <th scope="col">{t("usage.metric.uncached")}</th>
                    <th scope="col">{t("usage.metric.tokens")}</th>
                    <th scope="col">{t("usage.metric.cost")}</th>
                  </tr>
                </thead>
                <tbody>
                  {snapshot.records.map((record) => (
                    <tr key={record.session.id}>
                      <th scope="row">
                        <span>{sessionName(record)}</span>
                        {record.session.archived ? (
                          <Badge tone="neutral">{t("usage.archived")}</Badge>
                        ) : undefined}
                      </th>
                      <td>{formatNumber(record.stats.messageCount)}</td>
                      <td>{formatNumber(record.stats.cachedTokens)}</td>
                      <td>{formatNumber(record.stats.uncachedTokens)}</td>
                      <td>{formatNumber(record.stats.totalTokens)}</td>
                      <td>${record.stats.costTotal.toFixed(4)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
