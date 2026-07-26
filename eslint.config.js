import js from "@eslint/js";
import prettier from "eslint-config-prettier";
import tseslint from "typescript-eslint";

/**
 * Правило зависимостей из ADR-0005 живёт здесь: приложения не знают друг о друге,
 * пакеты не знают о приложениях. Непроверяемое правило считается отсутствующим.
 */
const appsMustNotImportApps = {
  files: ["apps/**/*.{ts,tsx}"],
  rules: {
    "no-restricted-imports": [
      "error",
      {
        patterns: [
          {
            group: [
              "@sovereign/daemon",
              "@sovereign/daemon/*",
              "@sovereign/web",
              "@sovereign/web/*",
            ],
            message: "Приложения не зависят друг от друга — общий код выносится в packages/.",
          },
        ],
      },
    ],
  },
};

const packagesMustNotImportApps = {
  files: ["packages/**/*.{ts,tsx}"],
  rules: {
    "no-restricted-imports": [
      "error",
      {
        patterns: [
          {
            group: [
              "@sovereign/daemon",
              "@sovereign/daemon/*",
              "@sovereign/web",
              "@sovereign/web/*",
            ],
            message:
              "Пакеты не зависят от приложений: зависимости идут только из apps/ в packages/.",
          },
        ],
      },
    ],
  },
};

/**
 * ADR-0021 объявил `console.log` ошибкой, а не стилем: у записи без источника нет получателей —
 * ни базы, ни шины, ни интерфейса. Веб пока не входит: своего логгера у него нет.
 */
const daemonAndPackagesLogThroughTheLogger = {
  files: ["apps/daemon/**/*.ts", "packages/**/*.{ts,tsx}"],
  rules: {
    "no-console": "error",
  },
};

export default tseslint.config(
  { ignores: ["**/dist/**", "**/node_modules/**"] },
  js.configs.recommended,
  tseslint.configs.recommended,
  appsMustNotImportApps,
  packagesMustNotImportApps,
  daemonAndPackagesLogThroughTheLogger,
  prettier,
);
