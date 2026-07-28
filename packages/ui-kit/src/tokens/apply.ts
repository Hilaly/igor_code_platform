/**
 * Применение схемы: роли пишутся CSS-переменными в корень документа. Это единственное место в
 * токенах, которое знает про DOM, — и единственный способ, которым тема доезжает до чужого
 * компонента: перекрасить его извне платформа не может (docs/ui-kit.md).
 *
 * Цель приходит параметром, а не берётся из `document`: так применение проверяется без DOM.
 */

import type { InterfaceScale } from "@sovereign/protocol";

import { rolePropertyName, type RoleName, type Roles } from "./roles.ts";

/** Ровно то, что нужно от `HTMLElement.style`. */
export type StyleTarget = {
  setProperty: (property: string, value: string) => void;
};

export function applyRoles(roles: Roles, target: StyleTarget): void {
  for (const [role, value] of Object.entries(roles)) {
    target.setProperty(rolePropertyName(role as RoleName), value);
  }
}

/** Ровно то, что нужно от `HTMLElement`: масштаб приезжает атрибутом, а не переменными. */
export type ScaleTarget = {
  setAttribute: (name: string, value: string) => void;
};

/** Имя атрибута знает кит: на него реагирует его же `styles/scale.css`. */
export const scaleAttributeName = "data-scale";

/**
 * Обычный масштаб пишется тем же атрибутом со значением `default`: CSS на это значение не реагирует, и
 * это правильно — снимать атрибут значило бы иметь два способа сказать «обычный».
 */
export function applyScale(scale: InterfaceScale, target: ScaleTarget): void {
  target.setAttribute(scaleAttributeName, scale);
}
