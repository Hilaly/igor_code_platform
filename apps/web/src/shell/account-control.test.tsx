// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { coreEnglish, coreNamespace, coreRussian, createTranslator } from "@sovereign/ui-kit";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, expect, it, vi } from "vitest";

import { AccountControl } from "./account-control.tsx";

afterEach(cleanup);

const shellStyles = readFileSync(join(import.meta.dirname, "shell.css"), "utf8");
const shellStyleElement = document.createElement("style");
shellStyleElement.textContent = shellStyles;

beforeAll(() => {
  document.head.append(shellStyleElement);
});

afterAll(() => {
  shellStyleElement.remove();
});

const translator = createTranslator({
  locale: "ru",
  namespace: coreNamespace,
  catalogs: [coreEnglish, coreRussian],
  onDiagnostic: (diagnostic) => {
    throw new Error(diagnostic);
  },
});

it("shows one compact account trigger with an icon and daemon indicator", () => {
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
  const trigger = screen.getByRole("button", { name: "Учётная запись" });
  expect(trigger.querySelector("svg")).toBeTruthy();
  expect(trigger.textContent).toContain("Учётная запись");
  expect(trigger.contains(screen.getByRole("status", { name: "На связи" }))).toBe(true);
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

it("keeps the opened account menu visible outside the footer row", () => {
  render(
    <AccountControl
      stream="open"
      onOpenArchive={vi.fn()}
      onOpenSettings={vi.fn()}
      onLogOut={vi.fn()}
      translator={translator}
    />,
  );

  const trigger = screen.getByRole("button", { name: "Учётная запись" });
  fireEvent.click(trigger);

  screen.getByRole("menu", { name: "Учётная запись" });
  const menuRoot = trigger.parentElement;

  expect(menuRoot).not.toBeNull();
  expect(getComputedStyle(menuRoot!).overflow).not.toBe("hidden");
});
