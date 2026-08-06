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

  const value = useMemo(() => ({ description, register }), [description, register]);

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

/** Whether the current view is rendered inside the shell-owned header provider. */
export function useShellHeaderAvailable(): boolean {
  return useContext(ShellHeaderContext) !== null;
}

export function useActiveShellHeader(): ShellHeaderDescription {
  const context = useContext(ShellHeaderContext);
  if (context === null) {
    throw new Error("useActiveShellHeader must be used inside ShellHeaderProvider");
  }

  return context.description;
}
