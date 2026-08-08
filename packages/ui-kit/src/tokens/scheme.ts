/**
 * Цветовая схема как данные (docs/ui-kit.md): значения палитры для светлого и тёмного варианта плюс явно
 * объявленные точечные переопределения ролей. Плагин добавляет схему объявлением, без браузерного
 * кода, — поэтому здесь нет ни одной функции, которую обязана предоставить схема.
 */

import type { ColorSchemeDocument } from "@sovereign/protocol";

import { readBuiltInRoleOverrides } from "./built-in-role-overrides.ts";
import { isResolvableColor } from "./color.ts";
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

function paletteRefusal(
  id: string,
  variant: PaletteVariant,
  declared: Partial<Record<(typeof paletteKeys)[number], unknown>> | undefined,
): string | undefined {
  if (declared === undefined) {
    return `the scheme ${id} declares no ${variant} palette`;
  }

  const missing = paletteKeys.filter((key) => typeof declared[key] !== "string");

  if (missing.length > 0) {
    return `the ${variant} palette of the scheme ${id} has no ${missing.join(", ")}`;
  }

  const invalid = paletteKeys.filter((key) => !isResolvableColor(declared[key]));

  return invalid.length === 0
    ? undefined
    : `the ${variant} palette of the scheme ${id} has an unresolvable colour for ${invalid.join(", ")}`;
}

function overrideRefusal(
  id: string,
  overrides: Record<string, unknown> | undefined,
): string | undefined {
  for (const [role, value] of Object.entries(overrides ?? {})) {
    if (roleNames.includes(role as RoleName) && !isResolvableColor(value)) {
      return `the scheme ${id} overrides the role ${role} with an unresolvable colour`;
    }
  }

  return undefined;
}

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

    const refusal = paletteRefusal(id, variant, declared);

    if (refusal !== undefined) {
      return { kind: "refused", reason: refusal };
    }

    const validated = declared as Palette;
    variants[variant] = Object.fromEntries(
      paletteKeys.map((key) => [key, validated[key]]),
    ) as Palette;
  }

  const roleRefusal = overrideRefusal(id, document.roleOverrides);

  if (roleRefusal !== undefined) {
    return { kind: "refused", reason: roleRefusal };
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

  try {
    const palette = scheme.variants[variant] as Palette | undefined;
    const paletteProblem = paletteRefusal(scheme.id, variant, palette);

    if (paletteProblem !== undefined) {
      return { kind: "rejected", diagnostics: [paletteProblem] };
    }

    const validatedPalette = palette as Palette;

    const overrideProblem = overrideRefusal(
      scheme.id,
      scheme.roleOverrides as Record<string, unknown> | undefined,
    );

    if (overrideProblem !== undefined) {
      return { kind: "rejected", diagnostics: [overrideProblem] };
    }

    const roles = deriveRoles(validatedPalette);
    const diagnostics: string[] = [];

    Object.assign(roles, readBuiltInRoleOverrides(scheme, variant));

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
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);

    return {
      kind: "rejected",
      diagnostics: [
        `the ${variant} palette of the scheme ${scheme.id} could not be resolved: ${reason}`,
      ],
    };
  }
}
