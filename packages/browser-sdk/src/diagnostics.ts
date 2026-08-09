/**
 * Голос жалоб браузерного SDK. Отдельным модулем, а не рядом с местами: жалуются и места, и команды,
 * а импорт из одного в другое ради одного хука связал бы их в кольцо.
 */

import { useCallback, useRef } from "react";

import type { BrowserRuntime } from "./runtime-context.tsx";

/**
 * Одна и та же жалоба уходит в диагностику один раз за жизнь компонента: она вычисляется в
 * отрисовке, а отрисовок у места много, и без дедупликации журнал состоял бы из повторов.
 */
export function useDiagnosticVoice(runtime: BrowserRuntime | undefined): (text: string) => void {
  const named = useRef(new Set<string>());

  return useCallback(
    (text: string) => {
      if (runtime === undefined || named.current.has(text)) {
        return;
      }

      named.current.add(text);
      runtime.onDiagnostic(text);
    },
    [runtime],
  );
}
