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

import { Button, Menu, MoreIcon, type ViewHeaderProps } from "@sovereign/ui-kit";

/** Регистр действия в полосе: `accent` — главное действие страницы, `danger` — необратимое. */
export type ShellHeaderActionTone = "normal" | "accent" | "danger";

export type ShellHeaderAction = {
  id: string;
  label: string;
  /** Значок: у кнопки стоит перед подписью, у пункта меню — в общем слоте значков. */
  icon?: ReactNode;
  disabled?: boolean;
  /** Подсказка при наведении: обычно причина, по которой действие сейчас недоступно. */
  title?: string;
  tone?: ShellHeaderActionTone;
  /**
   * Главное действие страницы: остаётся кнопкой с подписью. Остальные уезжают в меню «ещё» — полоса
   * постоянный хром, и четыре подписи в ней спорили с заголовком маршрута, а на узком экране
   * переносились второй строкой, растягивая полосу вдвое.
   */
  primary?: boolean;
  /**
   * Действие раскрывает что-то на самой странице и держит это состояние. Пункту меню не нужно: меню
   * закрывается выбором, а раскрытая форма остаётся под кнопкой, и скринридер обязан об этом узнать.
   */
  expanded?: boolean;
  run: () => void;
};

export type ShellHeaderDescription = Pick<ViewHeaderProps, "title" | "context" | "level"> & {
  /**
   * Действия данными, а не готовым узлом: полоса решает, что остаётся кнопкой, а что уезжает в меню,
   * и узел она не смогла бы ни пересчитать, ни разложить. Массив обязан быть стабильным между
   * рендерами — см. `useShellHeader`.
   */
  actions?: readonly ShellHeaderAction[];
};

type ShellHeaderContextValue = {
  description: ShellHeaderDescription;
  register: (description: ShellHeaderDescription) => () => void;
  /**
   * Действия отдельно от описания: маршрут называет `describePage`, а главное действие знает только
   * то вью, которое его выполняет. Регистрируя полное описание ради одной кнопки, вью пришлось бы
   * повторить у себя заголовок маршрута — и разойтись с ним при первой правке.
   */
  viewActions?: readonly ShellHeaderAction[];
  registerActions: (actions: readonly ShellHeaderAction[] | undefined) => () => void;
};

const buttonTone = (tone: ShellHeaderActionTone | undefined) =>
  tone === "accent" ? "accent" : tone === "danger" ? "danger" : "normal";

/**
 * Полоса действий шапки: главное действие кнопкой, остальные — в меню «ещё». Возвращает `undefined`,
 * когда действий нет вовсе: пустой узел оставил бы в полосе отступ за несуществующей кнопкой.
 */
export function ShellHeaderActions({
  actions,
  moreLabel,
}: {
  actions?: readonly ShellHeaderAction[];
  moreLabel: string;
}): ReactNode {
  if (actions === undefined || actions.length === 0) {
    return undefined;
  }

  const primary = actions.filter((action) => action.primary === true);
  const rest = actions.filter((action) => action.primary !== true);

  return (
    <>
      {primary.map((action) => (
        <Button
          key={action.id}
          tone={buttonTone(action.tone)}
          disabled={action.disabled}
          {...(action.title === undefined ? {} : { title: action.title })}
          {...(action.expanded === undefined ? {} : { "aria-expanded": action.expanded })}
          onClick={action.run}
        >
          {action.icon}
          {action.label}
        </Button>
      ))}
      {rest.length === 0 ? undefined : (
        <Menu
          label={moreLabel}
          triggerLabel={moreLabel}
          trigger={<MoreIcon size="sm" />}
          compact
          items={rest.map((action) => ({
            id: action.id,
            label: action.label,
            ...(action.icon === undefined ? {} : { icon: action.icon }),
            ...(action.disabled === undefined ? {} : { disabled: action.disabled }),
            tone: action.tone === "danger" ? ("danger" as const) : ("normal" as const),
            onSelect: action.run,
          }))}
        />
      )}
    </>
  );
}

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
  const actionRegistrationsRef = useRef(
    new Map<symbol, readonly ShellHeaderAction[] | undefined>(),
  );
  const [viewActions, setViewActions] = useState<readonly ShellHeaderAction[] | undefined>(
    undefined,
  );

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

  const registerActions = useCallback(
    (actions: readonly ShellHeaderAction[] | undefined): (() => void) => {
      const token = Symbol("shell-header-actions");
      actionRegistrationsRef.current.set(token, actions);
      setViewActions(actions);

      return () => {
        actionRegistrationsRef.current.delete(token);
        setViewActions([...actionRegistrationsRef.current.values()].at(-1));
      };
    },
    [],
  );

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
 * Действия страницы в шапке маршрута. Массив обязан быть стабильным между рендерами — как и у
 * `useShellHeader`, вызывающий держит его в `useMemo`: новый массив на каждый рендер
 * перерегистрировал бы действия и снова вызывал рендер.
 *
 * Возвращает, доступна ли шапка: вне оболочки вью обязано показать действия само.
 */
export function useShellHeaderActions(actions: readonly ShellHeaderAction[] | undefined): boolean {
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
