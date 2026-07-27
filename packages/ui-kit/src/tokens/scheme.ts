/**
 * Цветовая схема как данные (ADR-0028): значения палитры для светлого и тёмного варианта плюс явно
 * объявленные точечные переопределения ролей. Плагин добавляет схему объявлением, без браузерного
 * кода, — поэтому здесь нет ни одной функции, которую обязана предоставить схема.
 */

import type { Palette, PaletteSet, PaletteVariant } from "./palette.ts";
import { deriveRoles, roleNames, type RoleName, type Roles } from "./roles.ts";

/**
 * Мажор контракта токенов. Растёт, когда меняется палитра: роли добавляются и переименовываются без
 * этого (ADR-0031).
 */
export const tokenContractMajor = 1;

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
