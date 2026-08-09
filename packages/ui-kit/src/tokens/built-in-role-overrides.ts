import type { PaletteVariant } from "./palette.ts";
import type { Roles } from "./roles.ts";

type BuiltInRoleOverrides = Partial<Record<PaletteVariant, Partial<Roles>>>;

const builtInRoleOverrides = Symbol("sovereignBuiltInRoleOverrides");

type BuiltInScheme = {
  [builtInRoleOverrides]?: BuiltInRoleOverrides;
};

export function defineBuiltInRoleOverrides<Scheme extends object>(
  scheme: Scheme,
  overrides: BuiltInRoleOverrides,
): Scheme {
  Object.defineProperty(scheme, builtInRoleOverrides, {
    configurable: false,
    enumerable: true,
    value: overrides,
    writable: false,
  });

  return scheme;
}

export function readBuiltInRoleOverrides(
  scheme: object,
  variant: PaletteVariant,
): Partial<Roles> | undefined {
  return (scheme as BuiltInScheme)[builtInRoleOverrides]?.[variant];
}
