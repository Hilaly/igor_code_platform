import type { SessionPhase } from "@sovereign/protocol";
import { OrbitingBrandMark, Text, type Translator } from "@sovereign/ui-kit";
import { useEffect, useRef, useState } from "react";

import { formatUptime } from "../uptime.ts";

export type AgentActivityProps = {
  sessionId: string;
  phase: SessionPhase;
  totalTokens?: number;
  translator: Translator;
};

export function AgentActivity(props: AgentActivityProps): React.JSX.Element | null {
  if (props.phase === "idle") {
    return null;
  }

  return <ActiveAgentActivity key={props.sessionId} {...props} />;
}

function ActiveAgentActivity({ phase, totalTokens, translator }: AgentActivityProps) {
  const startedAt = useRef(Date.now());
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  useEffect(() => {
    const update = (): void => {
      setElapsedSeconds(Math.max(0, Math.floor((Date.now() - startedAt.current) / 1_000)));
    };
    const timer = window.setInterval(update, 1_000);
    return () => window.clearInterval(timer);
  }, []);

  const duration = formatUptime(elapsedSeconds, {
    hours: (count) => translator.t("duration.hours", { count }),
    minutes: (count) => translator.t("duration.minutes", { count }),
    seconds: (count) => translator.t("duration.seconds", { count }),
  });
  const tokens =
    totalTokens === undefined
      ? undefined
      : translator.t("chat.activity.tokens", {
          total: translator.formatNumber(totalTokens, {
            notation: "compact",
            maximumFractionDigits: 1,
          }),
        });
  const label = [translator.t(`sessions.phase.${phase}`), duration, tokens]
    .filter((part): part is string => part !== undefined)
    .join(" · ");

  return (
    <div
      className="sessions-agent-activity"
      role="status"
      aria-live="off"
      aria-label={label}
      title={label}
    >
      <OrbitingBrandMark size="md" />
      <span className="sessions-agent-activity-text">
        <Text tone="muted">{label}</Text>
      </span>
    </div>
  );
}
