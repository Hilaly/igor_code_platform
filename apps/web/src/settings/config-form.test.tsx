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

const show = (
  current: ConfigState,
  onChange: (key: keyof Config, value: Config[keyof Config]) => void = () => {},
) => render(<ConfigForm state={current} onChange={onChange} translator={translator} />);

const field = (name: string): HTMLInputElement =>
  screen.getByRole("textbox", { name }) as HTMLInputElement;

it("waits for the snapshot instead of showing made-up values", () => {
  show(state({ config: undefined }));

  expect(screen.getByText("Загрузка…")).toBeTruthy();
});

it("commits a valid numeric field on blur without a shared Save control", () => {
  const onChange = vi.fn();

  show(state(), onChange);

  expect(field("Одновременных обращений").value).toBe("4");

  fireEvent.change(field("Вызовов публичного маршрута в минуту"), { target: { value: "3" } });
  fireEvent.blur(field("Вызовов публичного маршрута в минуту"));

  expect(onChange).toHaveBeenCalledWith("publicRouteRequestsPerMinute", 3);
  expect(screen.queryByRole("button", { name: "Сохранить" })).toBeNull();
});

it("commits a valid numeric field when Enter finishes editing", () => {
  const onChange = vi.fn();

  show(state(), onChange);

  fireEvent.change(field("Одновременных обращений"), { target: { value: "8" } });
  fireEvent.keyDown(field("Одновременных обращений"), { key: "Enter" });

  expect(onChange).toHaveBeenCalledWith("maxConcurrentTurns", 8);
});

it("does not commit the same numeric text again when Enter is followed by blur", () => {
  const onChange = vi.fn();

  show(state(), onChange);

  fireEvent.change(field("Одновременных обращений"), { target: { value: "8" } });
  fireEvent.keyDown(field("Одновременных обращений"), { key: "Enter" });
  fireEvent.blur(field("Одновременных обращений"));

  expect(onChange).toHaveBeenCalledTimes(1);
  expect(onChange).toHaveBeenCalledWith("maxConcurrentTurns", 8);

  fireEvent.change(field("Одновременных обращений"), { target: { value: "9" } });
  fireEvent.blur(field("Одновременных обращений"));

  expect(onChange).toHaveBeenCalledTimes(2);
  expect(onChange).toHaveBeenLastCalledWith("maxConcurrentTurns", 9);
});

it("marks an invalid or empty numeric string without sending it", () => {
  const onChange = vi.fn();

  show(state(), onChange);

  fireEvent.change(field("Ожидание хука, мс"), { target: { value: "быстро" } });

  expect(field("Ожидание хука, мс").getAttribute("aria-invalid")).toBe("true");
  fireEvent.blur(field("Ожидание хука, мс"));

  fireEvent.change(field("Ожидание хука, мс"), { target: { value: "" } });
  expect(field("Ожидание хука, мс").getAttribute("aria-invalid")).toBe("true");
  fireEvent.keyDown(field("Ожидание хука, мс"), { key: "Enter" });

  expect(onChange).not.toHaveBeenCalled();
});

it("commits a selected log level immediately", () => {
  const onChange = vi.fn();

  show(state(), onChange);

  const select = screen.getByRole("combobox", { name: "Уровень журнала" });
  fireEvent.click(select);
  fireEvent.click(screen.getByRole("option", { name: "warn" }));

  expect(onChange).toHaveBeenCalledWith("logLevel", "warn");
});

it("shows the refusal of the daemon as it came", () => {
  show(state({ refusal: "config.json: maxConcurrentTurns must be an integer above zero, got 0" }));

  expect(
    screen.getByText("config.json: maxConcurrentTurns must be an integer above zero, got 0"),
  ).toBeTruthy();
});

it("takes the latest daemon snapshot when no control has a refusal", () => {
  const view = show(state());

  view.rerender(
    <ConfigForm
      state={state({ config: { ...defaultConfig, maxConcurrentTurns: 9 } })}
      onChange={() => {}}
      translator={translator}
    />,
  );

  expect(field("Одновременных обращений").value).toBe("9");
});

it("keeps typed numeric text when an external snapshot arrives before blur", () => {
  const view = show(state());

  fireEvent.change(field("Одновременных обращений"), { target: { value: "8" } });
  view.rerender(
    <ConfigForm
      state={state({ config: { ...defaultConfig, maxConcurrentTurns: 9 } })}
      onChange={() => {}}
      translator={translator}
    />,
  );

  expect(field("Одновременных обращений").value).toBe("8");
});

it("keeps typed text visible after a daemon refusal reloads the snapshot", () => {
  const view = show(state());

  fireEvent.change(field("Ожидание хука, мс"), { target: { value: "9000" } });

  view.rerender(
    <ConfigForm
      state={state({
        config: { ...defaultConfig, maxConcurrentTurns: 9 },
        refusal: "config.json: EACCES",
      })}
      onChange={() => {}}
      translator={translator}
    />,
  );

  expect(field("Ожидание хука, мс").value).toBe("9000");
  expect(screen.getByText("config.json: EACCES")).toBeTruthy();
});

it("keeps a retry value while its request clears the previous refusal", () => {
  const view = show(state());
  const reloaded = { ...defaultConfig };

  fireEvent.change(field("Одновременных обращений"), { target: { value: "0" } });
  view.rerender(
    <ConfigForm
      state={state({
        config: reloaded,
        refusal: "config.json: maxConcurrentTurns must be above zero",
      })}
      onChange={() => {}}
      translator={translator}
    />,
  );

  fireEvent.change(field("Одновременных обращений"), { target: { value: "0.5" } });
  view.rerender(
    <ConfigForm
      state={state({ config: reloaded, refusal: undefined })}
      onChange={() => {}}
      translator={translator}
    />,
  );

  expect(field("Одновременных обращений").value).toBe("0.5");
});
