/**
 * Каталог компонентов (docs/ui-kit.md). Он существует по одной причине: примитив, перенесённый вперёд
 * своего среза, до появления настоящего потребителя виден только здесь — иначе его нельзя проверить
 * ничем, кроме чтения кода (docs/roadmap.md, срез 5).
 *
 * Схему каталог применяет тем же способом, что и приложение: `applyRoles` пишет роли в корень
 * документа. Второго пути применения темы у нас нет и быть не должно — иначе каталог показывал бы не
 * то, что покажет продукт.
 */

import type { GlobalProvider } from "@ladle/react";
import { useEffect, useState } from "react";

import { interfaceScales, type InterfaceScale } from "@sovereign/protocol";

import {
  applyRoles,
  applyScale,
  imperiumScheme,
  resolveScheme,
  shippedSchemes,
  type PaletteVariant,
} from "../src/index.ts";
import "../src/styles/index.css";
import styles from "./components.module.css";

/**
 * Выбор каталога живёт в `localStorage`: переход между историями — полная перезагрузка страницы, и без
 * этого схема сбрасывалась бы на встроенную ровно тогда, когда её и надо сравнить на нескольких
 * примитивах подряд. Это dev-инструмент, поэтому испорченную запись он просто игнорирует.
 */
function useRemembered<Value extends string>(
  key: string,
  allowed: readonly Value[],
  fallback: Value,
): [Value, (value: Value) => void] {
  const [value, setValue] = useState<Value>(() => {
    const stored = globalThis.localStorage?.getItem(key);

    return allowed.find((candidate) => candidate === stored) ?? fallback;
  });

  return [
    value,
    (next: Value) => {
      globalThis.localStorage?.setItem(key, next);
      setValue(next);
    },
  ];
}

export const Provider: GlobalProvider = ({ children, globalState }) => {
  const schemeIds = shippedSchemes.map((scheme) => scheme.id);
  const [schemeId, setSchemeId] = useRemembered(
    "sovereign.catalogue.scheme",
    schemeIds,
    imperiumScheme.id,
  );
  const [scale, setScale] = useRemembered<InterfaceScale>(
    "sovereign.catalogue.scale",
    interfaceScales,
    "default",
  );

  // Светлый и тёмный вариант каталог берёт из своего же переключателя темы: у него он уже есть, и
  // второй рядом с ним только путал бы.
  const variant: PaletteVariant = globalState.theme === "dark" ? "dark" : "light";

  useEffect(() => {
    const scheme = shippedSchemes.find((candidate) => candidate.id === schemeId) ?? imperiumScheme;
    const resolved = resolveScheme(scheme, variant);

    if (resolved.kind === "resolved") {
      applyRoles(resolved.roles, document.documentElement.style);
    }

    applyScale(scale, document.documentElement);
  }, [schemeId, variant, scale]);

  return (
    <div className={styles.catalogue}>
      <div className={styles.appearanceControls} role="group" aria-label="Catalogue appearance">
        <label className={styles.appearanceField}>
          <span>scheme</span>
          <select
            className={styles.control}
            value={schemeId}
            onChange={(event) => setSchemeId(event.target.value)}
          >
            {shippedSchemes.map((scheme) => (
              <option key={scheme.id} value={scheme.id}>
                {scheme.id}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.appearanceField}>
          <span>scale</span>
          <select
            className={styles.control}
            value={scale}
            onChange={(event) => setScale(event.target.value as InterfaceScale)}
          >
            {interfaceScales.map((candidate) => (
              <option key={candidate} value={candidate}>
                {candidate}
              </option>
            ))}
          </select>
        </label>
      </div>
      {children}
    </div>
  );
};
