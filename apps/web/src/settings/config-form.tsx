/**
 * Independent daemon configuration controls. Numeric text is held locally until its control is
 * finished, while selections have one complete value at the moment of interaction.
 */

import { configKeys, logLevels, type Config } from "@sovereign/protocol";
import {
  Heading,
  Input,
  Notice,
  Select,
  SettingsRow,
  type ScopedTranslator,
} from "@sovereign/ui-kit";
import { useEffect, useRef, useState } from "react";

import { parseFiniteNumber, textOf, type ConfigText } from "./config-draft.ts";
import type { ConfigState } from "./use-config.ts";

export type ConfigFormProps = {
  state: ConfigState;
  onChange: <K extends keyof Config>(key: K, value: Config[K]) => void;
  translator: ScopedTranslator;
};

export function ConfigForm({ state, onChange, translator }: ConfigFormProps) {
  const { t } = translator;
  const { config, failure, refusal } = state;
  const [text, setText] = useState<ConfigText | undefined>(() =>
    config === undefined ? undefined : textOf(config),
  );
  const latestRefusal = useRef(refusal);
  const dirtyKeys = useRef(new Set<keyof Config>());
  const committedNumericText = useRef(new Map<Exclude<keyof Config, "logLevel">, string>());

  useEffect(() => {
    latestRefusal.current = refusal;
  }, [refusal]);

  useEffect(() => {
    if (config === undefined) {
      return;
    }

    setText((current) => {
      if (current === undefined) {
        return textOf(config);
      }

      // A refusal is followed by a reload, so its text stays beside the daemon reason. Otherwise,
      // only controls without pending local text accept the new authoritative snapshot.
      if (latestRefusal.current !== undefined) {
        return current;
      }

      const next = textOf(config);

      for (const key of dirtyKeys.current) {
        next[key] = current[key];
      }

      return next;
    });
  }, [config]);

  if (config === undefined || text === undefined) {
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

  const setValue = (key: keyof Config, value: string): void => {
    dirtyKeys.current.add(key);

    if (key !== "logLevel") {
      committedNumericText.current.delete(key);
    }

    setText((current) => (current === undefined ? current : { ...current, [key]: value }));
  };
  const commitNumber = (key: Exclude<keyof Config, "logLevel">): void => {
    if (committedNumericText.current.get(key) === text[key]) {
      return;
    }

    const value = parseFiniteNumber(text[key]);

    if (value !== undefined) {
      dirtyKeys.current.delete(key);
      committedNumericText.current.set(key, text[key]);
      onChange(key, value);
    }
  };

  return (
    <div className="settings-config">
      <Heading level={3}>{t("settings.config.title")}</Heading>
      {refusal === undefined ? undefined : <Notice tone="danger" title={refusal} />}
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
              value={text[key]}
              options={logLevels.map((level) => ({ value: level, label: level }))}
              onChange={(value) => {
                setValue(key, value);
                dirtyKeys.current.delete(key);
                onChange(key, value as Config["logLevel"]);
              }}
              placeholder={t("common.choose")}
            />
          ) : (
            <Input
              aria-label={t(`settings.config.key.${key}`)}
              value={text[key]}
              invalid={parseFiniteNumber(text[key]) === undefined}
              onChange={(value) => setValue(key, value)}
              onBlur={() => commitNumber(key)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  commitNumber(key);
                }
              }}
            />
          )}
        </SettingsRow>
      ))}
    </div>
  );
}
