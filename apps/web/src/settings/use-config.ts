/**
 * Связь формы конфига с демоном: снимок на подъёме соединения, перезапрос по `core.config.changed`
 * и по разрыву потока, запись одного ключа. Своего потока форма не открывает — соединение одно
 * на вкладку (docs/web-api.md).
 *
 * Оптимистичного применения здесь нет: показанные значения берутся из последнего ответа демона. Так
 * после каждого независимого изменения форма показывает ровно авторитетный снимок файла
 * (docs/data-directory.md).
 */

import {
  coreEventTypes,
  isPluginStreamEvent,
  streamGapType,
  type Config,
} from "@sovereign/protocol";
import { useCallback, useEffect, useRef, useState } from "react";

import type { FrontendBus } from "../events/bus.ts";
import type { StreamStatus } from "../events/stream.ts";
import { fetchConfig, writeConfig } from "./config-api.ts";

export type ConfigState = {
  /** Последнее, что сказал демон. `undefined` — снимок ещё не приехал. */
  config: Config | undefined;
  /** Снимок не прочитан. */
  failure: string | undefined;
  /**
   * Запись не состоялась: негодное значение (`400`), файл правил кто-то ещё (`409`) или файловая
   * система отказала (`500`). Во всех трёх случаях причину называет демон.
   */
  refusal: string | undefined;
};

export const initialConfigState: ConfigState = {
  config: undefined,
  failure: undefined,
  refusal: undefined,
};

export type ConfigController = {
  state: ConfigState;
  update: <K extends keyof Config>(key: K, value: Config[K]) => void;
};

export type UseConfigOptions = {
  bus: Pick<FrontendBus, "subscribe">;
  stream: StreamStatus;
  onDiagnostic: (diagnostic: string) => void;
};

const reasonOf = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause);

export function useConfig(options: UseConfigOptions): ConfigController {
  const { bus, stream, onDiagnostic } = options;
  const [state, setState] = useState<ConfigState>(initialConfigState);

  // То же зеркало, что во вью плагинов и проектов: единственный источник изменения состояния — `apply`.
  const latest = useRef<ConfigState>(initialConfigState);
  const apply = useCallback((next: (current: ConfigState) => ConfigState) => {
    latest.current = next(latest.current);
    setState(latest.current);
  }, []);

  const pending = useRef<AbortController | undefined>(undefined);

  // Номер последней отправленной записи: две быстрые записи подряд рвут договор, если ответ на
  // первую приходит последним и возвращает то, что человек уже переписал.
  const writeSeq = useRef(0);
  // Последняя актуальная запись, на которую уже пришёл ответ. Reload, начатый пока она в пути,
  // мог быть обработан демоном раньше неё и потому не может стать снимком после её ответа.
  const settledWriteSeq = useRef(0);

  const reload = useCallback(() => {
    pending.current?.abort();

    const controller = new AbortController();
    pending.current = controller;
    const seq = writeSeq.current;
    const writeWasInFlight = settledWriteSeq.current !== seq;

    void fetchConfig(controller.signal)
      .then((config) => {
        if (controller.signal.aborted || writeSeq.current !== seq || writeWasInFlight) {
          return;
        }

        apply((current) => ({ ...current, config, failure: undefined }));
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted || writeSeq.current !== seq || writeWasInFlight) {
          return;
        }

        const reason = reasonOf(cause);

        onDiagnostic(`the daemon config could not be read: ${reason}`);
        apply((current) => ({ ...current, failure: reason }));
      });
  }, [apply, onDiagnostic]);

  useEffect(() => {
    const unsubscribe = bus.subscribe((event) => {
      if (isPluginStreamEvent(event)) {
        return;
      }

      // Пропуск в потоке — повод перезапросить своё состояние, а не показывать неполное
      // (docs/web-api.md). Правка файла руками приезжает тем же событием, что и запись из формы.
      if (event.type === coreEventTypes.configChanged || event.type === streamGapType) {
        reload();
      }
    });

    return unsubscribe;
  }, [bus, reload]);

  useEffect(() => {
    if (stream !== "open") {
      return;
    }

    reload();
  }, [stream, reload]);

  useEffect(() => () => pending.current?.abort(), []);

  const update = useCallback(
    <K extends keyof Config>(key: K, value: Config[K]) => {
      apply((current) => ({ ...current, refusal: undefined }));

      const seq = writeSeq.current + 1;
      writeSeq.current = seq;

      void writeConfig({ [key]: value } as Partial<Config>)
        .then((written) => {
          // Протухший ответ: после этой записи человек изменил другой контрол, и снимок обязан
          // остаться за последней записью. Своё событие вернёт её и так.
          if (writeSeq.current !== seq) {
            return;
          }

          settledWriteSeq.current = seq;
          apply((current) => ({ ...current, config: written, refusal: undefined }));
        })
        .catch((cause: unknown) => {
          if (writeSeq.current !== seq) {
            return;
          }

          settledWriteSeq.current = seq;
          const reason = reasonOf(cause);

          onDiagnostic(`the daemon config was not written: ${reason}`);
          apply((current) => ({ ...current, refusal: reason }));
          // Снимок перезапрашивается, а не откатывается своей копией прежнего: за время запроса
          // файл мог измениться, и отказ как раз об этом.
          reload();
        });
    },
    [apply, onDiagnostic, reload],
  );

  return { state, update };
}
