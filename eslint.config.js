import js from "@eslint/js";
import prettier from "eslint-config-prettier";
import tseslint from "typescript-eslint";

/**
 * Правило зависимостей из docs/repository-structure.md (раздел «Три корневых каталога») живёт
 * здесь: приложения не знают друг о друге, пакеты не знают о приложениях, а про Pi знает один
 * пакет. Непроверяемое правило считается отсутствующим.
 *
 * Группы вынесены в константы, потому что в плоском конфиге опции правила у более узкого блока
 * **заменяют**, а не дополняют опции у более широкого. Разрешающий блок агентного рантайма обязан
 * повторить остальные запреты целиком, иначе он молча их снимет.
 */
const applicationPackages = [
  "@sovereign/daemon",
  "@sovereign/daemon/*",
  "@sovereign/web",
  "@sovereign/web/*",
];

/** Подпакеты Pi (`@earendil-works/pi-ai/providers/all`) отдельным шаблоном: `*` не переходит `/`. */
const agentRuntimePackages = ["@earendil-works/*", "@earendil-works/*/**"];

const noApplicationImports = {
  group: applicationPackages,
  message: "Приложения не зависят друг от друга — общий код выносится в packages/.",
};

const noAgentRuntimeImports = {
  group: agentRuntimePackages,
  message:
    "Импорт Pi разрешён только внутри packages/agent-runtime-pi (docs/architecture.md): наружу выходят типы протокола, а не типы рантайма.",
};

const daemonAreas = [
  "platform",
  "http",
  "authentication",
  "settings",
  "projects",
  "providers",
  "sessions",
  "plugins",
];

const daemonAreaDependencies = {
  platform: [],
  http: ["platform"],
  authentication: ["http", "platform"],
  settings: ["http", "platform"],
  projects: ["http", "platform"],
  providers: ["http", "platform"],
  sessions: ["projects", "http", "platform"],
  plugins: ["settings", "providers", "sessions", "http", "platform"],
};

function daemonAreaBoundary(area, allowedAreas) {
  const forbiddenAreas = daemonAreas.filter(
    (candidate) => candidate !== area && !allowedAreas.includes(candidate),
  );
  const patterns = [
    noApplicationImports,
    noAgentRuntimeImports,
    {
      regex: String.raw`^(?:\./)*\.\./[^/]+/(?!public\.ts$).+`,
      message: "Области демона обращаются к соседям только через public.ts.",
    },
  ];

  if (forbiddenAreas.length > 0) {
    patterns.push({
      regex: String.raw`^(?:\./)*\.\./(?:${forbiddenAreas.join("|")})/public\.ts$`,
      message: "Направление зависимостей областей задано в docs/repository-structure.md.",
    });
  }

  return {
    files: [`apps/daemon/src/${area}/**/*.ts`],
    rules: {
      "no-restricted-imports": ["error", { patterns }],
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "ImportExpression:not([source.type='Literal']), ImportExpression[source.value=/^(?:\\.\\/)*\\.\\.\\//]",
          message:
            "Динамические импорты между областями демона запрещены: статический импорт должен идти через public.ts.",
        },
      ],
    },
  };
}

const daemonCompositionRootUsesFacades = {
  files: ["apps/daemon/src/main.ts"],
  rules: {
    "no-restricted-imports": [
      "error",
      {
        patterns: [
          noApplicationImports,
          noAgentRuntimeImports,
          {
            regex: String.raw`^\./[^/]+/(?!public\.ts$).+`,
            message: "Точка композиции демона обращается к областям только через public.ts.",
          },
        ],
      },
    ],
    "no-restricted-syntax": [
      "error",
      {
        selector: "ImportExpression",
        message: "Точка композиции демона подключает области статически и только через public.ts.",
      },
    ],
  },
};

const appsMustNotImportApps = {
  files: ["apps/**/*.{ts,tsx}"],
  rules: {
    "no-restricted-imports": ["error", { patterns: [noApplicationImports, noAgentRuntimeImports] }],
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
            ...noApplicationImports,
            message:
              "Пакеты не зависят от приложений: зависимости идут только из apps/ в packages/.",
          },
          noAgentRuntimeImports,
        ],
      },
    ],
  },
};

/**
 * Плагины ставятся снаружи и живут на воркерах: им доступен `sdk`, а не наши внутренности
 * (docs/repository-structure.md, docs/plugins.md).
 */
const pluginsMustNotImportAppsOrRuntime = {
  files: ["plugins/**/*.{ts,tsx}"],
  rules: {
    "no-restricted-imports": [
      "error",
      {
        patterns: [
          {
            ...noApplicationImports,
            message: "Плагин обращается к платформе через @sovereign/sdk, а не импортом ядра.",
          },
          noAgentRuntimeImports,
        ],
      },
    ],
  },
};

/**
 * Единственное место, где Pi легален как **код**. Запрет на приложения повторён здесь дословно: без
 * повтора блок снял бы его вместе с запретом на Pi.
 */
const agentRuntimeMayImportPi = {
  files: ["packages/agent-runtime-pi/**/*.ts"],
  rules: {
    "no-restricted-imports": ["error", { patterns: [noApplicationImports] }],
  },
};

/**
 * Единственное названное исключение из правила «Pi только в agent-runtime-pi» (docs/hooks.md): SDK
 * реэкспортирует типы 32 событий рантайма, чтобы автор плагина брал их оттуда же, откуда всё
 * остальное платформенное. Исключение пофайловое, а не на пакет: реэкспорт типов — это один модуль,
 * и расползание по соседям ловится тестом границы в `packages/agent-runtime-pi`.
 */
const sdkHooksMayReexportPiTypes = {
  files: ["packages/sdk/src/hooks.ts"],
  rules: {
    "no-restricted-imports": [
      "error",
      {
        patterns: [
          {
            ...noApplicationImports,
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
        message:
          "Цвет задаётся токеном кита, а не литералом (docs/ui-kit.md, «Чем держится дисциплина цвета»).",
      },
      {
        selector: "Literal[value=/(?:rgb|hsl|lab|lch|oklab|oklch|color-mix)a?\\(/]",
        message:
          "Цвет задаётся токеном кита, а не литералом (docs/ui-kit.md, «Чем держится дисциплина цвета»).",
      },
      {
        selector:
          "Literal[value=/^(?:white|black|red|green|blue|gray|grey|silver|yellow|orange|purple|pink|brown|cyan|magenta|teal|navy|olive|maroon|lime|aqua|fuchsia)$/i]",
        message:
          "Цвет задаётся токеном кита, а не именем цвета (docs/ui-kit.md, «Чем держится дисциплина цвета»).",
      },
    ],
  },
};

export default tseslint.config(
  {
    ignores: [
      "**/build/**",
      "**/dist/**",
      "**/node_modules/**",
      // Superpowers helpers are shipped skill resources for browser/CommonJS execution, not
      // workspace modules. Their runtime is documented and tested by the skills that bundle them.
      "plugins/superpowers/skills/**/scripts/**",
      "plugins/superpowers/skills/writing-skills/render-graphs.js",
      "plugins/superpowers/skills/writing-skills/render-graphs.cjs",
    ],
  },
  js.configs.recommended,
  tseslint.configs.recommended,
  appsMustNotImportApps,
  packagesMustNotImportApps,
  pluginsMustNotImportAppsOrRuntime,
  agentRuntimeMayImportPi,
  sdkHooksMayReexportPiTypes,
  ...Object.entries(daemonAreaDependencies).map(([area, dependencies]) =>
    daemonAreaBoundary(area, dependencies),
  ),
  daemonCompositionRootUsesFacades,
  daemonAndPackagesLogThroughTheLogger,
  colorsComeFromTokensOnly,
  prettier,
);
