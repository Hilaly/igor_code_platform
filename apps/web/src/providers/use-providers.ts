/**
 * Связь вью провайдеров с демоном: снимок на подъёме соединения и модели по раскрытию строки.
 * Своего потока вью не открывает — соединение одно на вкладку (docs/web-api.md).
 *
 * На шину здесь никто не подписывается: событий про провайдеров ядро пока не публикует
 * (docs/event-bus.md). Снимок спрашивается по состоянию потока не ради событий, а ради сессии:
 * маршрут защищён (docs/authentication.md), и запрос до входа получил бы отказ вместо ответа.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import type { StreamStatus } from "../events/stream.ts";
import { fetchProviderModels, fetchProvidersSnapshot } from "./api.ts";
import {
  applyFailure,
  applyModels,
  applyModelsFailure,
  applySnapshot,
  initialProvidersState,
  openProvider,
  type ProvidersState,
} from "./state.ts";

export type UseProvidersOptions = {
  stream: StreamStatus;
  onDiagnostic: (diagnostic: string) => void;
};

export type ProvidersController = {
  state: ProvidersState;
  /** Раскрыть провайдера или свернуть раскрытый; модели читаются по первому раскрытию. */
  open: (providerId: string) => void;
};

const reasonOf = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause);

export function useProviders(options: UseProvidersOptions): ProvidersController {
  const { stream, onDiagnostic } = options;
  const [state, setState] = useState<ProvidersState>(initialProvidersState);

  // То же зеркало, что во вью проектов: правило применения смотрит на предыдущее состояние, а ответы
  // приходят чаще, чем React успевает отрисовать. Единственный источник изменения — `apply`.
  const latest = useRef<ProvidersState>(initialProvidersState);
  const apply = useCallback((next: (current: ProvidersState) => ProvidersState) => {
    latest.current = next(latest.current);
    setState(latest.current);
  }, []);

  const pendingSnapshot = useRef<AbortController | undefined>(undefined);
  // Запросы моделей не отменяют друг друга: каждый ответ ложится в свою запись по провайдеру, и
  // разойтись им негде. Отменённый на полпути оставил бы провайдера с вечной крутилкой — раскрытие
  // второй раз его уже не перезапросит.
  const pendingModels = useRef<Set<AbortController>>(new Set());

  useEffect(() => {
    if (stream !== "open") {
      return;
    }

    pendingSnapshot.current?.abort();

    const controller = new AbortController();
    pendingSnapshot.current = controller;

    void fetchProvidersSnapshot(controller.signal)
      .then((snapshot) => apply((current) => applySnapshot(current, snapshot)))
      .catch((cause: unknown) => {
        if (controller.signal.aborted) {
          return;
        }

        const reason = reasonOf(cause);

        onDiagnostic(`the providers could not be read: ${reason}`);
        apply((current) => applyFailure(current, reason));
      });
  }, [stream, apply, onDiagnostic]);

  useEffect(
    () => () => {
      pendingSnapshot.current?.abort();

      for (const controller of pendingModels.current) {
        controller.abort();
      }
    },
    [],
  );

  const open = useCallback(
    (providerId: string) => {
      const outcome = openProvider(latest.current, providerId);

      apply(() => outcome.state);

      if (!outcome.fetch) {
        return;
      }

      const controller = new AbortController();
      pendingModels.current.add(controller);

      void fetchProviderModels(providerId, controller.signal)
        .then((answer) => apply((current) => applyModels(current, providerId, answer.models)))
        .catch((cause: unknown) => {
          if (controller.signal.aborted) {
            return;
          }

          const reason = reasonOf(cause);

          onDiagnostic(`the models of ${providerId} could not be read: ${reason}`);
          apply((current) => applyModelsFailure(current, providerId, reason));
        })
        .finally(() => pendingModels.current.delete(controller));
    },
    [apply, onDiagnostic],
  );

  return { state, open };
}
