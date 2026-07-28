/**
 * Связь вью плагинов с демоном: снимок на подъёме соединения, кадры из фронтовой шины, запись
 * решения человека. Своего потока вью не открывает — соединение одно на вкладку (docs/web-api.md).
 *
 * Порядок именно такой: снимок спрашивается после того, как поток открылся (web-api.md). Наоборот
 * потерялись бы события, случившиеся между ответом и подпиской.
 */

import type { PluginPreferences } from "@sovereign/protocol";
import { useCallback, useEffect, useRef, useState } from "react";

import type { FrontendBus } from "../events/bus.ts";
import type { StreamStatus } from "../events/stream.ts";
import { fetchPluginsSnapshot, writePluginPreferences } from "./api.ts";
import {
  applyFailure,
  applySnapshot,
  applyStreamEvent,
  applyWrittenPreferences,
  initialPluginsState,
  type PluginsState,
} from "./state.ts";

export type UsePluginsOptions = {
  bus: Pick<FrontendBus, "subscribe">;
  stream: StreamStatus;
  /** Причина, с которой человек ничего сделать не может, всё равно обязана быть видна. */
  onDiagnostic: (diagnostic: string) => void;
};

export type PluginsController = {
  state: PluginsState;
  /** Записать решение о плагине и его вкладах: запись целиком, как и в файле. */
  switchPlugin: (pluginKey: string, preferences: PluginPreferences) => void;
};

const reasonOf = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause);

export function usePlugins(options: UsePluginsOptions): PluginsController {
  const { bus, stream, onDiagnostic } = options;
  const [state, setState] = useState<PluginsState>(initialPluginsState);

  // Кадры приходят чаще, чем React успевает отрисовать, а правило применения смотрит на предыдущее
  // состояние: ссылка обновляется синхронно, поэтому два кадра подряд не теряют друг друга.
  const latest = useRef<PluginsState>(initialPluginsState);
  const apply = useCallback((next: (current: PluginsState) => PluginsState) => {
    latest.current = next(latest.current);
    setState(latest.current);
  }, []);

  const pending = useRef<AbortController | undefined>(undefined);

  const reload = useCallback(() => {
    // Предыдущий запрос отменяется: его ответ уже не нужен, а прийти он может позже нового.
    pending.current?.abort();

    const controller = new AbortController();
    pending.current = controller;

    void fetchPluginsSnapshot(controller.signal)
      .then((snapshot) => apply((current) => applySnapshot(current, snapshot)))
      .catch((cause: unknown) => {
        if (controller.signal.aborted) {
          return;
        }

        const reason = reasonOf(cause);

        onDiagnostic(`the plugins could not be read: ${reason}`);
        apply((current) => applyFailure(current, reason));
      });
  }, [apply, onDiagnostic]);

  useEffect(() => {
    const unsubscribe = bus.subscribe((event) => {
      const outcome = applyStreamEvent(latest.current, event);

      latest.current = outcome.state;
      setState(outcome.state);

      if (outcome.refetch) {
        reload();
      }
    });

    return unsubscribe;
  }, [bus, reload]);

  // Снимок спрашивается на каждом подъёме соединения: за время разрыва могло произойти что угодно.
  useEffect(() => {
    if (stream !== "open") {
      return;
    }

    reload();
  }, [stream, reload]);

  useEffect(() => () => pending.current?.abort(), []);

  const switchPlugin = useCallback(
    (pluginKey: string, preferences: PluginPreferences) => {
      // Выбранное показывается сразу: запись может отказать, и тогда придёт причина, а состояние
      // вернётся перезапросом.
      apply((current) => applyWrittenPreferences(current, pluginKey, preferences));

      void writePluginPreferences(pluginKey, preferences)
        .then((updated) =>
          apply((current) => applyWrittenPreferences(current, updated.key, updated.preferences)),
        )
        .catch((cause: unknown) => {
          const reason = reasonOf(cause);

          onDiagnostic(`the plugin preferences were not written: ${reason}`);
          apply((current) => applyFailure(current, reason));
          reload();
        });
    },
    [apply, onDiagnostic, reload],
  );

  return { state, switchPlugin };
}
