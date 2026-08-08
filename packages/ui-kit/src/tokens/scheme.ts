/**
 * Цветовая схема как данные (docs/ui-kit.md): значения палитры для светлого и тёмного варианта плюс явно
 * объявленные точечные переопределения ролей. Плагин добавляет схему объявлением, без браузерного
 * кода, — поэтому здесь нет ни одной функции, которую обязана предоставить схема.
 */

import type { ColorSchemeDocument } from "@sovereign/protocol";

import {
  paletteKeys,
  paletteVariants,
  type Palette,
  type PaletteSet,
  type PaletteVariant,
} from "./palette.ts";
import { deriveRoles, roleNames, type RoleName, type Roles } from "./roles.ts";

/**
 * Мажор контракта токенов. Растёт, когда меняется палитра: роли добавляются и переименовываются без
 * этого (docs/ui-kit.md).
 *
 * Второй мажор — перенос визуала (docs/roadmap.md, срез 5): палитра выросла на второй акцент и цвет
 * тени. Сделано одной правкой намеренно: пока все схемы наши, это стоит ноль, а после среза 12 схему
 * приносит плагин, и такая же добавка станет ломающим изменением публичного контракта.
 */
export const tokenContractMajor = 2;

export type ColorScheme = {
  id: string;
  /** Мажор контракта токенов, на который схема рассчитана. */
  tokenContract: number;
  variants: PaletteSet;
  /**
   * Точечные переопределения ролей. Объявляются явно, потому что делают схему хрупкой: переименование
   * роли в ките дойдёт до неё, а вывод из палитры — нет.
   */
  roleOverrides?: Partial<Record<RoleName, string>>;
};

export type SchemeParse =
  { kind: "parsed"; scheme: ColorScheme } | { kind: "refused"; reason: string };

/**
 * Разбирает документ схемы, приехавший от плагина (docs/plugins.md). Демон проверил только форму:
 * какие варианты и какие ключи палитры обязательны, знает кит — `paletteKeys` принадлежат ему.
 *
 * **Неполная палитра отвергается целиком.** `deriveRoles` на пропущенном ключе собрал бы
 * `color-mix(… undefined …)`, то есть сломанный CSS вместо внятного отказа: интерфейс выглядел бы
 * работающим и разбирался бы глазами. Мажор контракта здесь не проверяется — это работа
 * `resolveScheme`, и она одна на схемы поставки и на чужие.
 */
export function parseColorScheme(id: string, document: ColorSchemeDocument): SchemeParse {
  const variants = {} as PaletteSet;

  for (const variant of paletteVariants) {
    const declared = document.variants[variant];

    if (declared === undefined) {
      return { kind: "refused", reason: `the scheme ${id} declares no ${variant} palette` };
    }

    const missing = paletteKeys.filter((key) => typeof declared[key] !== "string");

    if (missing.length > 0) {
      return {
        kind: "refused",
        reason: `the ${variant} palette of the scheme ${id} has no ${missing.join(", ")}`,
      };
    }

    variants[variant] = Object.fromEntries(
      paletteKeys.map((key) => [key, declared[key]]),
    ) as Palette;
  }

  return {
    kind: "parsed",
    scheme: {
      id,
      tokenContract: document.tokenContract,
      variants,
      // Незнакомое имя роли не отсеивается здесь: `resolveScheme` игнорирует его с диагностикой,
      // потому что схему могли написать для более новой версии кита.
      ...(document.roleOverrides === undefined ? {} : { roleOverrides: document.roleOverrides }),
    },
  };
}

export type SchemeResolution =
  | { kind: "resolved"; roles: Roles; diagnostics: string[] }
  /** Схема не применяется целиком: половина верных цветов хуже внятного отказа. */
  | { kind: "rejected"; diagnostics: string[] };

export function resolveScheme(scheme: ColorScheme, variant: PaletteVariant): SchemeResolution {
  if (scheme.tokenContract !== tokenContractMajor) {
    return {
      kind: "rejected",
      diagnostics: [
        `the scheme ${scheme.id} declares token contract ${scheme.tokenContract}, this kit speaks ${tokenContractMajor}`,
      ],
    };
  }

  const palette: Palette = scheme.variants[variant];
  const roles = deriveRoles(palette);
  const diagnostics: string[] = [];

  for (const [role, value] of Object.entries(scheme.roleOverrides ?? {})) {
    // Незнакомая роль — диагностика, а не отказ: схему могли написать для более новой версии кита,
    // и терять из-за одного лишнего имени все остальные цвета незачем.
    if (!roleNames.includes(role as RoleName)) {
      diagnostics.push(
        `the scheme ${scheme.id} overrides an unknown role ${role} and it is ignored`,
      );

      continue;
    }

    if (value === undefined) {
      continue;
    }

    roles[role as RoleName] = value;
    diagnostics.push(
      `the scheme ${scheme.id} overrides the role ${role} by hand: a kit update may not reach it`,
    );
  }

  return { kind: "resolved", roles, diagnostics };
}
