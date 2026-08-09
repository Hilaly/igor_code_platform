import {
  Place,
  PlaceCollection,
  useCommands,
  usePageNavigation,
  type Command,
  type PlaceContext,
} from "@sovereign/browser-sdk";
import { Badge, Heading, Text } from "@sovereign/ui-kit";
import { useState } from "react";

import styles from "./browser.module.css";

export function PluginsPanel({ context }: { context: PlaceContext }) {
  const [count, setCount] = useState(0);

  return (
    <div className={styles.panel}>
      <Heading level={2}>Plugins, by the placed plugin</Heading>
      <Text>view: {context.subject?.["view"] ?? "—"}</Text>
      <button onClick={() => setCount(count + 1)}>clicked {count} times</button>
      <Place id="placed.board" context={context} />
      <PlaceCollection id="placed.board-actions" context={context} />
    </div>
  );
}

export function SidebarSection() {
  return (
    <div className={styles.panel}>
      <Badge tone="accent">placed section</Badge>
    </div>
  );
}

export function HeaderAction() {
  return <Badge tone="success">placed action</Badge>;
}

/**
 * Вкладка правой панели. Считает свои отрисовки, чтобы по живой проверке было видно, что закрытая
 * вкладка не смонтирована, а открытая переживает перерисовки соседей.
 */
export function BoardTab({ context }: { context: PlaceContext }) {
  const [count, setCount] = useState(0);
  const { invoke } = useCommands();
  const [outcome, setOutcome] = useState("—");

  return (
    <div className={styles.panel}>
      <Heading level={2}>Board tab</Heading>
      <Text>page: {context.subject?.["page"] ?? "—"}</Text>
      <button onClick={() => setCount(count + 1)}>counted {count}</button>
      <button
        onClick={() => {
          void invoke("placed.run", context).then((result) => setOutcome(result.kind));
        }}
      >
        run the command from here: {outcome}
      </button>
    </div>
  );
}

/** Команда с местом: хост ставит за неё кнопку в полосу действий шапки. */
export const RunCommand: Command = {
  run: (context) => {
    // Живая проверка читает это в консоли браузера: у команды нет своего следа на экране.
    console.log("[placed] the command ran for", context.subject?.["page"] ?? "no page");
  },
  available: (context) => context.subject?.["page"] !== "session-archive",
};

/** Команда без места: она видна только в палитре, а её отказ обязан приехать значением. */
export const BoomCommand: Command = {
  run: () => {
    throw new Error("the placed command cannot run");
  },
};

export function Boom(): never {
  throw new Error("the placed plugin cannot render this");
}

export function Board({ context }: { context: PlaceContext }) {
  return <Text>the built-in board for {context.project ?? "the window"}</Text>;
}

/**
 * Целая страница плагина. Она нарочно делает всё, что обещает фасад: показывает базу, относительный
 * путь и параметры, уходит вглубь себя, меняет только параметр без новой записи истории и выходит
 * на маршрут ядра.
 */
export function LogPage() {
  const navigation = usePageNavigation();
  const entry = navigation.path.startsWith("/entry/")
    ? navigation.path.slice("/entry/".length)
    : "";

  return (
    <div className={styles.panel}>
      <Heading level={2}>Log of the placed plugin</Heading>
      <Text>base: {navigation.basePath}</Text>
      <Text>path: {navigation.path}</Text>
      <Text>filter: {navigation.query["filter"] ?? "—"}</Text>
      {entry === "" ? (
        <ul>
          {["1", "2", "3"].map((id) => (
            <li key={id}>
              <button
                onClick={() => navigation.navigate(`entry/${id}`, { query: navigation.query })}
              >
                open entry {id}
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <>
          <Badge tone="accent">entry {entry}</Badge>
          <button onClick={() => navigation.navigate("/", { query: navigation.query })}>
            back to the list
          </button>
        </>
      )}
      {/* Фильтр меняет только параметр и не наполняет историю: ровно тот случай, ради которого
          у перехода есть `replace`. */}
      <button
        onClick={() =>
          navigation.navigate(navigation.path, {
            query: { filter: navigation.query["filter"] === "warn" ? "error" : "warn" },
            replace: true,
          })
        }
      >
        toggle the filter in place
      </button>
      <button onClick={() => navigation.navigateCore({ kind: "settings", section: "plugins" })}>
        leave for the plugins settings
      </button>
    </div>
  );
}
