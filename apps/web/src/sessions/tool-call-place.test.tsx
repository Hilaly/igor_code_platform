// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";

const captured = vi.hoisted(() => ({
  props: undefined as { id: string; context: unknown; builtIn: ReactNode } | undefined,
}));

vi.mock("../places/place-host.tsx", () => ({
  HostPlace: (props: { id: string; context: unknown; builtIn: ReactNode }) => {
    captured.props = props;
    return props.builtIn;
  },
}));

import { ToolCallPlace } from "./tool-call-place.tsx";

afterEach(() => {
  captured.props = undefined;
  cleanup();
});

it("addresses the exact tool place and keeps the existing ToolCall as fallback", () => {
  render(
    <ToolCallPlace
      sessionId="session-1"
      projectId="project-1"
      toolCallId="call-1"
      icon="◇"
      toolName="spawn_agent"
      status="running"
      statusLabel="Выполняется"
      argumentsText="{}"
    />,
  );

  expect(captured.props).toMatchObject({
    id: "core.session.tool-call.t-737061776e5f6167656e74",
    context: {
      project: "project-1",
      subject: {
        sessionId: "session-1",
        toolCallId: "call-1",
        toolName: "spawn_agent",
      },
    },
  });
  expect(screen.getByText("spawn_agent")).toBeTruthy();
  expect(screen.getByText("Выполняется")).toBeTruthy();
});

it("omits project context when the session summary is not loaded yet", () => {
  render(
    <ToolCallPlace
      sessionId="session-1"
      toolCallId="call-2"
      toolName="read"
      status="done"
      statusLabel="Готово"
      argumentsText="{}"
    />,
  );

  expect(captured.props?.context).toEqual({
    subject: { sessionId: "session-1", toolCallId: "call-2", toolName: "read" },
  });
});
