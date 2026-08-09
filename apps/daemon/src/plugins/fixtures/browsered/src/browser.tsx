/**
 * Браузерная часть плагина-фикстуры. Написана так, чтобы задеть каждый способ добраться до модуля
 * хоста: именованный импорт, default, namespace и автоматический JSX-рантайм, — сборка обязана
 * увести их все в реестр, а не втащить второй React в бандл.
 */

import React, { useState } from "react";
import * as ReactDom from "react-dom";
import { Place as BrowserPlace } from "@sovereign/browser-sdk";
import { Badge } from "@sovereign/ui-kit";

import styles from "./badge.module.css";

export const classNames = styles;

export const reactVersion = React.version;

export const reactDomKeys = Object.keys(ReactDom);

export const browserPlace = BrowserPlace;

export function View() {
  const [count, setCount] = useState(0);

  return (
    <div className={styles["badge"]}>
      <Badge onClick={() => setCount(count + 1)}>{count}</Badge>
      <span className={styles["badge-tail"]} />
    </div>
  );
}
