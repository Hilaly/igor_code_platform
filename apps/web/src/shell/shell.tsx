/**
 * Оболочка: левая панель (верх, основная часть, низ), центральная страница и правая панель с
 * вкладками. Заменить её плагин не может (docs/ui-extension-model.md) — хост владеет границами, размерами и полосой
 * вкладок, а плагин вкладывается в места внутри.
 */

import { Button } from "@sovereign/ui-kit";
import { useEffect, useState, type ReactNode } from "react";

import {
  clampPanelWidth,
  maximumPanelWidth,
  panelWidthLimits,
  type ShellLayout,
} from "./layout.ts";

export type ShellTabDescription = {
  id: string;
  label: string;
  content: ReactNode;
};

export type ShellProps = {
  layout: ShellLayout;
  onLayoutChange: (layout: ShellLayout) => void;
  labels: {
    left: string;
    right: string;
    emptyTabs: string;
    hideLeft: string;
    hideRight: string;
    showLeft: string;
    showRight: string;
  };
  navigation: ReactNode;
  /** Низ левой панели: индикатор связи с демоном. Он виден всегда, а не по переходу на страницу. */
  status: ReactNode;
  tabs: ShellTabDescription[];
  /** Текущая страница не даёт правой панели места; сохранённый layout при этом не меняется. */
  rightUnavailable?: boolean;
  children: ReactNode;
};

export function Shell({
  layout,
  onLayoutChange,
  labels,
  navigation,
  status,
  tabs,
  rightUnavailable = false,
  children,
}: ShellProps) {
  const open = tabs.find((tab) => tab.id === layout.openTab);
  const rightVisible = !rightUnavailable && !layout.rightHidden;
  const viewportWidth = useViewportWidth();
  const leftWidthBeforeRight = clampPanelWidth(
    layout.leftWidth,
    maximumPanelWidth(viewportWidth, rightVisible ? panelWidthLimits.minimum : undefined),
  );
  const rightMaximum = maximumPanelWidth(
    viewportWidth,
    layout.leftHidden ? undefined : leftWidthBeforeRight,
  );
  const rightWidth = clampPanelWidth(layout.rightWidth, rightMaximum);
  const leftMaximum = maximumPanelWidth(viewportWidth, rightVisible ? rightWidth : undefined);
  const leftWidth = clampPanelWidth(layout.leftWidth, leftMaximum);

  return (
    <div className="shell">
      {layout.leftHidden ? undefined : (
        <>
          <nav className="shell-left" aria-label={labels.left} style={{ width: `${leftWidth}px` }}>
            {/* Шапка панели: одна кнопка «скрыть», прижатая к правому краю. Заголовок навигации
                приходит внутри `navigation` ниже, и совать кнопку в чужое содержимое не нужно. Стрелка
                скрытия смотрит наружу — туда, куда панель свернётся. */}
            <div className="shell-left-head">
              <Button
                size="sm"
                iconOnly
                aria-label={labels.hideLeft}
                title={labels.hideLeft}
                onClick={() => onLayoutChange({ ...layout, leftHidden: true })}
              >
                «
              </Button>
            </div>
            <div className="shell-left-main">{navigation}</div>
            <div className="shell-left-bottom">{status}</div>
          </nav>
          <PanelResizer
            edge="left"
            width={leftWidth}
            maximum={leftMaximum}
            label={labels.left}
            onWidth={(leftWidth) => onLayoutChange({ ...layout, leftWidth })}
          />
        </>
      )}
      <main className="shell-page">
        {children}
        {/* Возврат скрытой панели — кнопка поверх угла страницы, а не постоянный рельс: рельс
            постоянно отъедал бы ширину у страницы ради кнопки, которая нужна редко. Кнопка идёт после
            страницы, и порядка документа достаточно для её слоя — лишний z-index конкурировал бы с
            меню на --sovereign-z-overlay. */}
        {layout.leftHidden ? (
          <span className="shell-restore shell-restore-left">
            <Button
              size="sm"
              iconOnly
              aria-label={labels.showLeft}
              title={labels.showLeft}
              onClick={() => onLayoutChange({ ...layout, leftHidden: false })}
            >
              {/* Стрелка возврата смотрит к панели: левая панель спрятана слева, значит вернуть её —
                  движение вправо. Скрывали её стрелкой «, возвращаем противоположной. */}
              »
            </Button>
          </span>
        ) : undefined}
        {!rightUnavailable && layout.rightHidden ? (
          <span className="shell-restore shell-restore-right">
            <Button
              size="sm"
              iconOnly
              aria-label={labels.showRight}
              title={labels.showRight}
              onClick={() => onLayoutChange({ ...layout, rightHidden: false })}
            >
              «
            </Button>
          </span>
        ) : undefined}
      </main>
      {rightVisible ? (
        <>
          <PanelResizer
            edge="right"
            width={rightWidth}
            maximum={rightMaximum}
            label={labels.right}
            onWidth={(rightWidth) => onLayoutChange({ ...layout, rightWidth })}
          />
          <aside
            className="shell-right"
            aria-label={labels.right}
            style={{ width: `${rightWidth}px` }}
          >
            <div className="shell-right-head">
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
              <Button
                size="sm"
                iconOnly
                aria-label={labels.hideRight}
                title={labels.hideRight}
                onClick={() => onLayoutChange({ ...layout, rightHidden: true, openTab: undefined })}
              >
                »
              </Button>
            </div>
            {open === undefined ? (
              <div className="shell-tab-empty">{labels.emptyTabs}</div>
            ) : (
              <div className="shell-tab-body">{open.content}</div>
            )}
          </aside>
        </>
      ) : undefined}
    </div>
  );
}

type PanelResizerProps = {
  /** Какой край панели тянет граница: определяет знак смещения и подпись для скринридера. */
  edge: "left" | "right";
  /** Текущая ширина панели. Пришедшая пропом, а не запомненная при нажатии — от неё же считает клавиатура. */
  width: number;
  /** Максимум текущего окна: одинаков для жеста, клавиатуры и доступного диапазона. */
  maximum: number;
  /** Имя панели: у самой границы подписи нет, а `aria-valuenow` без имени говорит только число. */
  label: string;
  onWidth: (width: number) => void;
};

/**
 * Граница панели. Работает от `pointer`-событий, а не от `mouse`: с тачпада и с планшета тянуть надо
 * так же. С клавиатуры границу двигают стрелки — иначе размер панели недоступен без мыши.
 *
 * Ширина при протаскивании считается от точки начала жеста, а не приращением между кадрами: замыкание
 * внутри `onPointerDown` живёт весь жест и не видит новых пропов, поэтому шаг от предыдущей точки
 * складывался бы поверх состояния, которое уже устарело в момент нажатия, — панель дёргалась к стартовой
 * ширине на каждом кадре и не оставалась там, куда её потянули.
 */
function PanelResizer({ edge, width, maximum, label, onWidth }: PanelResizerProps) {
  const sign = edge === "left" ? 1 : -1;

  return (
    <div
      className="shell-resizer"
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuemin={panelWidthLimits.minimum}
      aria-valuemax={maximum}
      aria-valuenow={width}
      tabIndex={0}
      onPointerDown={(event) => {
        // Выделение текста при протаскивании границы — не то, чего просили мышью.
        event.preventDefault();

        // Обе точки отсчёта берутся один раз на весь жест и с этого момента не устаревают: конечная
        // ширина каждого кадра — расстояние от начала жеста, а не сумма его собственных шагов.
        const startX = event.clientX;
        const startWidth = width;

        // Слушает окно, а не сама граница: курсор во время протаскивания уходит с неё, и события
        // после этого приходят другому элементу.
        const move = (moved: PointerEvent): void => {
          onWidth(clampPanelWidth(startWidth + (moved.clientX - startX) * sign, maximum));
        };
        const drop = (): void => {
          window.removeEventListener("pointermove", move);
          window.removeEventListener("pointerup", drop);
          window.removeEventListener("pointercancel", drop);
        };

        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", drop);
        // Браузер отменяет поток pointer-событий, если пользователь сменил вкладку, открыл DevTools
        // или ОС прервала жест: без этой ветки `pointerup` не приходит, и listener-ы висят вечно,
        // вызывая onWidth на каждом последующем движении мыши по странице.
        window.addEventListener("pointercancel", drop);
      }}
      onKeyDown={(event) => {
        if (event.key === "ArrowLeft") {
          onWidth(clampPanelWidth(width - sign * 16, maximum));
        }

        if (event.key === "ArrowRight") {
          onWidth(clampPanelWidth(width + sign * 16, maximum));
        }
      }}
    />
  );
}

function useViewportWidth(): number {
  const [viewportWidth, setViewportWidth] = useState(() => window.innerWidth);

  useEffect(() => {
    const update = (): void => setViewportWidth(window.innerWidth);

    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  return viewportWidth;
}
