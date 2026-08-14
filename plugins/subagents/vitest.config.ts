import { defineConfig } from "vitest/config";

/**
 * Браузерная половина плагина проверяется vitest, воркерная — `node --test`: у первой нужен DOM и
 * рендер React, у второй его нет и быть не должно. Отбор по расширению разводит их без второго
 * пакета: `.test.tsx` — панель, `.test.ts` — воркер.
 */
export default defineConfig({
  test: { include: ["src/**/*.test.tsx"] },
});
