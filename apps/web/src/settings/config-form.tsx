/**
 * Форма конфига демона. Значения записываются в `config.json` через API: файл остаётся источником
 * истины (docs/data-directory.md), а форма — вторым способом его изменить.
 *
 * Кнопка сохранения отдельная, в отличие от внешнего вида: там переключатель, и решение человека
 * видно целиком в момент щелчка, — здесь набор чисел, и запись на каждое нажатие клавиши отправила
 * бы демону каждую промежуточную цифру.
 */

import { configKeys, logLevels, type Config } from "@sovereign/protocol";
import {
  Button,
  Heading,
  Input,
  Notice,
  Select,
  SettingsRow,
  type ScopedTranslator,
} from "@sovereign/ui-kit";
import { useEffect, useState } from "react";

import {
  draftOf,
  editDraft,
  hasUnsavedEdits,
  readDraft,
  sameConfig,
  type ConfigDraft,
} from "./config-draft.ts";
import type { ConfigState } from "./use-config.ts";

export type ConfigFormProps = {
  state: ConfigState;
  onSave: (config: Config) => void;
  translator: ScopedTranslator;
};

export function ConfigForm({ state, onSave, translator }: ConfigFormProps) {
  const { t } = translator;
  const { config, failure, refusal } = state;
  const [draft, setDraft] = useState<ConfigDraft | undefined>(undefined);

  // Снимок принимается в черновик, пока терять нечего. Правку, набранную руками, снимок не затирает:
  // файл мог изменить редактор или другая вкладка, и молча выбросить чужую работу нельзя.
  useEffect(() => {
    if (config === undefined) {
      return;
    }

    setDraft((current) =>
      current !== undefined && hasUnsavedEdits(current, config) ? current : draftOf(config),
    );
  }, [config]);

  if (config === undefined || draft === undefined) {
    return (
      <div className="settings-config">
        {failure === undefined ? (
          <span>{t("state.loading")}</span>
        ) : (
          <Notice tone="danger" title={t("settings.config.unreadable", { reason: failure })} />
        )}
      </div>
    );
  }

  const reading = readDraft(draft);
  const changed = reading.kind === "read" && !sameConfig(reading.config, config);
  // Черновик оставили при разошедшемся снимке: файл изменился под открытой формой.
  const collided = !sameConfig(draft.base, config);

  return (
    <div className="settings-config">
      <Heading level={3}>{t("settings.config.title")}</Heading>
      {refusal === undefined ? undefined : <Notice tone="danger" title={refusal} />}
      {collided ? (
        <Notice tone="warning" title={t("settings.config.collision")}>
          <Button onClick={() => setDraft(draftOf(config))}>{t("settings.config.takeFile")}</Button>
        </Notice>
      ) : undefined}
      {reading.kind === "unreadable" ? (
        <Notice
          tone="danger"
          title={t("settings.config.notNumbers", { keys: reading.unreadable.join(", ") })}
        />
      ) : undefined}
      {configKeys.map((key) => (
        <SettingsRow
          key={key}
          label={t(`settings.config.key.${key}`)}
          description={t(`settings.config.hint.${key}`)}
        >
          {key === "logLevel" ? (
            <Select
              label=""
              ariaLabel={t(`settings.config.key.${key}`)}
              value={draft.text[key]}
              // Уровни журнала не переводятся: это те же слова, что стоят в файле и в выводе демона,
              // и перевод развёл бы список с тем, что человек пишет руками (docs/logging.md).
              options={logLevels.map((level) => ({ value: level, label: level }))}
              onChange={(value) => setDraft(editDraft(draft, key, value))}
              placeholder={t("common.choose")}
            />
          ) : (
            <Input
              aria-label={t(`settings.config.key.${key}`)}
              value={draft.text[key]}
              invalid={reading.kind === "unreadable" && reading.unreadable.includes(key)}
              onChange={(value) => setDraft(editDraft(draft, key, value))}
            />
          )}
        </SettingsRow>
      ))}
      <div className="settings-config-actions">
        <Button
          tone="accent"
          disabled={!changed}
          onClick={() => {
            if (reading.kind === "read") {
              onSave(reading.config);
            }
          }}
        >
          {t("settings.config.save")}
        </Button>
      </div>
    </div>
  );
}
