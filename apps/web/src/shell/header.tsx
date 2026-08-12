import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import type { ViewHeaderProps } from "@sovereign/ui-kit";

export type ShellHeaderDescription = Pick<
  ViewHeaderProps,
  "title" | "context" | "level" | "actions"
>;

type ShellHeaderContextValue = {
  description: ShellHeaderDescription;
  register: (description: ShellHeaderDescription) => () => void;
  /**
   * Действия отдельно от описания: маршрут называет `describePage`, а главное действие знает только
   * то вью, которое его выполняет. Регистрируя полное описание ради одной кнопки, вью пришлось бы
   * повторить у себя заголовок маршрута — и разойтись с ним при первой правке.
   */
  viewActions: ReactNode;
  registerActions: (actions: ReactNode) => () => void;
};

const ShellHeaderContext = createContext<ShellHeaderContextValue | null>(null);

export function ShellHeaderProvider({
  description: baseDescription,
  children,
}: {
  description: ShellHeaderDescription;
  children: ReactNode;
}): React.JSX.Element {
  const baseRef = useRef(baseDescription);
  const registrationsRef = useRef(new Map<symbol, ShellHeaderDescription>());
  const [description, setDescription] = useState(baseDescription);
  const actionRegistrationsRef = useRef(new Map<symbol, ReactNode>());
  const [viewActions, setViewActions] = useState<ReactNode>(undefined);

  useLayoutEffect(() => {
    baseRef.current = baseDescription;
    if (registrationsRef.current.size === 0) {
      setDescription(baseDescription);
    }
  }, [baseDescription]);

  const register = useCallback((registeredDescription: ShellHeaderDescription): (() => void) => {
    const token = Symbol("shell-header");
    registrationsRef.current.set(token, registeredDescription);
    setDescription(registeredDescription);

    return () => {
      registrationsRef.current.delete(token);
      const activeRegistration = [...registrationsRef.current.values()].at(-1);
      setDescription(activeRegistration ?? baseRef.current);
    };
  }, []);

  const registerActions = useCallback((actions: ReactNode): (() => void) => {
    const token = Symbol("shell-header-actions");
    actionRegistrationsRef.current.set(token, actions);
    setViewActions(actions);

    return () => {
      actionRegistrationsRef.current.delete(token);
      setViewActions([...actionRegistrationsRef.current.values()].at(-1));
    };
  }, []);

  const value = useMemo(
    () => ({ description, register, viewActions, registerActions }),
    [description, register, viewActions, registerActions],
  );

  return <ShellHeaderContext.Provider value={value}>{children}</ShellHeaderContext.Provider>;
}

export function useShellHeader(description: ShellHeaderDescription): boolean {
  const context = useContext(ShellHeaderContext);
  useLayoutEffect(
    () => (context === null ? undefined : context.register(description)),
    [
      context?.register,
      description.title,
      description.context,
      description.level,
      description.actions,
    ],
  );

  return context !== null;
}

/**
 * Главное действие страницы в шапке маршрута. Узел обязан быть стабильным между рендерами — как и у
 * `useShellHeader`, вызывающий держит его в `useMemo`: новый узел на каждый рендер перерегистрировал
 * бы действие и снова вызывал рендер.
 *
 * Возвращает, доступна ли шапка: вне оболочки вью обязано показать действие само.
 */
export function useShellHeaderActions(actions: ReactNode): boolean {
  const context = useContext(ShellHeaderContext);
  useLayoutEffect(
    () => (context === null ? undefined : context.registerActions(actions)),
    [context?.registerActions, actions],
  );

  return context !== null;
}

/** Whether the current view is rendered inside the shell-owned header provider. */
export function useShellHeaderAvailable(): boolean {
  return useContext(ShellHeaderContext) !== null;
}

export function useActiveShellHeader(): ShellHeaderDescription {
  const context = useContext(ShellHeaderContext);
  if (context === null) {
    throw new Error("useActiveShellHeader must be used inside ShellHeaderProvider");
  }

  // Своё описание вью, если оно его зарегистрировало, старше отдельных действий: там действия уже
  // названы вместе с заголовком, и склеивать два источника значило бы показать кнопку дважды.
  if (context.description.actions !== undefined || context.viewActions === undefined) {
    return context.description;
  }

  return { ...context.description, actions: context.viewActions };
}
