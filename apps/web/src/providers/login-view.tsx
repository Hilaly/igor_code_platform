/**
 * Диалог интерактивного входа в провайдера (docs/models-and-providers.md). Своих запросов здесь нет:
 * состояние приходит пропом, ответ и отмена уходят наверх — той же дисциплины держатся соседние вью.
 *
 * Показывается он не модальным слоем, а панелью вью: вход может вести плагин, и отвечает на его
 * вопросы плагин (`answerable: false`). Модальный слой в этом случае перекрыл бы человеку интерфейс
 * ради диалога, в котором от него ничего не требуется.
 *
 * Собран из примитивов кита: своих компонентов у вью нет, иначе плагин, заменяющий вью провайдеров,
 * не сможет собрать такой же (docs/ui-kit.md).
 */

import type { LoginNotice, LoginPrompt } from "@sovereign/protocol";
import {
  Button,
  Code,
  Field,
  Form,
  Input,
  Link,
  Notice,
  Panel,
  Progress,
  Select,
  Text,
  type ScopedTranslator,
} from "@sovereign/ui-kit";
import { useState } from "react";

import type { LoginDialog } from "./login-state.ts";

export type ProviderLoginProps = {
  providerId: string;
  /** Имя провайдера из снимка. Провайдера может там ещё не быть — тогда идентификатор. */
  name: string;
  dialog: LoginDialog;
  onAnswer: (providerId: string, stepId: string, value: string) => void;
  onCancel: (providerId: string) => void;
  onClose: (providerId: string) => void;
  translator: ScopedTranslator;
};

export function ProviderLogin({
  providerId,
  name,
  dialog,
  onAnswer,
  onCancel,
  onClose,
  translator,
}: ProviderLoginProps) {
  const { t } = translator;
  const { attempt } = dialog;
  const over = dialog.conclusion !== undefined || dialog.lost === true;

  return (
    <Panel
      title={t("providers.login.title", { name })}
      // Отменить можно свою попытку: чужую маршрут не отменит (docs/web-api.md), и кнопка вела бы
      // в заведомый отказ. Попытку плагина отменяет плагин.
      actions={
        over ? (
          <Button onClick={() => onClose(providerId)}>{t("providers.login.close")}</Button>
        ) : attempt.answerable ? (
          <Button tone="danger" onClick={() => onCancel(providerId)}>
            {t("providers.login.cancel")}
          </Button>
        ) : undefined
      }
    >
      <div className="providers-login">
        {dialog.taken !== true ? undefined : (
          <Notice tone="warning" title={t("providers.login.taken")}>
            <Text tone="muted">
              {t(
                attempt.origin === "plugin"
                  ? "providers.login.taken.plugin"
                  : "providers.login.taken.session",
              )}
            </Text>
          </Notice>
        )}

        {attempt.answerable ? undefined : (
          // Попытка плагина видна человеку намеренно: иначе провайдер выглядит занятым без причины
          // (docs/web-api.md).
          <Notice tone="info" title={t("providers.login.watching")} />
        )}

        {attempt.notices.map((notice, index) => (
          // Ключом порядковый номер: сказанное не переставляется и не удаляется, а только копится, и
          // двух одинаковых сообщений подряд исключать нельзя — прогресс повторяется дословно.
          <LoginNoticeView key={index} notice={notice} translator={translator} />
        ))}

        {dialog.refusal === undefined ? undefined : (
          <Notice tone="danger" title={t("providers.login.refused", { reason: dialog.refusal })} />
        )}

        {attempt.pending === undefined ? undefined : attempt.answerable ? (
          <LoginPromptForm
            // Ключом идентификатор шага: у следующего вопроса своё поле, и набранное в прошлом не
            // имеет права в нём остаться.
            key={attempt.pending.stepId}
            prompt={attempt.pending}
            onAnswer={(stepId, value) => onAnswer(providerId, stepId, value)}
            translator={translator}
          />
        ) : (
          <Text tone="muted">{attempt.pending.message}</Text>
        )}

        {dialog.conclusion === undefined ? undefined : dialog.conclusion.kind === "failed" ? (
          <Notice
            tone="danger"
            title={t("providers.login.failed", { reason: dialog.conclusion.reason })}
          />
        ) : (
          <Notice
            tone="info"
            title={t(
              dialog.conclusion.kind === "succeeded"
                ? "providers.login.succeeded"
                : "providers.login.cancelled",
            )}
          />
        )}

        {dialog.lost !== true ? undefined : (
          <Notice tone="warning" title={t("providers.login.lost")}>
            <Text tone="muted">{t("providers.login.lost.hint")}</Text>
          </Notice>
        )}
      </div>
    </Panel>
  );
}

type LoginNoticeProps = {
  notice: LoginNotice;
  translator: ScopedTranslator;
};

/**
 * Четыре вида сказанного, и сводить их к тексту нельзя: по ссылке надо перейти, код устройства надо
 * скопировать, а прогресс — это ожидание, а не сообщение.
 */
function LoginNoticeView({ notice, translator }: LoginNoticeProps) {
  const { t } = translator;

  if (notice.kind === "info") {
    return (
      <div className="providers-login-notice">
        <Text>{notice.message}</Text>
        {notice.links?.map((link) => (
          <Link key={link.url} href={link.url} external>
            {link.label ?? link.url}
          </Link>
        ))}
      </div>
    );
  }

  if (notice.kind === "auth-url") {
    return (
      <div className="providers-login-notice">
        <Text>{notice.instructions ?? t("providers.login.authUrl")}</Text>
        <Link href={notice.url} external>
          {notice.url}
        </Link>
      </div>
    );
  }

  if (notice.kind === "device-code") {
    return (
      <div className="providers-login-notice">
        <Text>{t("providers.login.device.code")}</Text>
        <Code>{notice.userCode}</Code>
        <Text>{t("providers.login.device.where")}</Text>
        <Link href={notice.verificationUri} external>
          {notice.verificationUri}
        </Link>
        {notice.expiresInSeconds === undefined ? undefined : (
          <Text tone="muted">
            {t("providers.login.device.expires", { count: notice.expiresInSeconds })}
          </Text>
        )}
        <Progress label={t("providers.login.device.waiting")} />
      </div>
    );
  }

  return (
    <div className="providers-login-notice">
      <Text tone="muted">{notice.message}</Text>
      <Progress label={notice.message} />
    </div>
  );
}

type LoginPromptFormProps = {
  prompt: LoginPrompt;
  onAnswer: (stepId: string, value: string) => void;
  translator: ScopedTranslator;
};

/**
 * Вопрос и ответ на него. Набранное живёт здесь и больше нигде: на шаге `secret` это ключ, и
 * единственное место, куда он уезжает, — тело `POST` (docs/models-and-providers.md).
 */
function LoginPromptForm({ prompt, onAnswer, translator }: LoginPromptFormProps) {
  const { t } = translator;
  const [value, setValue] = useState(prompt.kind === "select" ? (prompt.options[0]?.id ?? "") : "");

  const hint =
    prompt.kind === "secret"
      ? t("providers.login.secret.hint")
      : prompt.kind === "manual-code"
        ? t("providers.login.manual.hint")
        : undefined;

  return (
    <Form onSubmit={() => onAnswer(prompt.stepId, value)}>
      {/* Раскладка на внутреннем контейнере, а не на самой форме: кит-`Form` не принимает
          `className` (имена модулей хешируются), и `display: contents` формы всё равно вынимает её
          из потока. Внутренний `div` держит столбик «поле, потом кнопка». */}
      <div className="providers-login-form">
        {/* Выбор идёт без `Field`: обвязка связывает метку с контролом по `id`, а `Select`
            идентификатора не принимает — связь получилась бы висячей. Подпись он рисует свою. */}
        {prompt.kind === "select" ? (
          <Select
            value={value}
            options={prompt.options.map((option) => ({
              value: option.id,
              label:
                option.description === undefined
                  ? option.label
                  : `${option.label} — ${option.description}`,
            }))}
            onChange={setValue}
            label={prompt.message}
            placeholder={t("common.choose")}
          />
        ) : (
          <Field label={prompt.message} hint={hint}>
            {(control) => (
              <Input
                value={value}
                onChange={setValue}
                // Секрет не показывается ни при вводе, ни через плечо: это ключ API.
                type={prompt.kind === "secret" ? "password" : "text"}
                placeholder={prompt.placeholder}
                id={control.id}
                describedBy={control.describedBy}
              />
            )}
          </Field>
        )}

        <Button type="submit" tone="accent">
          {t("providers.login.answer")}
        </Button>
      </div>
    </Form>
  );
}
