// @vitest-environment jsdom

import { coreEnglish, coreNamespace, coreRussian, createTranslator } from "@sovereign/ui-kit";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";

import type { OpenSession } from "./state.ts";
import { SessionRouteView } from "./session-route-view.tsx";

afterEach(cleanup);

const translator = createTranslator({
  locale: "ru",
  namespace: coreNamespace,
  catalogs: [coreEnglish, coreRussian],
  onDiagnostic: (diagnostic) => {
    throw new Error(diagnostic);
  },
});

const open = (id: string, loading: boolean, summary: OpenSession["summary"]): OpenSession => ({
  id,
  loading,
  summary,
  entries: [],
  seen: 0,
  pending: {},
  labels: new Map(),
  branchEntryIds: new Set(),
  degradations: [],
});

it("does not render the previous session while a new direct route loads", () => {
  render(
    <SessionRouteView
      sessionId="next"
      open={open("previous", false, undefined)}
      translator={translator}
    >
      <div>previous chat</div>
    </SessionRouteView>,
  );

  expect(screen.getByRole("status")).toBeTruthy();
  expect(screen.queryByText("previous chat")).toBeNull();
});

it("shows the gone state after the requested session resolves without a summary", () => {
  render(
    <SessionRouteView
      sessionId="gone"
      open={open("gone", false, undefined)}
      translator={translator}
    >
      <div>chat</div>
    </SessionRouteView>,
  );

  expect(screen.getByText("Такой сессии нет")).toBeTruthy();
  expect(screen.queryByText("chat")).toBeNull();
});
