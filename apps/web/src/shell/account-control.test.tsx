// @vitest-environment jsdom

import { coreEnglish, coreNamespace, coreRussian, createTranslator } from "@sovereign/ui-kit";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { AccountControl } from "./account-control.tsx";

afterEach(cleanup);

const translator = createTranslator({
  locale: "ru",
  namespace: coreNamespace,
  catalogs: [coreEnglish, coreRussian],
  onDiagnostic: (diagnostic) => {
    throw new Error(diagnostic);
  },
});

it("shows one small daemon indicator next to the account menu", () => {
  render(
    <AccountControl
      stream="open"
      onOpenArchive={vi.fn()}
      onOpenSettings={vi.fn()}
      onLogOut={vi.fn()}
      translator={translator}
    />,
  );
  expect(screen.getAllByRole("status")).toHaveLength(1);
  expect(screen.getByRole("status", { name: "На связи" })).toBeTruthy();
});

it("opens archived sessions from the account menu", () => {
  const onOpenArchive = vi.fn();
  render(
    <AccountControl
      stream="reconnecting"
      onOpenArchive={onOpenArchive}
      onOpenSettings={vi.fn()}
      onLogOut={vi.fn()}
      translator={translator}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Учётная запись" }));
  fireEvent.click(screen.getByRole("menuitem", { name: "Архивные сессии" }));
  expect(onOpenArchive).toHaveBeenCalledOnce();
});
