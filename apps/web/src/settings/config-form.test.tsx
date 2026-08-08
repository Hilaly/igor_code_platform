// @vitest-environment jsdom

/**
 * Форма конфига в отрисовке. Правила черновика проверены отдельно (`config-draft.test.ts`), здесь —
 * то, чего у правил нет: что показано человеку и что уезжает демону.
 *
 * Главное — врезка «файл изменился под открытой формой»: правка `config.json` руками на живом демоне
 * доезжает до открытой вкладки, и потерять набранное в этот момент нельзя (docs/data-directory.md).
 */

import { defaultConfig, type Config } from "@sovereign/protocol";
import { coreEnglish, coreNamespace, coreRussian, createTranslator } from "@sovereign/ui-kit";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { ConfigForm } from "./config-form.tsx";
import type { ConfigState } from "./use-config.ts";

afterEach(cleanup);

const translator = createTranslator({
  locale: "ru",
  namespace: coreNamespace,
  catalogs: [coreEnglish, coreRussian],
  onDiagnostic: (diagnostic) => {
    throw new Error(diagnostic);
  },
});

const state = (overrides: Partial<ConfigState> = {}): ConfigState => ({
  config: defaultConfig,
  failure: undefined,
  refusal: undefined,
  ...overrides,
});

const show = (current: ConfigState, onSave: (config: Config) => void = () => {}) =>
  render(<ConfigForm state={current} onSave={onSave} translator={translator} />);

const field = (name: string): HTMLInputElement =>
  screen.getByRole("textbox", { name }) as HTMLInputElement;

it("waits for the snapshot instead of showing made-up values", () => {
  show(state({ config: undefined }));

  expect(screen.getByText("Загрузка…")).toBeTruthy();
});

it("shows the values of the snapshot and saves the whole document", () => {
  const onSave = vi.fn();

  show(state(), onSave);

  expect(field("Одновременных обращений").value).toBe("4");

  fireEvent.change(field("Вызовов публичного маршрута в минуту"), { target: { value: "3" } });
  fireEvent.click(screen.getByRole("button", { name: "Сохранить" }));

  expect(onSave).toHaveBeenCalledWith({ ...defaultConfig, publicRouteRequestsPerMinute: 3 });
});

it("does not offer to save what nobody changed", () => {
  show(state());

  expect(screen.getByRole("button", { name: "Сохранить" }).hasAttribute("disabled")).toBe(true);
});

it("names the fields that are not numbers and does not send them", () => {
  const onSave = vi.fn();

  show(state(), onSave);

  fireEvent.change(field("Ожидание хука, мс"), { target: { value: "быстро" } });

  expect(screen.getByText("Это не числа: hookTimeoutMilliseconds")).toBeTruthy();
  expect(field("Ожидание хука, мс").getAttribute("aria-invalid")).toBe("true");

  fireEvent.click(screen.getByRole("button", { name: "Сохранить" }));
  expect(onSave).not.toHaveBeenCalled();
});

it("shows the refusal of the daemon as it came", () => {
  show(state({ refusal: "config.json: maxConcurrentTurns must be an integer above zero, got 0" }));

  expect(
    screen.getByText("config.json: maxConcurrentTurns must be an integer above zero, got 0"),
  ).toBeTruthy();
});

it("takes the file while the form is untouched", () => {
  const view = show(state());

  view.rerender(
    <ConfigForm
      state={state({ config: { ...defaultConfig, maxConcurrentTurns: 9 } })}
      onSave={() => {}}
      translator={translator}
    />,
  );

  expect(field("Одновременных обращений").value).toBe("9");
  expect(screen.queryByText("config.json изменился на диске, пока вы его правили")).toBeNull();
});

it("keeps the edit and says the file changed underneath it", () => {
  const view = show(state());

  fireEvent.change(field("Ожидание хука, мс"), { target: { value: "9000" } });

  view.rerender(
    <ConfigForm
      state={state({ config: { ...defaultConfig, maxConcurrentTurns: 9 } })}
      onSave={() => {}}
      translator={translator}
    />,
  );

  expect(field("Ожидание хука, мс").value).toBe("9000");
  expect(screen.getByText("config.json изменился на диске, пока вы его правили")).toBeTruthy();

  fireEvent.click(screen.getByRole("button", { name: "Взять из файла" }));

  expect(field("Ожидание хука, мс").value).toBe(String(defaultConfig.hookTimeoutMilliseconds));
  expect(field("Одновременных обращений").value).toBe("9");
  expect(screen.queryByText("config.json изменился на диске, пока вы его правили")).toBeNull();
});

it("says nothing about a collision when the snapshot caught up with the edit", () => {
  // Собственная запись доехала обратно тем же значением: это не чужая правка файла.
  const view = show(state());

  fireEvent.change(field("Одновременных обращений"), { target: { value: "9" } });

  view.rerender(
    <ConfigForm
      state={state({ config: { ...defaultConfig, maxConcurrentTurns: 9 } })}
      onSave={() => {}}
      translator={translator}
    />,
  );

  expect(screen.queryByText("config.json изменился на диске, пока вы его правили")).toBeNull();
  expect(screen.getByRole("button", { name: "Сохранить" }).hasAttribute("disabled")).toBe(true);
});
