/**
 * Диагностика интерфейса: непереведённый ключ, отказ схемы, разрыв потока, негодный кадр. Журнал
 * демона живёт в его `stdout` и наружу не отдаётся вовсе (ADR-0074), поэтому то, что случилось в
 * браузере, обязано быть видно в браузере.
 */

export type Diagnostic = {
  /** Порядковый номер: два одинаковых сообщения подряд не должны склеиваться в интерфейсе. */
  index: number;
  text: string;
};

export type DiagnosticsStore = {
  record: (text: string) => void;
  list: () => Diagnostic[];
  subscribe: (listener: (list: Diagnostic[]) => void) => () => void;
};

/**
 * Предел на число записей есть, потому что источник неограничен: плагин, публикующий мусор в цикле,
 * иначе набьёт память вкладки.
 */
const limit = 200;

export function createDiagnosticsStore(): DiagnosticsStore {
  const listeners = new Set<(list: Diagnostic[]) => void>();
  let list: Diagnostic[] = [];
  let counter = 0;

  return {
    record: (text) => {
      counter += 1;
      list = [{ index: counter, text }, ...list].slice(0, limit);

      for (const listener of [...listeners]) {
        listener(list);
      }
    },
    list: () => list,
    subscribe: (listener) => {
      listeners.add(listener);

      return () => {
        listeners.delete(listener);
      };
    },
  };
}
