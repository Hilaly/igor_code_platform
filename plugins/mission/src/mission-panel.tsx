import type { PlaceContext } from "@sovereign/browser-sdk";
import { useSovereignEvents } from "@sovereign/browser-sdk";
import {
  Badge,
  EmptyState,
  Heading,
  List,
  ListRow,
  Notice,
  Progress,
  Spinner,
  Text,
} from "@sovereign/ui-kit";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { fetchMission } from "./api.ts";
import type { MissionSnapshot } from "./model.ts";
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
  return (
    <section className="mission-panel" aria-label="Mission">
      <Heading level={2}>Mission</Heading>
      {state.kind === "loading" ? <Spinner label="Loading mission" /> : undefined}
      {state.kind === "empty" ? (
        <EmptyState title={sessionId === undefined ? "No active session" : "No mission yet"} />
      ) : undefined}
      {state.kind === "error" ? (
        <Notice tone="danger" title={`Could not read mission: ${state.reason}`} />
      ) : undefined}
      {state.kind === "ready" ? <MissionSnapshotView snapshot={state.snapshot} /> : undefined}
    </section>
  );
}

function MissionSnapshotView({ snapshot }: { snapshot: MissionSnapshot }): ReactNode {
  const completed = snapshot.plan.filter((step) => step.status === "completed").length;
  const active = snapshot.plan.find((step) => step.status === "in_progress");
  return (
    <div className="mission-content">
      <Text>{snapshot.mission}</Text>
      {snapshot.explanation === undefined ? undefined : (
        <Text tone="muted">{snapshot.explanation}</Text>
      )}
      <Text tone="muted">Updated {formatUpdatedAt(snapshot.updatedAt)}</Text>
      <Progress label="Mission progress" value={completed / snapshot.plan.length} />
      {active === undefined ? undefined : <Badge tone="neutral">{"Current: " + active.step}</Badge>}
      <List>
        {snapshot.plan.map((step, index) => (
          <ListRow key={`${index}-${step.step}`}>
            <span className={`mission-step mission-step-${step.status}`}>
              <Text>{step.step}</Text>
              <Text tone="muted">{step.status.replace("_", " ")}</Text>
            </span>
          </ListRow>
        ))}
      </List>
    </div>
  );
}

function formatUpdatedAt(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function isMissionChanged(value: unknown): value is { sessionId: string; revision: number } {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return typeof record.sessionId === "string" && typeof record.revision === "number";
}
