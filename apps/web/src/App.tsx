import { healthPath, type Health } from "@sovereign/protocol";
import { useEffect, useState } from "react";

import { formatUptime } from "./uptime.ts";

type State =
  { kind: "loading" } | { kind: "ready"; health: Health } | { kind: "failed"; reason: string };

export function App() {
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    const controller = new AbortController();

    fetch(healthPath, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`demon answered ${response.status}`);
        }
        return (await response.json()) as Health;
      })
      .then((health) => setState({ kind: "ready", health }))
      .catch((error: unknown) => {
        if (controller.signal.aborted) {
          return;
        }
        setState({
          kind: "failed",
          reason: error instanceof Error ? error.message : String(error),
        });
      });

    return () => controller.abort();
  }, []);

  return (
    <main>
      <h1>Sovereign Platform</h1>
      {state.kind === "loading" && <p>Соединение с демоном…</p>}
      {state.kind === "failed" && <p>Демон недоступен: {state.reason}</p>}
      {state.kind === "ready" && (
        <p>
          Демон на связи, работает {formatUptime(state.health.uptimeSeconds)}. Запущен{" "}
          {new Date(state.health.startedAt).toLocaleString("ru-RU")}.
        </p>
      )}
    </main>
  );
}
