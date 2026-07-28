import js from "@eslint/js";
import prettier from "eslint-config-prettier";
import tseslint from "typescript-eslint";

/**
 * Правило зависимостей из docs/repository-structure.md (раздел «Три корневых каталога») живёт
 * здесь: приложения не знают друг о друге, пакеты не знают о приложениях. Непроверяемое правило
 * считается отсутствующим.
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
 * docs/logging.md (раздел «Свой логгер, а не библиотека») объявил `console.log` ошибкой,
 * а не стилем: у записи без источника нет получателей — ни базы, ни шины, ни интерфейса.
 * Веб пока не входит: своего логгера у него нет.
 */
const daemonAndPackagesLogThroughTheLogger = {
  files: ["apps/daemon/**/*.ts", "packages/**/*.{ts,tsx}"],
  rules: {
    "no-console": "error",
  },
};

/**
 * Любой цвет, оставленный мимо токена, не переключается ни при смене варианта, ни при смене схемы,
 * и находится он на чужой схеме, а не у нас (почему так — docs/ui-kit.md, раздел «Чем держится
 * дисциплина цвета»). Значения живут только в файлах токенов кита; остальной код читает роли.
 *
 * Правило смотрит на строковые литералы в коде. За CSS-файлами оно не следит — там дисциплину
 * проверяет схема с дикими цветами (docs/ui-kit.md).
 */
const colorsComeFromTokensOnly = {
  files: ["packages/ui-kit/**/*.{ts,tsx}", "apps/web/**/*.{ts,tsx}"],
  ignores: ["packages/ui-kit/src/tokens/**"],
  rules: {
    "no-restricted-syntax": [
      "error",
      {
        selector: "Literal[value=/^#[0-9a-fA-F]{3,8}$/]",
        message: "Цвет задаётся токеном кита, а не литералом (docs/ui-kit.md, «Чем держится дисциплина цвета»).",
      },
      {
        selector: "Literal[value=/(?:rgb|hsl|lab|lch|oklab|oklch|color-mix)a?\\(/]",
        message: "Цвет задаётся токеном кита, а не литералом (docs/ui-kit.md, «Чем держится дисциплина цвета»).",
      },
      {
        selector:
          "Literal[value=/^(?:white|black|red|green|blue|gray|grey|silver|yellow|orange|purple|pink|brown|cyan|magenta|teal|navy|olive|maroon|lime|aqua|fuchsia)$/i]",
        message: "Цвет задаётся токеном кита, а не именем цвета (docs/ui-kit.md, «Чем держится дисциплина цвета»).",
      },
    ],
  },
};

export default tseslint.config(
  { ignores: ["**/dist/**", "**/node_modules/**"] },
  js.configs.recommended,
  tseslint.configs.recommended,
  appsMustNotImportApps,
  packagesMustNotImportApps,
  daemonAndPackagesLogThroughTheLogger,
  colorsComeFromTokensOnly,
  prettier,
);
