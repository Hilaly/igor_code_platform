// @vitest-environment jsdom

/**
 * Первый тест вью на настоящем DOM (docs/backlog.md, срез 7 в docs/roadmap.md). Форма входа выбрана
 * первой не случайно: её поведение целиком в связях, которых не видно ни в разметке первого кадра,
 * ни глазами — какое поле получило фокус, какая жалоба к какому полю относится, что кнопка заперта
 * до годного пароля и что `Enter` отправляет форму, хотя кнопка кита не `type="submit"`.
 *
 * Тесты нашли сами себя: первая версия требовала минимальной длины и на входе, а `credentials.ts`
 * проверяет её только при регистрации — и правильно делает, иначе правило, поднятое после того, как
 * пароль был задан, заперло бы владельца снаружи собственной платформы.
 */

import { minimumPasswordLength } from "@sovereign/protocol";
import { coreEnglish, coreNamespace, coreRussian, createTranslator } from "@sovereign/ui-kit";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LoginView, type LoginViewProps } from "./login-view.tsx";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

afterEach(cleanup);

const translator = createTranslator({
  locale: "ru",
  namespace: coreNamespace,
  catalogs: [coreEnglish, coreRussian],
  onDiagnostic: (diagnostic) => {
    throw new Error(diagnostic);
  },
});

function show(overrides: Partial<LoginViewProps> = {}) {
  const onSubmit = vi.fn();
  const props: LoginViewProps = {
    registering: false,
    refusal: undefined,
    expired: false,
    busy: false,
    onSubmit,
    translator,
    ...overrides,
  };

  render(<LoginView {...props} />);

  return { onSubmit };
}

const passwords = (): HTMLInputElement[] =>
  screen.getAllByLabelText(/пароль/i) as HTMLInputElement[];

const submitButton = (): HTMLButtonElement =>
  screen.getByRole("button", { name: /вой|создать/i }) as HTMLButtonElement;

const type = (field: HTMLInputElement, value: string): void => {
  fireEvent.change(field, { target: { value } });
};

const long = "a".repeat(minimumPasswordLength);

describe("LoginView", () => {
  it("puts the cursor in the password field: the form is one field long", () => {
    show();

    expect(document.activeElement).toBe(passwords()[0]);
  });

  it("keeps the button locked until there is something to send", () => {
    show();

    expect(submitButton().disabled).toBe(true);

    type(passwords()[0] as HTMLInputElement, "any");
    expect(submitButton().disabled).toBe(false);
  });

  it("checks the length only when registering", () => {
    // Длину входа проверяет сервер: правило могло измениться после того, как пароль был задан
    // (`credentials.ts`), и запертая кнопка не пустила бы владельца в собственную платформу.
    show({ registering: true });

    const [password, confirmation] = passwords() as [HTMLInputElement, HTMLInputElement];

    type(password, "short");
    expect(submitButton().disabled).toBe(true);

    type(password, long);
    type(confirmation, long);
    expect(submitButton().disabled).toBe(false);
  });

  it("submits on Enter, though the kit button is never type=submit", () => {
    const { onSubmit } = show();
    const field = passwords()[0] as HTMLInputElement;

    type(field, long);
    fireEvent.keyDown(field, { key: "Enter" });

    expect(onSubmit).toHaveBeenCalledWith(long);
  });

  it("does not submit a password it refuses to accept", () => {
    const { onSubmit } = show({ registering: true });
    const field = passwords()[0] as HTMLInputElement;

    type(field, "short");
    fireEvent.keyDown(field, { key: "Enter" });
    fireEvent.click(submitButton());

    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("hangs the complaint on the field it is about", () => {
    // Обе жалобы приходят из одной функции, и перепутать их местами разметка первого кадра не
    // ловит: `Field` считает непустую строку признаком негодного значения.
    show({ registering: true });

    const [password, confirmation] = passwords() as [HTMLInputElement, HTMLInputElement];

    type(password, "short");

    expect(password.getAttribute("aria-invalid")).toBe("true");
    expect(confirmation.getAttribute("aria-invalid")).toBe("false");

    type(password, long);
    type(confirmation, `${long}!`);

    expect(password.getAttribute("aria-invalid")).toBe("false");
    expect(confirmation.getAttribute("aria-invalid")).toBe("true");
    expect(submitButton().disabled).toBe(true);
  });

  it("asks for the password twice only when registering", () => {
    show();
    expect(passwords()).toHaveLength(1);

    cleanup();

    show({ registering: true });
    expect(passwords()).toHaveLength(2);
  });

  it("shows the refusal of the daemon and the expired session together", () => {
    show({ refusal: "the password is not the one", expired: true });

    expect(screen.getByText("the password is not the one")).toBeDefined();
    expect(screen.getByText(translator.t("login.expired"))).toBeDefined();
  });

  it("locks the whole form while the request is in flight", () => {
    show({ busy: true });

    expect(submitButton().disabled).toBe(true);
    expect((passwords()[0] as HTMLInputElement).disabled).toBe(true);
  });
});
