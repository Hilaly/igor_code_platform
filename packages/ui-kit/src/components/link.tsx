/**
 * Ссылка. До интерактивного входа в провайдера интерфейс ядра никуда не уводил, поэтому примитива не
 * было вовсе; вход показывает адрес, по которому человек входит у самого провайдера
 * (docs/models-and-providers.md).
 *
 * Куда ведёт ссылка, знает вызывающий, а не кит: маршрутизатор оболочки живёт в приложении
 * (docs/ui-kit.md), и разбирать адрес здесь было бы догадкой о чужой навигации.
 */

import type { ReactNode } from "react";

import styles from "./link.module.css";

export type LinkProps = {
  href: string;
  /**
   * Ссылка ведёт за пределы платформы. Такая открывается новой вкладкой: наша вкладка обязана
   * остаться на месте — на ней продолжается диалог входа, и уход со страницы обрывает его.
   */
  external?: boolean;
  children: ReactNode;
};

export function Link({ href, external = false, children }: LinkProps) {
  return (
    <a
      className={styles.link}
      href={href}
      target={external ? "_blank" : undefined}
      // Адрес нашей страницы провайдеру знать незачем. `noopener` отдельным словом не пишется:
      // `noreferrer` включает его по определению, и второе слово было бы шумом, который читающему
      // приходится сверять со спецификацией.
      rel={external ? "noreferrer" : undefined}
    >
      {children}
    </a>
  );
}
