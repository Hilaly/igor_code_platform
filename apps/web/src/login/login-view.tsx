/**
 * Вход в интерфейс. Оболочки вокруг нет намеренно: невошедшему нечего показать ни в списке вью, ни в
 * состоянии демона — всё это защищённые маршруты, и панели вокруг формы были бы пустыми рамками.
 *
 * Форма одна на вход и на регистрацию, потому что различается она одним полем: учётная запись
 * создаётся первым входом (docs/authentication.md), и повтор пароля нужен ровно в этот раз — опечатка
 * стала бы единственным паролем владельца.
 */

import { minimumPasswordLength } from "@sovereign/protocol";
import {
  Button,
  Field,
  Form,
  Heading,
  Input,
  Notice,
  Panel,
  Text,
  type ScopedTranslator,
} from "@sovereign/ui-kit";
import { useEffect, useRef, useState } from "react";

import { checkCredentials, type CredentialsProblem } from "./credentials.ts";

export type LoginViewProps = {
  /** Регистрация отличается от входа повтором пароля и текстами, а не отдельной формой. */
  registering: boolean;
  /** Отказ демона: неверный пароль, слишком короткий пароль, недоступный демон. */
  refusal: string | undefined;
  /** Сессия кончилась под работающим интерфейсом, а не «человек только что открыл страницу». */
  expired: boolean;
  busy: boolean;
  onSubmit: (password: string) => void;
  translator: ScopedTranslator;
};

export function LoginView({
  registering,
  refusal,
  expired,
  busy,
  onSubmit,
  translator,
}: LoginViewProps) {
  const { t } = translator;
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const field = useRef<HTMLInputElement>(null);

  // Фокус ставится здесь, а не пропом `autoFocus`: у кита его нет, а форма из одного поля — ровно
  // тот случай, когда человек ожидает начать печатать сразу.
  useEffect(() => {
    field.current?.focus();
  }, []);

  const check = checkCredentials(password, registering ? confirmation : undefined);

  const submit = (): void => {
    if (check.kind !== "ready" || busy) {
      return;
    }

    onSubmit(password);
  };

  return (
    <main className="login">
      <Form onSubmit={submit} disabled={check.kind !== "ready" || busy}>
        {/* Раскладку держит внутренний контейнер: кит-`Form` не принимает `className`, а её
            `display: contents` вынимает форму из потока. Кнопка кита всегда `type="button"`, поэтому
            сабмит идёт только через Enter (его ловит форма) и через явный `onClick`. */}
        <div className="login-form">
          <Panel>
            <div className="login-body">
              <Heading level={1}>
                {t(registering ? "login.registration.title" : "login.title")}
              </Heading>
              <Text tone="muted">{t(registering ? "login.registration.hint" : "login.hint")}</Text>

              {expired ? <Notice tone="warning" title={t("login.expired")} /> : undefined}
              {refusal === undefined ? undefined : <Notice tone="danger" title={refusal} />}

              <Field
                label={t("login.password")}
                error={problemOf(check, "too-short", translator)}
                hint={
                  registering
                    ? t("login.password.hint", { count: minimumPasswordLength })
                    : undefined
                }
              >
                {(control) => (
                  <Input
                    {...control}
                    ref={field}
                    type="password"
                    autoComplete={registering ? "new-password" : "current-password"}
                    value={password}
                    onChange={setPassword}
                    disabled={busy}
                  />
                )}
              </Field>

              {registering ? (
                <Field
                  label={t("login.confirmation")}
                  error={problemOf(check, "mismatch", translator)}
                >
                  {(control) => (
                    <Input
                      {...control}
                      type="password"
                      autoComplete="new-password"
                      value={confirmation}
                      onChange={setConfirmation}
                      disabled={busy}
                    />
                  )}
                </Field>
              ) : undefined}

              <Button tone="accent" onClick={submit} disabled={check.kind !== "ready"} busy={busy}>
                {t(registering ? "login.registration.submit" : "login.submit")}
              </Button>
            </div>
          </Panel>
        </div>
      </Form>
    </main>
  );
}

/**
 * Текст ошибки показывается тому полю, к которому он относится: «слишком короткий» — первому,
 * «не совпадают» — второму. `Field` считает непустую строку признаком негодного значения, поэтому
 * чужая жалоба обязана прийти сюда пустой строкой, а не текстом.
 */
function problemOf(
  check: ReturnType<typeof checkCredentials>,
  mine: CredentialsProblem,
  translator: ScopedTranslator,
): string {
  if (check.kind !== "problem" || check.problem !== mine) {
    return "";
  }

  return mine === "too-short"
    ? translator.t("login.problem.tooShort", { count: minimumPasswordLength })
    : translator.t("login.problem.mismatch");
}
