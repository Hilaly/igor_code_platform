/**
 * Оболочка: левая панель (верх, основная часть, низ), центральная страница и правая панель с
 * вкладками. Заменить её плагин не может (ADR-0029) — хост владеет границами, размерами и полосой
 * вкладок, а плагин вкладывается в места внутри.
 */

import { Button } from "@sovereign/ui-kit";
import type { ReactNode } from "react";

import { clampPanelWidth, type ShellLayout, type ShellTab } from "./layout.ts";

export type ShellTabDescription = {
  id: ShellTab;
  label: string;
  content: ReactNode;
};

export type ShellProps = {
  layout: ShellLayout;
  onLayoutChange: (layout: ShellLayout) => void;
  labels: { left: string; right: string };
  navigation: ReactNode;
  /** Низ левой панели: индикатор связи с демоном. Он виден всегда, а не по переходу на страницу. */
  status: ReactNode;
  tabs: ShellTabDescription[];
  children: ReactNode;
};

export function Shell({
  layout,
  onLayoutChange,
  labels,
  navigation,
  status,
  tabs,
  children,
}: ShellProps) {
  const open = tabs.find((tab) => tab.id === layout.openTab);

  return (
    <div className="shell">
      <nav
        className="shell-left"
        aria-label={labels.left}
        style={{ width: `${layout.leftWidth}px` }}
      >
        <div className="shell-left-main">{navigation}</div>
        <div className="shell-left-bottom">{status}</div>
      </nav>
      <PanelResizer
        onResize={(delta) =>
          onLayoutChange({ ...layout, leftWidth: clampPanelWidth(layout.leftWidth + delta) })
        }
      />
      <main className="shell-page">{children}</main>
      {open === undefined ? undefined : (
        <PanelResizer
          onResize={(delta) =>
            onLayoutChange({ ...layout, rightWidth: clampPanelWidth(layout.rightWidth - delta) })
          }
        />
      )}
      <aside
        className="shell-right"
        aria-label={labels.right}
        style={open === undefined ? undefined : { width: `${layout.rightWidth}px` }}
      >
        <div className="shell-tabs" role="tablist">
          {tabs.map((tab) => (
            <Button
              key={tab.id}
              onClick={() =>
                onLayoutChange({
                  ...layout,
                  openTab: layout.openTab === tab.id ? undefined : tab.id,
                })
              }
              pressed={layout.openTab === tab.id}
            >
              {tab.label}
            </Button>
          ))}
        </div>
        {open === undefined ? undefined : <div className="shell-tab-body">{open.content}</div>}
      </aside>
    </div>
  );
}

type PanelResizerProps = {
  onResize: (delta: number) => void;
};

/**
 * Граница панели. Работает от `pointer`-событий, а не от `mouse`: с тачпада и с планшета тянуть надо
 * так же. С клавиатуры границу двигают стрелки — иначе размер панели недоступен без мыши.
 */
function PanelResizer({ onResize }: PanelResizerProps) {
  return (
    <div
      className="shell-resizer"
      role="separator"
      aria-orientation="vertical"
      tabIndex={0}
      onPointerDown={(event) => {
        // Выделение текста при протаскивании границы — не то, чего просили мышью.
        event.preventDefault();

        // Смещение считается от предыдущей точки, а не от начала: ширина меняется приращением, и от
        // начала она уезжала бы в стену за первые же несколько кадров.
        let previous = event.clientX;

        // Слушает окно, а не сама граница: курсор во время протаскивания уходит с неё, и события
        // после этого приходят другому элементу.
        const move = (moved: PointerEvent): void => {
          onResize(moved.clientX - previous);
          previous = moved.clientX;
        };
        const drop = (): void => {
          window.removeEventListener("pointermove", move);
          window.removeEventListener("pointerup", drop);
        };

        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", drop);
      }}
      onKeyDown={(event) => {
        if (event.key === "ArrowLeft") {
          onResize(-16);
        }

        if (event.key === "ArrowRight") {
          onResize(16);
        }
      }}
    />
  );
}
