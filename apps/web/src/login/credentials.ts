/**
 * Что не так с введённым в форму входа. Отдельно от разметки, потому что это правило, а не вид:
 * «пароли не совпадают» не должно загораться на первом символе первого поля. Разметку и связи
 * проверяет `login-view.test.tsx` на настоящем DOM.
 *
 * Проверка здесь не заменяет серверную: маршруты входа открыты, и опереться можно только на разбор в
 * демоне (docs/authentication.md). Смысл этой — не гонять на сервер то, о чём и так известно, и не
 * дать опечатке в повторе стать единственным паролем владельца.
 */

import { minimumPasswordLength } from "@sovereign/protocol";

export type CredentialsProblem =
  /** Короче нижней границы. Проверяется только при регистрации. */
  | "too-short"
  /** Повтор расходится с паролем. */
  | "mismatch";

export type CredentialsCheck =
  /** Введено ещё не всё. Кнопка выключена, но ругаться пока не на что. */
  { kind: "incomplete" } | { kind: "problem"; problem: CredentialsProblem } | { kind: "ready" };

/**
 * `confirmation` есть только у регистрации: у входа повторять пароль незачем, а его длину проверяет
 * сервер — правило могло измениться после того, как пароль был задан.
 */
export function checkCredentials(
  password: string,
  confirmation: string | undefined,
): CredentialsCheck {
  if (password === "") {
    return { kind: "incomplete" };
  }

  if (confirmation === undefined) {
    return { kind: "ready" };
  }

  // Длина — раньше повтора: её человек не исправит, повторив ту же короткую строку.
  if (password.length < minimumPasswordLength) {
    return { kind: "problem", problem: "too-short" };
  }

  if (confirmation === "") {
    return { kind: "incomplete" };
  }

  return confirmation === password ? { kind: "ready" } : { kind: "problem", problem: "mismatch" };
}
